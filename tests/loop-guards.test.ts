import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHistory } from "../src/state/history";
import { readState, updateState } from "../src/state/state";
import { gitSync, makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject;

afterEach(() => {
  project?.cleanup();
});

const FAST_LOOP = {
  loop: { backoffMs: [0], gardenEvery: 50 },
};

function planEntry(id: string, title: string) {
  return {
    match: "operation = \\*\\*plan\\*\\*",
    actions: [
      {
        type: "write" as const,
        path: `.nightcrew/plans/active/${id}.md`,
        content: planFileContents(id, title),
      },
    ],
  };
}

describe("loop guards", () => {
  it("stops on max_failure_streak with backoff-driven downgrades to repair", async () => {
    project = await makeTempProject(FAST_LOOP);
    project.setCrew(["Doomed work"]);
    project.setScript([
      planEntry("2026-07-02-doomed", "Doomed"),
      { match: "operation = \\*\\*execute\\*\\*", status: "error", errorMessage: "boom 1" },
      { match: "operation = \\*\\*repair\\*\\*", status: "error", errorMessage: "boom 2" },
      { match: "operation = \\*\\*repair\\*\\*", status: "error", errorMessage: "boom 3" },
    ]);

    const result = await project.loop({ maxIterations: 10 });
    expect(result.stop?.reason).toBe("failure_streak");
    expect(result.iterations).toBe(4); // plan + execute + repair + repair

    const ops = readHistory(project.ctx().paths).map((r) => r.operation);
    expect(ops).toEqual(["plan", "execute", "repair", "repair"]);
    expect(readState(project.ctx().paths).streaks.failure).toBe(3);
  });

  it("stops on max_no_commit_streak when green runs land nothing", async () => {
    project = await makeTempProject(FAST_LOOP);
    project.setCrew(["Busy idling"]);
    project.setScript([
      planEntry("2026-07-02-noop", "Noop"),
      { match: "operation = \\*\\*execute\\*\\*", finalMessage: "CONTINUE looked around" },
      { match: "operation = \\*\\*execute\\*\\*", finalMessage: "CONTINUE still thinking" },
      { match: "operation = \\*\\*execute\\*\\*", finalMessage: "CONTINUE hmm" },
    ]);

    const result = await project.loop({ maxIterations: 10 });
    expect(result.stop?.reason).toBe("no_commit_streak");
    expect(readState(project.ctx().paths).streaks.noCommit).toBe(3);
  });

  it("stops on control_only_streak when commits never touch the product", async () => {
    project = await makeTempProject(FAST_LOOP);
    project.setCrew(["Paperwork"]);
    const planPath = ".nightcrew/plans/active/2026-07-02-paper.md";
    const tick = (n: number) => ({
      match: "operation = \\*\\*execute\\*\\*",
      actions: [
        {
          type: "append" as const,
          path: planPath,
          content: `\n<!-- paperwork pass ${n} -->\n`,
        },
      ],
      finalMessage: "CONTINUE",
    });
    project.setScript([planEntry("2026-07-02-paper", "Paper"), tick(1), tick(2), tick(3)]);

    const result = await project.loop({ maxIterations: 10 });
    expect(result.stop?.reason).toBe("control_only_streak");
    expect(readState(project.ctx().paths).streaks.controlOnly).toBe(3);
  });

  it("treats quota as scheduling: resumes after the window and finishes the plan", async () => {
    project = await makeTempProject({
      ...FAST_LOOP,
      budget: { quotaWindowHours: 0.0002 }, // ~720ms
    });
    project.setCrew(["Quota survivor"]);
    const id = "2026-07-02-quota";
    project.setScript([
      planEntry(id, "Quota survivor"),
      {
        match: "operation = \\*\\*execute\\*\\*",
        status: "quota",
        errorMessage: "usage limit reached",
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [
          { type: "write", path: "src/after-quota.txt", content: "made it\n" },
          {
            type: "write",
            path: `.nightcrew/plans/active/${id}.md`,
            content: planFileContents(id, "Quota survivor").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
      { match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" },
    ]);

    const result = await project.loop({ maxIterations: 10, pollMs: 50 });
    expect(result.stop?.reason).toBe("idle");

    const records = readHistory(project.ctx().paths);
    const quotaRecord = records.find((r) => r.status === "quota");
    expect(quotaRecord?.failure?.kind).toBe("quota_exhausted");
    // Quota never burns the failure streak.
    expect(
      records.every((r) => r.status !== "quota" || r.failure?.kind === "quota_exhausted"),
    ).toBe(true);
    expect(readState(project.ctx().paths).streaks.failure).toBe(0);
    expect(readFileSync(join(project.root, "src/after-quota.txt"), "utf8")).toBe("made it\n");
  });

  it("forces a garden pass every N iterations", async () => {
    project = await makeTempProject({ loop: { backoffMs: [0], gardenEvery: 2 } });
    project.setCrew(["Some feature"]);
    project.setScript([
      planEntry("2026-07-02-feat", "Feature"),
      {
        match: "operation = \\*\\*execute\\*\\*",
        finalMessage: "CONTINUE",
        actions: [{ type: "write", path: "src/wip.txt", content: "wip\n" }],
      },
      {
        match: "operation = \\*\\*garden\\*\\*",
        actions: [{ type: "append", path: ".nightcrew/qa.md", content: "\n<!-- tidied -->\n" }],
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        finalMessage: "CONTINUE",
        actions: [{ type: "write", path: "src/wip2.txt", content: "wip\n" }],
      },
    ]);

    await project.loop({ maxIterations: 4 });
    const ops = readHistory(project.ctx().paths).map((r) => r.operation);
    expect(ops).toEqual(["plan", "execute", "garden", "execute"]);
    // Garden success reset the counter, so iteration 4 was execute again.
    expect(readState(project.ctx().paths).iterationsSinceGarden).toBe(1);
  });

  it("pause suspends the loop; resume lets it finish", async () => {
    project = await makeTempProject(FAST_LOOP);
    project.setCrew([]);
    project.setScript([{ match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" }]);

    updateState(project.ctx().paths, (state) => {
      state.paused = true;
    });

    const controller = new AbortController();
    const loopPromise = project.loop({ maxIterations: 3, pollMs: 30, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 250));
    // Still paused: nothing ran.
    expect(readHistory(project.ctx().paths)).toHaveLength(0);

    updateState(project.ctx().paths, (state) => {
      state.paused = false;
    });
    const result = await loopPromise;
    expect(result.stop?.reason).toBe("idle");
    expect(readHistory(project.ctx().paths)).toHaveLength(1);
  });

  it("interleaved plan/garden iterations do not reset the no-commit streak", async () => {
    project = await makeTempProject({
      loop: { backoffMs: [0], gardenEvery: 3, maxNoCommitStreak: 3 },
    });
    project.setCrew(["Slippery work"]);
    project.setScript([
      planEntry("2026-07-02-slip", "Slip"),
      { match: "operation = \\*\\*execute\\*\\*", finalMessage: "CONTINUE" },
      { match: "operation = \\*\\*execute\\*\\*", finalMessage: "CONTINUE" },
      {
        match: "operation = \\*\\*garden\\*\\*",
        actions: [{ type: "append", path: ".nightcrew/qa.md", content: "\n<!-- pass -->\n" }],
      },
      { match: "operation = \\*\\*execute\\*\\*", finalMessage: "CONTINUE" },
    ]);

    const result = await project.loop({ maxIterations: 10 });
    // execute(no commit) ×2 → garden interlude → execute(no commit) = streak 3
    expect(result.stop?.reason).toBe("no_commit_streak");
    const ops = readHistory(project.ctx().paths).map((r) => r.operation);
    expect(ops).toEqual(["plan", "execute", "execute", "garden", "execute"]);
  });
});

describe("worktree recovery", () => {
  it("resumes a crashed plan from its existing worktree and branch", async () => {
    project = await makeTempProject(FAST_LOOP);
    project.setCrew(["Crash resilient"]);
    const id = "2026-07-02-crash";
    project.setScript([
      planEntry(id, "Crash resilient"),
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [{ type: "write", path: "src/part1.txt", content: "part 1\n" }],
        finalMessage: "CONTINUE",
      },
    ]);
    await project.run(); // plan
    await project.run(); // execute #1 — commits part1 on the branch

    // Simulate crash: state wiped (disposable by contract), worktree remains.
    const { rmSync } = await import("node:fs");
    rmSync(project.ctx().paths.stateFile, { force: true });

    project.setScript([
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [
          { type: "write", path: "src/part2.txt", content: "part 2\n" },
          {
            type: "write",
            path: `.nightcrew/plans/active/${id}.md`,
            content: planFileContents(id, "Crash resilient").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
    ]);
    const record = await project.run();
    expect(record.operation).toBe("execute");
    expect(record.merged).toBe(true);
    // Both parts landed — the worktree carried part 1 across the "crash".
    expect(readFileSync(join(project.root, "src/part1.txt"), "utf8")).toBe("part 1\n");
    expect(readFileSync(join(project.root, "src/part2.txt"), "utf8")).toBe("part 2\n");
  });

  it("blocks landing when the operator's checkout is dirty, preserving the branch", async () => {
    project = await makeTempProject(FAST_LOOP);
    project.setCrew(["Blocked landing"]);
    const id = "2026-07-02-blocked";
    project.setScript([
      planEntry(id, "Blocked landing"),
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [
          { type: "write", path: "src/blocked.txt", content: "ready\n" },
          {
            type: "write",
            path: `.nightcrew/plans/active/${id}.md`,
            content: planFileContents(id, "Blocked landing").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
    ]);
    await project.run(); // plan

    // Operator leaves tracked dirt on main.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(project.root, "README.md"), "# demo product (editing…)\n");

    const record = await project.run(); // execute completes but cannot land
    expect(record.status).toBe("success");
    expect(record.merged).toBe(false);
    expect(readState(project.ctx().paths).stop?.reason).toBe("operator");
    const branches = gitSync(project.root, "branch", "--list", `nightcrew/${id}`);
    expect(branches).toContain(`nightcrew/${id}`);
  });
});
