import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPlans } from "../src/plans/plans";
import { summarizeBudget } from "../src/policy/budget";
import type { FakeScriptEntry } from "../src/providers/fake";
import { readHistory } from "../src/state/history";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject;

afterEach(() => {
  project?.cleanup();
});

describe("unattended stress run", () => {
  it("survives 20+ mixed iterations: plans, executes, gardens, one failure, then idle", async () => {
    project = await makeTempProject({
      loop: { backoffMs: [0], gardenEvery: 5 },
      verify: {
        profile: "default",
        profiles: { default: { steps: [{ name: "smoke", run: "test -f README.md" }] } },
      },
    });

    const FEATURES = 8;
    project.setCrew(Array.from({ length: FEATURES }, (_, i) => `Ship feature ${i + 1}`));

    const script: FakeScriptEntry[] = [];
    for (let i = 1; i <= FEATURES; i += 1) {
      const id = `2026-07-02-feature-${String(i).padStart(2, "0")}`;
      script.push({
        match: "operation = \\*\\*plan\\*\\*",
        actions: [
          {
            type: "write",
            path: `.nightcrew/plans/active/${id}.md`,
            content: planFileContents(id, `Feature ${i}`),
          },
        ],
      });
      if (i === 4) {
        // Feature 4 stumbles once before completing: a realistic night.
        script.push({
          match: id,
          status: "error",
          errorMessage: "transient provider failure",
        });
        script.push({
          match: id,
          actions: [
            { type: "write", path: `src/feature-${i}.txt`, content: `feature ${i}\n` },
            {
              type: "write",
              path: `.nightcrew/plans/active/${id}.md`,
              content: planFileContents(id, `Feature ${i}`).replace("- [ ]", "- [x]"),
            },
          ],
          finalMessage: "PLAN COMPLETE",
        });
      } else {
        script.push({
          match: id,
          actions: [
            { type: "write", path: `src/feature-${i}.txt`, content: `feature ${i}\n` },
            {
              type: "write",
              path: `.nightcrew/plans/active/${id}.md`,
              content: planFileContents(id, `Feature ${i}`).replace("- [ ]", "- [x]"),
            },
          ],
          finalMessage: "PLAN COMPLETE",
        });
      }
    }
    // Garden passes triggered every 5 iterations.
    for (let g = 0; g < 6; g += 1) {
      script.push({
        match: "operation = \\*\\*garden\\*\\*",
        actions: [
          { type: "append", path: ".nightcrew/qa.md", content: `\n<!-- garden ${g} -->\n` },
        ],
      });
    }
    script.push({ match: "operation = \\*\\*plan\\*\\*", finalMessage: "IDLE" });
    project.setScript(script);

    const result = await project.loop({ maxIterations: 40 });

    expect(result.stop?.reason).toBe("idle");
    expect(result.iterations).toBeGreaterThanOrEqual(20);

    // Every feature landed on main.
    for (let i = 1; i <= FEATURES; i += 1) {
      expect(existsSync(join(project.root, `src/feature-${i}.txt`))).toBe(true);
    }
    expect(listPlans(project.ctx().paths, "completed")).toHaveLength(FEATURES);
    expect(listPlans(project.ctx().paths, "active")).toHaveLength(0);

    const records = readHistory(project.ctx().paths);
    // The transient failure was repaired, not fatal.
    expect(records.some((r) => r.status === "failed")).toBe(true);
    expect(records.filter((r) => r.operation === "garden").length).toBeGreaterThanOrEqual(3);
    expect(records.filter((r) => r.merged)).toHaveLength(FEATURES);

    // The ledger accounted every provider call.
    const budget = summarizeBudget(records);
    expect(budget.totalTokens).toBeGreaterThan(0);
    expect(budget.iterations).toBe(records.length);

    // No worktrees left behind after a clean night.
    const { readdirSync } = await import("node:fs");
    const worktreesDir = project.ctx().paths.worktreesDir;
    const leftovers = existsSync(worktreesDir) ? readdirSync(worktreesDir) : [];
    expect(leftovers).toHaveLength(0);
  }, 120_000);
});
