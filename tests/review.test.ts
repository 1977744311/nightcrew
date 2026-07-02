import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseVerdict } from "../src/review/agent";
import { readHistory } from "../src/state/history";
import { readState } from "../src/state/state";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject;

afterEach(() => {
  project?.cleanup();
});

describe("parseVerdict", () => {
  it("accepts raw, fenced, and embedded JSON", () => {
    expect(parseVerdict('{"verdict":"approve","notes":""}')).toEqual({
      verdict: "approve",
      notes: "",
    });
    expect(parseVerdict('```json\n{"verdict":"request_changes","notes":"fix x"}\n```')).toEqual({
      verdict: "request_changes",
      notes: "fix x",
    });
    expect(
      parseVerdict('Here is my verdict: {"verdict":"escalate","notes":"scope"} thanks'),
    ).toEqual({
      verdict: "escalate",
      notes: "scope",
    });
    expect(parseVerdict("LGTM!")).toBeNull();
    expect(parseVerdict('{"verdict":"lgtm","notes":""}')).toBeNull();
  });
});

const GATE = { review: { mode: "gate", planReview: true, mergeReview: true, maxReviewRounds: 2 } };
const PLAN_ID = "2026-07-02-reviewed";
const PLAN_PATH = `.nightcrew/plans/active/${PLAN_ID}.md`;

function planEntry() {
  return {
    match: "operation = \\*\\*plan\\*\\*",
    actions: [
      {
        type: "write" as const,
        path: PLAN_PATH,
        content: planFileContents(PLAN_ID, "Reviewed feature"),
      },
    ],
  };
}

function executeComplete(extraFile: string) {
  return {
    match: "operation = \\*\\*execute\\*\\*",
    actions: [
      { type: "write" as const, path: extraFile, content: "work\n" },
      {
        type: "write" as const,
        path: PLAN_PATH,
        content: planFileContents(PLAN_ID, "Reviewed feature").replace("- [ ]", "- [x]"),
      },
    ],
    finalMessage: "PLAN COMPLETE",
  };
}

function verdictEntry(point: "plan" | "merge", verdict: string, notes: string) {
  return {
    match: point === "plan" ? "independent plan reviewer" : "independent merge reviewer",
    finalMessage: JSON.stringify({ verdict, notes }),
  };
}

describe("review agent (gate mode)", () => {
  it("green path: both reviews approve and the plan lands", async () => {
    project = await makeTempProject({ ...GATE, loop: { backoffMs: [0] } });
    project.setCrew(["Ship reviewed feature"]);
    project.setScript([
      planEntry(),
      verdictEntry("plan", "approve", ""),
      executeComplete("src/reviewed.txt"),
      verdictEntry("merge", "approve_with_notes", "consider a test later"),
    ]);

    const planRecord = await project.run();
    expect(planRecord.status).toBe("success");
    expect(planRecord.reviews?.[0]?.verdict).toBe("approve");

    const execRecord = await project.run();
    expect(execRecord.merged).toBe(true);
    expect(execRecord.reviews?.some((r) => r.verdict === "approve_with_notes")).toBe(true);
    expect(existsSync(join(project.root, "src/reviewed.txt"))).toBe(true);
  });

  it("plan review request_changes reverts the plan file and records the failure", async () => {
    project = await makeTempProject(GATE);
    project.setCrew(["Something small"]);
    project.setScript([
      planEntry(),
      verdictEntry("plan", "request_changes", "not covered by any BACKLOG item"),
    ]);

    const record = await project.run();
    expect(record.status).toBe("failed");
    expect(record.failure?.kind).toBe("review_rejected");
    expect(existsSync(join(project.root, PLAN_PATH))).toBe(false);
    // The rejection reason is queued for the operator/next planner.
    const questions = readFileSync(project.ctx().paths.questionsFile, "utf8");
    expect(questions).toContain("not covered by any BACKLOG item");
  });

  it("merge review request_changes feeds notes into repair, then lands on round 2", async () => {
    project = await makeTempProject({ ...GATE, loop: { backoffMs: [0] } });
    project.setCrew(["Reviewed feature"]);
    project.setScript([
      planEntry(),
      verdictEntry("plan", "approve", ""),
      executeComplete("src/half-done.txt"),
      verdictEntry("merge", "request_changes", "acceptance box checked but file X is missing"),
      {
        match: "Reviewer notes to address",
        actions: [
          { type: "write" as const, path: "src/file-x.txt", content: "the missing file\n" },
        ],
        finalMessage: "PLAN COMPLETE",
      },
      verdictEntry("merge", "approve", ""),
    ]);

    const result = await project.loop({ maxIterations: 6 });
    const records = readHistory(project.ctx().paths);
    const rejected = records.find((r) => r.failure?.kind === "review_rejected");
    expect(rejected).toBeTruthy();
    const repair = records.find((r) => r.operation === "repair");
    expect(repair?.merged).toBe(true);
    expect(existsSync(join(project.root, "src/file-x.txt"))).toBe(true);
    expect(result.stop?.reason).toBe("idle"); // finished everything, then idled
  });

  it("escalates after max review rounds and stops for the operator", async () => {
    project = await makeTempProject({ ...GATE, loop: { backoffMs: [0] } });
    project.setCrew(["Stubborn feature"]);
    project.setScript([
      planEntry(),
      verdictEntry("plan", "approve", ""),
      executeComplete("src/attempt1.txt"),
      verdictEntry("merge", "request_changes", "round 1: wrong"),
      {
        match: "Reviewer notes to address",
        actions: [{ type: "append" as const, path: "src/attempt1.txt", content: "retry\n" }],
        finalMessage: "PLAN COMPLETE",
      },
      verdictEntry("merge", "request_changes", "round 2: still wrong"),
    ]);

    const result = await project.loop({ maxIterations: 6 });
    expect(result.stop?.reason).toBe("review_escalated");
    const questions = readFileSync(project.ctx().paths.questionsFile, "utf8");
    expect(questions).toContain("max rounds");
    // Branch preserved for the operator to inspect.
    expect(readState(project.ctx().paths).stop?.reason).toBe("review_escalated");
  });

  it("advisory mode records verdicts without blocking", async () => {
    project = await makeTempProject({
      review: { mode: "advisory", planReview: true, mergeReview: true, maxReviewRounds: 2 },
      loop: { backoffMs: [0] },
    });
    project.setCrew(["Advisory feature"]);
    project.setScript([
      planEntry(),
      verdictEntry("plan", "request_changes", "would reject in gate mode"),
      executeComplete("src/advisory.txt"),
      verdictEntry("merge", "request_changes", "would block in gate mode"),
    ]);

    const planRecord = await project.run();
    expect(planRecord.status).toBe("success"); // advisory: noted, not blocked
    expect(planRecord.notes?.join(" ")).toContain("would reject in gate mode");

    const execRecord = await project.run();
    expect(execRecord.status).toBe("success");
    expect(execRecord.merged).toBe(true);
    expect(execRecord.notes?.join(" ")).toContain("would block in gate mode");
  });

  it("escalates when the reviewer talks prose twice instead of JSON", async () => {
    project = await makeTempProject(GATE);
    project.setCrew(["Mute reviewer"]);
    project.setScript([
      planEntry(),
      { match: "independent plan reviewer", finalMessage: "Looks good to me!" },
      { match: "independent plan reviewer", finalMessage: "I said it looks good!" },
    ]);

    const record = await project.run();
    expect(record.status).toBe("failed");
    expect(record.failure?.kind).toBe("review_rejected");
    expect(record.reviews?.[0]?.verdict).toBe("escalate");
  });
});
