import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { maybeTriageQa } from "../src/loop/triage";
import { listPendingProposals, selectProposalItems } from "../src/proposals/proposals";
import { buildProvider } from "../src/providers/factory";
import { readState } from "../src/state/state";
import { gitSync, makeTempProject, type TestProject } from "./helpers";

let project: TestProject | undefined;

afterEach(() => {
  project?.cleanup();
  project = undefined;
});

function setQa(proj: TestProject, bullets: string[]): void {
  const lines = bullets.map((bullet) => `- ${bullet}`).join("\n");
  writeFileSync(
    join(proj.root, ".nightcrew", "qa.md"),
    `# QA\n\nDefects observed by you or the crew.\n\n${lines}\n`,
  );
  gitSync(proj.root, "add", ".nightcrew/qa.md");
  gitSync(proj.root, "commit", "-m", "record defects");
}

function qaTriageScriptEntry() {
  return {
    match: "QA Inbox",
    structuredOutput: {
      candidates: [
        {
          title: "Fix login crash",
          body: [
            "- [ ] Fix the login crash on empty password.",
            "      Guard the empty case before hashing.",
            "      Regression test included.",
          ].join("\n"),
          rationale: "reported in qa.md",
        },
      ],
    },
    expectReadOnly: true,
  };
}

async function triage(proj: TestProject): Promise<string> {
  const ctx = proj.ctx();
  return await maybeTriageQa(ctx, buildProvider(ctx.config, ctx.root));
}

describe("qa auto-triage", () => {
  it("drafts qa bullets into a pending qa-sourced proposal exactly once per content state", async () => {
    project = await makeTempProject();
    setQa(project, ["login crashes on empty password"]);
    project.setScript([qaTriageScriptEntry()]);

    expect(await triage(project)).toBe("proposed");

    const pending = listPendingProposals(project.ctx().paths);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposal).toMatchObject({
      goal: "qa triage",
      source: "qa",
    });
    expect(pending[0]?.proposal.items[0]?.title).toBe("Fix login crash");
    expect(readState(project.ctx().paths).qaTriage?.hash).toBeTruthy();

    // Same qa.md content: no second provider call, no new artifact.
    project.setScript([qaTriageScriptEntry()]);
    expect(await triage(project)).toBe("skipped");
    expect(listPendingProposals(project.ctx().paths)).toHaveLength(1);
    expect(existsSync(`${project.scriptFile}.cursor.json`)).toBe(false);
  });

  it("waits while a qa proposal is pending, re-triages after approval when qa.md changed", async () => {
    project = await makeTempProject();
    project.setCrew(["Existing item"]);
    setQa(project, ["login crashes on empty password"]);
    project.setScript([qaTriageScriptEntry()]);
    expect(await triage(project)).toBe("proposed");

    // New defect lands while the first draft awaits review: defer.
    setQa(project, ["login crashes on empty password", "logout button dead on Safari"]);
    project.setScript([qaTriageScriptEntry()]);
    expect(await triage(project)).toBe("skipped");

    // Operator approves the pending draft; the new content now triages.
    selectProposalItems(project.ctx().paths, { ids: ["1"] });
    expect(await triage(project)).toBe("proposed");
    expect(listPendingProposals(project.ctx().paths)).toHaveLength(1);
  });

  it("skips without qa bullets and records failed attempts without retry storms", async () => {
    project = await makeTempProject();
    expect(await triage(project)).toBe("skipped");
    expect(readState(project.ctx().paths).qaTriage).toBeUndefined();

    setQa(project, ["flaky spinner"]);
    project.setScript([{ match: "QA Inbox", status: "error", errorMessage: "provider exploded" }]);
    expect(await triage(project)).toBe("failed");
    expect(listPendingProposals(project.ctx().paths)).toHaveLength(0);

    // Failure is remembered per content hash: no retry until qa.md changes.
    project.setScript([qaTriageScriptEntry()]);
    expect(await triage(project)).toBe("skipped");

    setQa(project, ["flaky spinner", "new defect"]);
    expect(await triage(project)).toBe("proposed");
  });

  it("runs inside the loop before iterations", async () => {
    project = await makeTempProject();
    setQa(project, ["login crashes on empty password"]);
    project.setScript([qaTriageScriptEntry()]);

    const result = await project.loop({ maxIterations: 1 });

    expect(result.iterations).toBe(1);
    const pending = listPendingProposals(project.ctx().paths);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposal.source).toBe("qa");
  });
});
