import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDoctorReport, runDoctorChecks } from "../src/cli/doctor";
import { runCli } from "../src/cli/program";
import { writeRegistry } from "../src/config/registry";
import { ensureDir } from "../src/utils/fs";
import { makeTempProject, type TestProject } from "./helpers";

let project: TestProject | undefined;

function healthyConfig(): Record<string, unknown> {
  return {
    bootstrap: [{ name: "install", run: "npm ci" }],
    verify: {
      profile: "default",
      profiles: {
        default: {
          steps: [{ name: "test", run: "npm test" }],
        },
      },
    },
  };
}

async function captureStdout(action: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  try {
    await action();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

afterEach(() => {
  project?.cleanup();
  project = undefined;
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("nightcrew doctor", () => {
  it("passes and renders a table for a healthy project", async () => {
    project = await makeTempProject(healthyConfig());

    const report = await runDoctorChecks(project.root);

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "node",
        "git executable",
        "git repository",
        "config",
        "bootstrap commands",
        "verify commands",
        "base branch",
        "registry",
        "daemon lock",
      ]),
    );

    const rendered = renderDoctorReport(report);
    expect(rendered).toContain("nightcrew doctor");
    expect(rendered).toContain("PASS");
    expect(rendered).toContain("bootstrap commands");
  });

  it("reports repeated empty command failures without collapsing them", async () => {
    project = await makeTempProject({
      bootstrap: [
        { name: "install", run: "" },
        { name: "deps", run: "   " },
      ],
      verify: {
        profile: "default",
        profiles: {
          default: {
            steps: [
              { name: "test", run: "" },
              { name: "typecheck", run: "   " },
            ],
          },
        },
      },
    });

    const report = await runDoctorChecks(project.root, { nodeVersion: "18.19.0" });
    const failures = report.checks.filter((check) => !check.ok);

    expect(report.ok).toBe(false);
    expect(failures.filter((check) => check.name === "bootstrap command")).toHaveLength(2);
    expect(failures.filter((check) => check.name === "verify command")).toHaveLength(2);
    expect(failures.find((check) => check.name === "node")?.detail).toContain("below 20");
    expect(failures.some((check) => check.name === "config")).toBe(true);
  });

  it("reports git availability failures with repository detection", async () => {
    project = await makeTempProject(healthyConfig());

    const report = await runDoctorChecks(project.root, {
      git: async () => ({ ok: false, code: 1, stdout: "", stderr: "spawn git ENOENT" }),
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "git executable")?.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "git repository")?.detail).toContain(
      "git executable check failed",
    );
  });

  it("reports missing base branch, global registration, and stale daemon lock", async () => {
    project = await makeTempProject(healthyConfig());
    project.setConfig({
      ...healthyConfig(),
      project: { name: "demo", baseBranch: "missing-branch" },
    });
    writeRegistry({ version: 1, projects: [] });
    const paths = project.ctx().paths;
    ensureDir(paths.runtimeDir);
    writeFileSync(
      paths.lockFile,
      JSON.stringify({
        pid: 999_999_999,
        role: "crew-daemon",
        startedAt: "2026-07-02T00:00:00.000Z",
      }),
    );

    const report = await runDoctorChecks(project.root, { isProcessAlive: () => false });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "base branch")?.detail).toContain(
      "missing-branch",
    );
    expect(report.checks.find((check) => check.name === "registry")?.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "daemon lock")?.detail).toContain(
      "stale lock",
    );
  });

  it("sets the CLI exit code from the report and prints the table", async () => {
    project = await makeTempProject(healthyConfig());

    const passingOutput = await captureStdout(() =>
      runCli(["doctor", "--root", project?.root ?? ""]),
    );
    expect(process.exitCode).toBe(0);
    expect(passingOutput).toContain("nightcrew doctor");
    expect(passingOutput).toContain("PASS");

    project.setConfig({
      ...healthyConfig(),
      project: { name: "demo", baseBranch: "missing-branch" },
    });

    const failingOutput = await captureStdout(() =>
      runCli(["doctor", "--root", project?.root ?? ""]),
    );
    expect(process.exitCode).toBe(1);
    expect(failingOutput).toContain("FAIL");
    expect(failingOutput).toContain("base branch");
  });
});
