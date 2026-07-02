import { appendFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildReport, renderReport } from "../src/cli/report";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject;

afterEach(() => {
  project?.cleanup();
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
    expect(report.failures).toEqual([{ kind: "provider_error", count: 1 }]);
    expect(report.totalTokens).toBeGreaterThan(0);
    expect(report.openQuestions).toEqual(["should the feature support dark mode?"]);
    expect(report.activePlans).toHaveLength(0);
    expect(report.state.pendingRepairs).toHaveLength(0);

    const text = renderReport(report);
    expect(text).toContain("2026-07-02-ship");
    expect(text).toContain("provider_error");
    expect(text).toContain("dark mode");
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
