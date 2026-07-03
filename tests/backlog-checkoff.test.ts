import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPlans, readPlan, validatePlan } from "../src/plans/plans";
import { readHistory } from "../src/state/history";
import { gitSync, makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject | undefined;

afterEach(() => {
  project?.cleanup();
  project = undefined;
});

function planEntry(id: string, title: string, backlog: string) {
  return {
    match: "operation = \\*\\*plan\\*\\*",
    actions: [
      {
        type: "write" as const,
        path: `.nightcrew/plans/active/${id}.md`,
        content: planFileContents(id, title, { backlog }),
      },
    ],
  };
}

function completeEntry(id: string, title: string, backlog: string, file: string) {
  return {
    match: "operation = \\*\\*execute\\*\\*",
    actions: [
      { type: "write" as const, path: file, content: "done\n" },
      {
        type: "write" as const,
        path: `.nightcrew/plans/active/${id}.md`,
        content: planFileContents(id, title, { backlog }).replace("- [ ]", "- [x]"),
      },
    ],
    finalMessage: "PLAN COMPLETE",
  };
}

function overwriteCrew(markdown: string): void {
  if (!project) throw new Error("expected project");
  writeFileSync(join(project.root, ".nightcrew/crew.md"), markdown);
  gitSync(project.root, "add", ".nightcrew/crew.md");
  gitSync(project.root, "commit", "-m", "operator: update backlog");
}

describe("BACKLOG plan mapping", () => {
  it("parses the optional backlog field and validates one unchecked crew item", async () => {
    project = await makeTempProject();
    project.setCrew(["Ship mapped work"]);
    const file = join(project.root, ".nightcrew/plans/active/2026-07-03-mapped.md");
    writeFileSync(
      file,
      planFileContents("2026-07-03-mapped", "Mapped work", { backlog: "Ship mapped work" }),
    );

    const plan = readPlan(file, "active");
    if (!plan) throw new Error("expected plan");

    expect(plan.backlog).toBe("Ship mapped work");
    expect(
      validatePlan(plan, { crew: readFileSync(project.ctx().paths.crewFile, "utf8") }),
    ).toEqual([]);
    expect(validatePlan(plan, { crew: "## BACKLOG\n\n- [ ] Something else\n" })).toContain(
      'plan frontmatter backlog must match exactly one unchecked BACKLOG item; found 0 for "Ship mapped work"',
    );
  });

  it("rejects a newly authored plan whose backlog mapping is not unique", async () => {
    project = await makeTempProject();
    const id = "2026-07-03-ambiguous";
    overwriteCrew(
      [
        "# Crew Directives",
        "",
        "## Rules",
        "",
        "- keep it honest",
        "",
        "## BACKLOG",
        "",
        "- [ ] Ambiguous work",
        "- [ ] Ambiguous work",
        "",
      ].join("\n"),
    );
    project.setScript([planEntry(id, "Ambiguous", "Ambiguous work")]);

    const record = await project.run({ operation: "plan" });

    expect(record.status).toBe("failed");
    expect(record.failure?.kind).toBe("plan_invalid");
    expect(record.failure?.message).toContain("found 2");
    expect(existsSync(join(project.root, `.nightcrew/plans/active/${id}.md`))).toBe(false);
  });

  it("checks off the uniquely matched unchecked BACKLOG line after a successful merge", async () => {
    project = await makeTempProject();
    const id = "2026-07-03-checkoff";
    project.setCrew(["Ship checkoff work"]);
    project.setScript([
      planEntry(id, "Checkoff", "Ship checkoff work"),
      completeEntry(id, "Checkoff", "Ship checkoff work", "src/checkoff.txt"),
    ]);

    await project.run({ operation: "plan" });
    const record = await project.run({ operation: "execute" });

    expect(record.merged).toBe(true);
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toContain(
      "- [x] Ship checkoff work",
    );
    expect(record.notes?.join("\n")).toContain('checked off BACKLOG item: "Ship checkoff work"');
    expect(listPlans(project.ctx().paths, "completed").map((plan) => plan.id)).toContain(id);
  });

  it("records a note and leaves crew.md unchanged when the match disappears before merge", async () => {
    project = await makeTempProject();
    const id = "2026-07-03-missing";
    project.setCrew(["Original mapped work"]);
    project.setScript([
      planEntry(id, "Missing", "Original mapped work"),
      completeEntry(id, "Missing", "Original mapped work", "src/missing.txt"),
    ]);

    await project.run({ operation: "plan" });
    project.setCrew(["Different work"]);
    const before = readFileSync(project.ctx().paths.crewFile, "utf8");
    const record = await project.run({ operation: "execute" });
    const after = readFileSync(project.ctx().paths.crewFile, "utf8");

    expect(record.merged).toBe(true);
    expect(after).toBe(before);
    expect(record.notes?.join("\n")).toContain(
      'BACKLOG checkoff skipped: no unchecked match for "Original mapped work"',
    );
    expect(readHistory(project.ctx().paths).at(-1)?.notes?.join("\n")).toContain(
      "BACKLOG checkoff skipped",
    );
  });

  it("records a note and leaves crew.md unchanged when the match becomes non-unique", async () => {
    project = await makeTempProject();
    const id = "2026-07-03-duplicate";
    project.setCrew(["Duplicate mapped work"]);
    project.setScript([
      planEntry(id, "Duplicate", "Duplicate mapped work"),
      completeEntry(id, "Duplicate", "Duplicate mapped work", "src/duplicate.txt"),
    ]);

    await project.run({ operation: "plan" });
    overwriteCrew(
      [
        "# Crew Directives",
        "",
        "## Rules",
        "",
        "- keep it honest",
        "",
        "## BACKLOG",
        "",
        "- [ ] Duplicate mapped work",
        "- [ ] Duplicate mapped work",
        "",
      ].join("\n"),
    );
    const before = readFileSync(project.ctx().paths.crewFile, "utf8");
    const record = await project.run({ operation: "execute" });
    const after = readFileSync(project.ctx().paths.crewFile, "utf8");

    expect(record.merged).toBe(true);
    expect(after).toBe(before);
    expect(record.notes?.join("\n")).toContain(
      'BACKLOG checkoff skipped: 2 unchecked matches for "Duplicate mapped work"',
    );
  });
});
