import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCrewReport, renderCrewReport } from "../src/cli/crew-report";
import { runCli } from "../src/cli/program";
import { writeRegistry } from "../src/config/registry";
import type { IterationRecord, TokenUsage } from "../src/core/types";
import { appendHistory } from "../src/state/history";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

const NOW = "2026-07-02T12:00:00.000Z";

let projects: TestProject[] = [];

function captureConsole(action: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
  return action()
    .then(() => ({ stdout: stdout.join("\n"), stderr: stderr.join("\n") }))
    .finally(() => {
      log.mockRestore();
      error.mockRestore();
    });
}

function usage(total: number): TokenUsage {
  return {
    inputTokens: total,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function record(
  projectName: string,
  startedAt: string,
  options: Partial<IterationRecord> = {},
): IterationRecord {
  return {
    id: `${projectName}-${startedAt}`,
    projectName,
    startedAt,
    endedAt: startedAt,
    durationMs: 1,
    operation: "execute",
    planId: null,
    status: "success",
    commits: [],
    controlOnly: false,
    usage: null,
    merged: false,
    ...options,
  };
}

function addCompletedPlan(project: TestProject, id: string, title: string): void {
  writeFileSync(
    join(project.root, ".nightcrew", "plans", "completed", `${id}.md`),
    planFileContents(id, title),
  );
}

async function makeRegisteredProjects(): Promise<[TestProject, TestProject]> {
  const alpha = await makeTempProject({ project: { name: "alpha", baseBranch: "main" } });
  const beta = await makeTempProject({ project: { name: "beta", baseBranch: "main" } });
  projects = [alpha, beta];
  writeRegistry({
    version: 1,
    projects: [
      { name: "alpha", root: alpha.root },
      { name: "beta", root: beta.root },
    ],
  });
  return [alpha, beta];
}

afterEach(() => {
  for (const project of projects) project.cleanup();
  projects = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("crew report", () => {
  it("aggregates landed plans, failures, and tokens across registered projects", async () => {
    const [alpha, beta] = await makeRegisteredProjects();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    addCompletedPlan(alpha, "2026-07-02-alpha", "Alpha landed");
    appendHistory(
      alpha.ctx().paths,
      record("alpha", "2026-07-02T10:00:00.000Z", {
        planId: "2026-07-02-alpha",
        commits: ["a1"],
        merged: true,
        usage: usage(100),
      }),
    );
    appendHistory(
      alpha.ctx().paths,
      record("alpha", "2026-07-02T10:30:00.000Z", {
        status: "failed",
        failure: { kind: "verify_failed", message: "test failed" },
        usage: usage(25),
      }),
    );
    addCompletedPlan(beta, "2026-07-02-beta", "Beta landed");
    appendHistory(
      beta.ctx().paths,
      record("beta", "2026-07-02T11:00:00.000Z", {
        planId: "2026-07-02-beta",
        commits: ["b1", "b2"],
        merged: true,
        usage: usage(200),
      }),
    );

    const report = buildCrewReport(24 * 3_600_000);
    const text = renderCrewReport(report);

    expect(report.totals).toMatchObject({
      projects: 2,
      readableProjects: 2,
      unreadableProjects: 0,
      landedPlans: 2,
      failedIterations: 1,
      totalTokens: 325,
    });
    expect(report.projects.map((project) => project.name)).toEqual(["alpha", "beta"]);
    expect(report.projects[0]).toMatchObject({
      ok: true,
      landedPlans: 1,
      failedIterations: 1,
      totalTokens: 125,
    });
    expect(text).toContain("crew report");
    expect(text).toContain("alpha");
    expect(text).toContain("landed 1");
    expect(text).toContain("325");
  });

  it("applies the same hours window to every project", async () => {
    const [alpha, beta] = await makeRegisteredProjects();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    appendHistory(
      alpha.ctx().paths,
      record("alpha", "2026-07-02T11:30:00.000Z", {
        status: "failed",
        failure: { kind: "provider_error", message: "recent" },
        usage: usage(10),
      }),
    );
    appendHistory(
      beta.ctx().paths,
      record("beta", "2026-07-02T09:00:00.000Z", {
        status: "failed",
        failure: { kind: "provider_error", message: "old" },
        usage: usage(90),
      }),
    );

    const report = buildCrewReport(60 * 60_000);

    expect(report.totals.failedIterations).toBe(1);
    expect(report.totals.totalTokens).toBe(10);
    expect(report.projects.find((project) => project.name === "beta")).toMatchObject({
      ok: true,
      failedIterations: 0,
      totalTokens: 0,
    });
  });

  it("includes unreadable projects without dropping readable project totals", async () => {
    const [alpha] = await makeRegisteredProjects();
    mkdirSync(join(alpha.home, "missing-config-root"), { recursive: true });
    writeRegistry({
      version: 1,
      projects: [
        { name: "alpha", root: alpha.root },
        { name: "broken", root: join(alpha.home, "missing-config-root") },
      ],
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    appendHistory(
      alpha.ctx().paths,
      record("alpha", "2026-07-02T11:30:00.000Z", { status: "failed", usage: usage(10) }),
    );

    const report = buildCrewReport(24 * 3_600_000);
    const broken = report.projects.find((project) => project.name === "broken");

    expect(report.totals).toMatchObject({
      projects: 2,
      readableProjects: 1,
      unreadableProjects: 1,
      failedIterations: 1,
      totalTokens: 10,
    });
    expect(broken).toMatchObject({
      ok: false,
      landedPlans: 0,
      failedIterations: 0,
      totalTokens: 0,
    });
    expect(broken?.ok === false ? broken.error : "").toContain("No .nightcrew/config.yaml");
    expect(renderCrewReport(report)).toContain("broken");
  });

  it("prints the aggregated report as JSON from the CLI", async () => {
    const [alpha, beta] = await makeRegisteredProjects();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    appendHistory(
      alpha.ctx().paths,
      record("alpha", "2026-07-02T11:00:00.000Z", { usage: usage(7) }),
    );
    appendHistory(
      beta.ctx().paths,
      record("beta", "2026-07-02T11:00:00.000Z", { usage: usage(8) }),
    );

    const output = await captureConsole(() =>
      runCli(["crew", "report", "--hours", "24", "--json"]),
    );
    const parsed = JSON.parse(output.stdout) as ReturnType<typeof buildCrewReport>;

    expect(output.stderr).toBe("");
    expect(parsed.totals.totalTokens).toBe(15);
    expect(parsed.projects.map((project) => project.name)).toEqual(["alpha", "beta"]);
  });

  it("sets a failing exit code for invalid --hours like nightcrew report", async () => {
    await makeRegisteredProjects();

    const output = await captureConsole(() => runCli(["crew", "report", "--hours", "nope"]));

    expect(process.exitCode).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain('invalid --hours "nope"');
  });
});
