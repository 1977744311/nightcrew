import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPlans } from "../src/plans/plans";
import { readState } from "../src/state/state";
import { gitSync, makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject;

afterEach(() => {
  project?.cleanup();
});

const PLAN_ID = "2026-07-02-hello-feature";
const PLAN_PATH = `.nightcrew/plans/active/${PLAN_ID}.md`;

describe("single-project vertical slice", () => {
  it("runs plan → execute (worktree) → merge back, full green path", async () => {
    project = await makeTempProject();
    project.setCrew(["Ship the hello feature"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [
          { type: "write", path: PLAN_PATH, content: planFileContents(PLAN_ID, "Hello feature") },
        ],
        finalMessage: "authored plan",
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [
          { type: "write", path: "src/hello.txt", content: "hello from the crew\n" },
          {
            type: "write",
            path: PLAN_PATH,
            content: planFileContents(PLAN_ID, "Hello feature").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "done. PLAN COMPLETE",
      },
    ]);

    const planRecord = await project.run();
    expect(planRecord.operation).toBe("plan");
    expect(planRecord.status).toBe("success");
    expect(planRecord.planId).toBe(PLAN_ID);
    expect(planRecord.commits).toHaveLength(1);
    expect(readState(project.ctx().paths).activePlanId).toBe(PLAN_ID);

    const execRecord = await project.run();
    expect(execRecord.operation).toBe("execute");
    expect(execRecord.status).toBe("success");
    expect(execRecord.merged).toBe(true);
    expect(execRecord.commits.length).toBeGreaterThanOrEqual(1);

    // Landed on main:
    expect(readFileSync(join(project.root, "src/hello.txt"), "utf8")).toContain(
      "hello from the crew",
    );
    // Plan lifecycle: active → completed on main.
    expect(listPlans(project.ctx().paths, "active")).toHaveLength(0);
    expect(listPlans(project.ctx().paths, "completed").map((p) => p.id)).toContain(PLAN_ID);
    // Worktree and branch cleaned up.
    expect(existsSync(join(project.root, ".nightcrew/worktrees", PLAN_ID))).toBe(false);
    const branches = gitSync(project.root, "branch", "--list", `nightcrew/${PLAN_ID}`);
    expect(branches.trim()).toBe("");
    // Session cleared after completion.
    expect(readState(project.ctx().paths).sessions[PLAN_ID]).toBeUndefined();
  });

  it("keeps the session across iterations of the same plan", async () => {
    project = await makeTempProject();
    project.setCrew(["Two-step feature"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [
          { type: "write", path: PLAN_PATH, content: planFileContents(PLAN_ID, "Two step") },
        ],
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [{ type: "write", path: "src/step1.txt", content: "one\n" }],
        finalMessage: "CONTINUE — step 2 remains",
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [
          { type: "write", path: "src/step2.txt", content: "two\n" },
          {
            type: "write",
            path: PLAN_PATH,
            content: planFileContents(PLAN_ID, "Two step").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
    ]);

    await project.run(); // plan
    const first = await project.run(); // execute #1 (in progress)
    expect(first.status).toBe("success");
    expect(first.merged).toBe(false);
    const sessionAfterFirst = readState(project.ctx().paths).sessions[PLAN_ID];
    expect(sessionAfterFirst).toBeTruthy();

    const second = await project.run(); // execute #2 (completes)
    expect(second.merged).toBe(true);
    // Same thread resumed — the fake echoes the sessionId it was handed.
    expect(second.notes).toBeDefined();
    expect(sessionAfterFirst).toBe(
      readState(project.ctx().paths).sessions[PLAN_ID] ?? sessionAfterFirst,
    );
  });

  it("fails verify, downgrades to repair, then lands", async () => {
    project = await makeTempProject({
      verify: {
        profile: "default",
        profiles: { default: { steps: [{ name: "fixed-exists", run: "test -f src/fixed.txt" }] } },
      },
    });
    project.setCrew(["Fix the thing"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [
          { type: "write", path: PLAN_PATH, content: planFileContents(PLAN_ID, "Fix the thing") },
        ],
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [{ type: "write", path: "src/broken.txt", content: "not it\n" }],
        finalMessage: "CONTINUE",
      },
      {
        match: "operation = \\*\\*repair\\*\\*",
        actions: [
          { type: "write", path: "src/fixed.txt", content: "fixed\n" },
          {
            type: "write",
            path: PLAN_PATH,
            content: planFileContents(PLAN_ID, "Fix the thing").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
    ]);

    await project.run(); // plan
    const failed = await project.run(); // execute → verify fails
    expect(failed.status).toBe("failed");
    expect(failed.failure?.kind).toBe("verify_failed");
    expect(failed.verify?.passed).toBe(false);

    const state = readState(project.ctx().paths);
    expect(state.pendingRepair?.reason).toBe("verify_failed");
    expect(state.streaks.failure).toBe(1);

    const repaired = await project.run(); // auto-resolves to repair
    expect(repaired.operation).toBe("repair");
    expect(repaired.status).toBe("success");
    expect(repaired.merged).toBe(true);
    expect(readState(project.ctx().paths).streaks.failure).toBe(0);
    expect(readState(project.ctx().paths).pendingRepair).toBeUndefined();
  });

  it("types idle_timeout and timeout failures distinctly", async () => {
    project = await makeTempProject({
      loop: { idleTimeoutMs: 250, iterationTimeoutMs: 60_000 },
    });
    project.setCrew(["Anything"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [{ type: "write", path: PLAN_PATH, content: planFileContents(PLAN_ID, "Stall") }],
      },
      { match: "operation = \\*\\*execute\\*\\*", silentMs: 5_000 },
    ]);
    await project.run();
    const stalled = await project.run();
    expect(stalled.status).toBe("failed");
    expect(stalled.failure?.kind).toBe("idle_timeout");
    expect(readState(project.ctx().paths).pendingRepair?.reason).toBe("idle_timeout");

    project.cleanup();
    project = await makeTempProject({
      loop: { idleTimeoutMs: 60_000, iterationTimeoutMs: 250 },
    });
    project.setCrew(["Anything"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [{ type: "write", path: PLAN_PATH, content: planFileContents(PLAN_ID, "Hang") }],
      },
      { match: "operation = \\*\\*execute\\*\\*", silentMs: 5_000 },
    ]);
    await project.run();
    const hung = await project.run();
    expect(hung.status).toBe("failed");
    expect(hung.failure?.kind).toBe("timeout");
  });

  it("hits a merge conflict, repairs it in the worktree, then lands", async () => {
    project = await makeTempProject();
    project.setCrew(["Write data file"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [
          { type: "write", path: PLAN_PATH, content: planFileContents(PLAN_ID, "Data file") },
        ],
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [{ type: "write", path: "data.txt", content: "crew version\n" }],
        finalMessage: "CONTINUE",
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [
          {
            type: "write",
            path: PLAN_PATH,
            content: planFileContents(PLAN_ID, "Data file").replace("- [ ]", "- [x]"),
          },
        ],
        finalMessage: "PLAN COMPLETE",
      },
      {
        match: "operation = \\*\\*repair\\*\\*",
        actions: [
          { type: "exec", command: "git merge main || true" },
          { type: "write", path: "data.txt", content: "resolved: crew + operator\n" },
          { type: "commit", message: "resolve merge conflict with main" },
        ],
        finalMessage: "PLAN COMPLETE",
      },
    ]);

    await project.run(); // plan
    await project.run(); // execute #1 writes data.txt on the branch

    // Base moved overnight: operator lands a conflicting file on main.
    writeFileSync(join(project.root, "data.txt"), "operator version\n");
    gitSync(project.root, "add", "data.txt");
    gitSync(project.root, "commit", "-m", "operator: conflicting data file");

    const conflicted = await project.run(); // execute #2 completes → merge conflicts
    expect(conflicted.status).toBe("failed");
    expect(conflicted.failure?.kind).toBe("merge_conflict");
    expect(readState(project.ctx().paths).pendingRepair?.reason).toBe("merge_conflict");

    const repaired = await project.run(); // repair merges main into the worktree and resolves
    expect(repaired.operation).toBe("repair");
    expect(repaired.status).toBe("success");
    expect(repaired.merged).toBe(true);
    expect(readFileSync(join(project.root, "data.txt"), "utf8")).toBe(
      "resolved: crew + operator\n",
    );
  });

  it("goes idle when the BACKLOG authorizes nothing", async () => {
    project = await makeTempProject();
    project.setScript([{ match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" }]);
    const record = await project.run();
    expect(record.operation).toBe("plan");
    expect(record.status).toBe("idle");
    expect(readState(project.ctx().paths).stop?.reason).toBe("idle");
  });

  it("reverts control-scope violations from a plan run", async () => {
    project = await makeTempProject();
    project.setCrew(["Sneaky work"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [
          { type: "write", path: PLAN_PATH, content: planFileContents(PLAN_ID, "Sneaky") },
          { type: "write", path: "src/evil.txt", content: "should not exist\n" },
        ],
      },
    ]);
    const record = await project.run();
    expect(record.status).toBe("failed");
    expect(record.failure?.kind).toBe("write_scope_violation");
    expect(existsSync(join(project.root, "src/evil.txt"))).toBe(false);
    // The plan file was reverted too — nothing half-authorized survives.
    expect(listPlans(project.ctx().paths, "active")).toHaveLength(0);
  });

  it("protects crew.md from the agent inside the worktree", async () => {
    project = await makeTempProject();
    project.setCrew(["Honest work"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [{ type: "write", path: PLAN_PATH, content: planFileContents(PLAN_ID, "Honest") }],
      },
      {
        match: "operation = \\*\\*execute\\*\\*",
        actions: [
          { type: "write", path: "src/ok.txt", content: "fine\n" },
          { type: "write", path: ".nightcrew/crew.md", content: "# hijacked directives\n" },
        ],
        finalMessage: "CONTINUE",
      },
    ]);
    await project.run();
    const record = await project.run();
    expect(record.status).toBe("failed");
    expect(record.failure?.kind).toBe("write_scope_violation");
    const worktreeCrew = readFileSync(
      join(project.root, ".nightcrew/worktrees", PLAN_ID, ".nightcrew/crew.md"),
      "utf8",
    );
    expect(worktreeCrew).not.toContain("hijacked");
  });
});
