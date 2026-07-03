import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/program";
import { registerProject } from "../src/config/registry";
import type { IterationRecord } from "../src/core/types";
import { listPlans } from "../src/plans/plans";
import { buildProvider } from "../src/providers/factory";
import { buildReviewer } from "../src/review/factory";
import { runCrewDaemon } from "../src/scheduler/daemon";
import { runProjectScheduler } from "../src/scheduler/scheduler";
import { inWindow } from "../src/scheduler/windows";
import { readHistory } from "../src/state/history";
import { acquireProjectLock } from "../src/state/lock";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject;
const extraProjects: TestProject[] = [];

afterEach(() => {
  project?.cleanup();
  for (const extra of extraProjects.splice(0)) extra.cleanup();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

async function captureConsole(action: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  try {
    await action();
  } finally {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }
  return lines.join("\n");
}

describe("schedule windows", () => {
  const at = (day: number, hh: number, mm: number): Date => {
    // 2026-07-05 is a Sunday (day 0).
    const date = new Date(2026, 6, 5 + day, hh, mm, 0, 0);
    return date;
  };

  it("empty windows = always on", () => {
    expect(inWindow([], undefined, at(1, 12, 0))).toBe(true);
  });

  it("plain window", () => {
    expect(inWindow(["09:00-17:00"], undefined, at(1, 12, 0))).toBe(true);
    expect(inWindow(["09:00-17:00"], undefined, at(1, 8, 59))).toBe(false);
    expect(inWindow(["09:00-17:00"], undefined, at(1, 17, 0))).toBe(false);
  });

  it("midnight-wrapping window belongs to its start day", () => {
    const windows = ["23:00-07:00"];
    expect(inWindow(windows, undefined, at(1, 23, 30))).toBe(true);
    expect(inWindow(windows, undefined, at(2, 6, 30))).toBe(true);
    expect(inWindow(windows, undefined, at(2, 12, 0))).toBe(false);
    // days: only Monday(1) evenings — Tuesday 06:30 still belongs to Monday's window.
    expect(inWindow(windows, [1], at(1, 23, 30))).toBe(true);
    expect(inWindow(windows, [1], at(2, 6, 30))).toBe(true);
    expect(inWindow(windows, [1], at(2, 23, 30))).toBe(false);
  });

  it("days without windows gate whole days", () => {
    expect(inWindow([], [0, 6], at(0, 12, 0))).toBe(true); // Sunday
    expect(inWindow([], [0, 6], at(1, 12, 0))).toBe(false); // Monday
  });
});

function deps(projectUnderTest: TestProject) {
  const ctx = projectUnderTest.ctx();
  const provider = buildProvider(ctx.config, ctx.root);
  return { ctx, deps: { provider, reviewer: buildReviewer(ctx.config, provider, ctx.root) } };
}

describe("project scheduler", () => {
  it("runs two parallel plans in concurrent worktrees and lands both", async () => {
    project = await makeTempProject({ loop: { backoffMs: [0], maxParallelPlans: 2 } });
    project.setCrew(["Feature A", "Feature B"]);

    const mkPlan = (id: string, title: string) => planFileContents(id, title, { parallel: true });

    // Two plans pre-authored (parallel authoring is the scheduler's job to exploit).
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const plansDir = join(project.root, ".nightcrew/plans/active");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "2026-07-02-par-a.md"), mkPlan("2026-07-02-par-a", "Par A"));
    writeFileSync(join(plansDir, "2026-07-02-par-b.md"), mkPlan("2026-07-02-par-b", "Par B"));
    const { gitSync } = await import("./helpers");
    gitSync(project.root, "add", "-A");
    gitSync(project.root, "commit", "-m", "author two parallel plans");

    project.setScript([
      {
        match: "2026-07-02-par-a",
        actions: [
          { type: "write", path: "src/a.txt", content: "A\n" },
          {
            type: "write",
            path: ".nightcrew/plans/active/2026-07-02-par-a.md",
            content: mkPlan("2026-07-02-par-a", "Par A").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
      {
        match: "2026-07-02-par-b",
        actions: [
          { type: "write", path: "src/b.txt", content: "B\n" },
          {
            type: "write",
            path: ".nightcrew/plans/active/2026-07-02-par-b.md",
            content: mkPlan("2026-07-02-par-b", "Par B").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
      { match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" },
    ]);

    const { ctx, deps: d } = deps(project);
    const controller = new AbortController();
    const records: IterationRecord[] = [];
    const schedulerPromise = runProjectScheduler(ctx, d, {
      signal: controller.signal,
      pollMs: 50,
      ignoreWindows: true,
      onRecord: (record) => {
        records.push(record);
        // Once both plans have landed and the planner idles, stop the daemon.
        const landed = records.filter((r) => r.merged).length;
        const idled = records.some((r) => r.status === "idle");
        if (landed >= 2 && idled) controller.abort();
      },
    });
    const timeout = setTimeout(() => controller.abort(), 30_000);
    await schedulerPromise;
    clearTimeout(timeout);

    expect(existsSync(join(project.root, "src/a.txt"))).toBe(true);
    expect(existsSync(join(project.root, "src/b.txt"))).toBe(true);
    expect(listPlans(project.ctx().paths, "completed")).toHaveLength(2);
    expect(records.filter((r) => r.merged)).toHaveLength(2);
  }, 60_000);

  it("refuses to double-drive a locked project", async () => {
    project = await makeTempProject();
    const release = acquireProjectLock(project.ctx().paths, "test-holder");
    expect(release).toBeTruthy();

    const { ctx, deps: d } = deps(project);
    const result = await runProjectScheduler(ctx, d, { ignoreWindows: true });
    expect(result.reason).toBe("locked");
    expect(result.iterations).toBe(0);
    release?.();
  });

  it("waits outside the schedule window instead of running", async () => {
    // A window that is never 'now': pick a 1-minute window far from current time.
    const now = new Date();
    const farHour = (now.getHours() + 12) % 24;
    const windowText = `${String(farHour).padStart(2, "0")}:00-${String(farHour).padStart(2, "0")}:01`;

    project = await makeTempProject({ schedule: { windows: [windowText] } });
    project.setCrew(["Anything"]);
    project.setScript([{ match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" }]);

    const { ctx, deps: d } = deps(project);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    await runProjectScheduler(ctx, d, { signal: controller.signal, pollMs: 50 });

    expect(readHistory(project.ctx().paths)).toHaveLength(0); // never ran
  });
});

describe("crew daemon", () => {
  it("fails a Codex project before starting work when auth is missing", async () => {
    project = await makeTempProject();
    project.setConfig({ provider: { default: "codex" } });
    project.setScript([{ match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" }]);
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = join(project.home, "missing-codex");

    try {
      const output = await captureConsole(() =>
        runCli(["crew", "start", "--projects", "demo", "--now", "--poll", "50"]),
      );

      expect(process.exitCode).toBe(1);
      expect(output).toContain("codex login");
      expect(output).toContain("0 iterations");
      expect(readHistory(project.ctx().paths)).toHaveLength(0);
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });

  it("drives every registered project concurrently", async () => {
    // Two projects; the second one's NIGHTCREW_HOME is the daemon's registry,
    // so register the first project there too (distinct name).
    const alpha = await makeTempProject();
    extraProjects.push(alpha);
    alpha.setConfig({ project: { name: "alpha", baseBranch: "main" } });
    alpha.setScript([{ match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" }]);

    project = await makeTempProject(); // registers "demo" in the fresh home
    project.setScript([{ match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" }]);
    registerProject("alpha", alpha.root);

    const controller = new AbortController();
    const seen = new Set<string>();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const result = await runCrewDaemon({
      signal: controller.signal,
      pollMs: 50,
      ignoreWindows: true,
      onRecord: (record) => {
        seen.add(record.projectName);
        if (seen.has("alpha") && seen.has("demo")) controller.abort();
      },
    });
    clearTimeout(timeout);

    expect(seen).toEqual(new Set(["alpha", "demo"]));
    expect(result.projects).toHaveLength(2);
    expect(result.projects.every((p) => !p.error)).toBe(true);
    expect(readHistory(alpha.ctx().paths).length).toBeGreaterThanOrEqual(1);
    expect(readHistory(project.ctx().paths).length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
