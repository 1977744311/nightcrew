import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/program";
import { buildReport, renderReport } from "../src/cli/report";
import type { IterationRecord, TokenUsage } from "../src/core/types";
import { appendHistory } from "../src/state/history";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

const NOW = "2026-07-02T12:00:00.000Z";

let project: TestProject | undefined;

function usage(total: number): TokenUsage {
  return {
    inputTokens: total,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function record(startedAt: string, options: Partial<IterationRecord> = {}): IterationRecord {
  return {
    id: `iteration-${startedAt}`,
    projectName: "demo",
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

async function captureConsole(
  action: () => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
  try {
    await action();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

afterEach(() => {
  project?.cleanup();
  project = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("nightcrew report", () => {
  it("digests landed plans, failures, tokens, and open questions", async () => {
    project = await makeTempProject({ loop: { backoffMs: [0] } });
    project.setCrew(["Ship the feature"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [
          {
            type: "write",
            path: ".nightcrew/plans/active/2026-07-02-ship.md",
            content: planFileContents("2026-07-02-ship", "Ship the feature"),
          },
        ],
        finalMessage: "PLAN CREATED",
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        status: "error",
        errorMessage: "transient provider blip",
      },
      {
        match: "operation = \\*\\*repair\\*\\*",
        actions: [
          { type: "write", path: "src/feature.txt", content: "done\n" },
          {
            type: "write",
            path: ".nightcrew/plans/active/2026-07-02-ship.md",
            content: planFileContents("2026-07-02-ship", "Ship the feature").replace(
              "- [ ]",
              "- [x]",
            ),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
    ]);

    await project.run(); // plan
    await project.run(); // execute -> provider error
    await project.run(); // repair -> lands

    appendFileSync(
      `${project.root}/.nightcrew/questions.md`,
      "- [ ] should the feature support dark mode?\n- [x] already answered\n",
    );

    const report = buildReport(project.ctx(), 24 * 3_600_000);

    expect(report.iterations.total).toBe(3);
    expect(report.iterations.success).toBe(2);
    expect(report.iterations.failed).toBe(1);
    expect(report.landed).toHaveLength(1);
    expect(report.landed[0]?.planId).toBe("2026-07-02-ship");
    expect(report.landed[0]?.title).toBe("Ship the feature");
    expect(report.plans).toHaveLength(1);
    expect(report.plans[0]?.planId).toBe("2026-07-02-ship");
    expect(report.plans[0]?.iterations).toBe(3);
    expect(report.plans[0]?.landed).toBe(true);
    expect(report.plans[0]?.totalTokens).toBe(report.totalTokens);
    expect(report.failures).toEqual([{ kind: "provider_error", count: 1 }]);
    expect(report.totalTokens).toBeGreaterThan(0);
    expect(report.openQuestions).toEqual(["should the feature support dark mode?"]);
    expect(report.activePlans).toHaveLength(0);
    expect(report.state.pendingRepairs).toHaveLength(0);

    const text = renderReport(report);
    expect(text).toContain("2026-07-02-ship");
    expect(text).toContain("plans");
    expect(text).toContain("landed");
    expect(text).toContain("provider_error");
    expect(text).toContain("dark mode");
  });

  it("breaks down iterations, tokens, and landed status by plan", async () => {
    project = await makeTempProject();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    writeFileSync(
      join(project.root, ".nightcrew/plans/completed/2026-07-02-ship.md"),
      planFileContents("2026-07-02-ship", "Ship the feature"),
    );
    writeFileSync(
      join(project.root, ".nightcrew/plans/active/2026-07-02-polish.md"),
      planFileContents("2026-07-02-polish", "Polish the feature"),
    );

    appendHistory(
      project.ctx().paths,
      record("2026-07-02T10:00:00.000Z", {
        planId: "2026-07-02-ship",
        usage: usage(100),
      }),
    );
    appendHistory(
      project.ctx().paths,
      record("2026-07-02T11:00:00.000Z", {
        planId: "2026-07-02-ship",
        merged: true,
        usage: usage(25),
      }),
    );
    appendHistory(
      project.ctx().paths,
      record("2026-07-02T11:30:00.000Z", {
        planId: "2026-07-02-polish",
        status: "failed",
        failure: { kind: "provider_error", message: "provider failed" },
        usage: usage(50),
      }),
    );
    appendHistory(
      project.ctx().paths,
      record("2026-07-02T11:45:00.000Z", {
        operation: "garden",
        usage: usage(1000),
      }),
    );

    const report = buildReport(project.ctx(), 24 * 3_600_000);

    expect(report.totalTokens).toBe(1175);
    expect(report.plans).toEqual([
      {
        planId: "2026-07-02-ship",
        title: "Ship the feature",
        iterations: 2,
        usage: usage(125),
        totalTokens: 125,
        landed: true,
      },
      {
        planId: "2026-07-02-polish",
        title: "Polish the feature",
        iterations: 1,
        usage: usage(50),
        totalTokens: 50,
        landed: false,
      },
    ]);

    const text = renderReport(report);
    expect(text).toContain("iter      tokens  status   plan");
    expect(text).toContain("2026-07-02-ship  Ship the feature");
    expect(text).toContain("2026-07-02-polish  Polish the feature");
    expect(text).toContain("125");
    expect(text).toContain("pending");

    const output = await captureConsole(() =>
      runCli(["report", "--root", project?.root ?? "", "--hours", "24", "--json"]),
    );
    const parsed = JSON.parse(output.stdout) as ReturnType<typeof buildReport>;

    expect(output.stderr).toBe("");
    expect(parsed.plans.map((plan) => plan.planId)).toEqual([
      "2026-07-02-ship",
      "2026-07-02-polish",
    ]);
    expect(parsed.plans[0]?.totalTokens).toBe(125);
    expect(parsed.plans[1]?.landed).toBe(false);
  });

  it("ignores history outside the window", async () => {
    project = await makeTempProject();
    project.setScript([{ match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" }]);
    await project.run();

    const wide = buildReport(project.ctx(), 3_600_000);
    expect(wide.iterations.total).toBe(1);

    const narrow = buildReport(project.ctx(), 0);
    expect(narrow.iterations.total).toBe(0);
  });
});
