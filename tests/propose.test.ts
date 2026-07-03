import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/program";
import { reviewProposal, runPropose } from "../src/cli/propose";
import {
  listPendingProposals,
  readProposalArtifact,
  writeProposalArtifact,
} from "../src/proposals/proposals";
import { makeTempProject, type TestProject } from "./helpers";

let project: TestProject | undefined;

function requireProject(): TestProject {
  if (!project) throw new Error("test project was not initialized");
  return project;
}

async function captureConsole(
  action: (captured: { stdout: () => string; stderr: () => string }) => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const captured = {
    stdout: () => stdout.join("\n"),
    stderr: () => stderr.join("\n"),
  };
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
  try {
    await action(captured);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function candidate(title: string, lens: string) {
  return {
    title,
    body: [
      `- [ ] ${title}: implement the ${lens} proposal path.`,
      "      Keep the change reviewable and bounded.",
      "      Tests included.",
    ].join("\n"),
    rationale: `${lens} rationale`,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function proposalScriptEntries(model: string) {
  return [
    {
      match: "minimal path",
      structuredOutput: { candidates: [candidate("Minimal candidate", "minimal")] },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: model,
    },
    {
      match: "architecture-first",
      structuredOutput: { candidates: [candidate("Architecture candidate", "architecture")] },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: model,
    },
    {
      match: "risk-first",
      structuredOutput: { candidates: [candidate("Risk candidate", "risk")] },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: model,
    },
  ];
}

function refinementScriptEntries(input: {
  model: string;
  feedback: string;
  previousTitle: string;
}) {
  const feedback = escapeRegex(input.feedback);
  const previousTitle = escapeRegex(input.previousTitle);
  const previousSummary = `Previous candidate summaries:.*1\\. ${previousTitle} \\[minimal_path\\]`;
  return [
    {
      match: `(?=.*minimal path)(?=.*${previousSummary})(?=.*Operator feedback:.*${feedback})`,
      structuredOutput: { candidates: [candidate("Refined minimal", "refined minimal")] },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: input.model,
    },
    {
      match: `(?=.*architecture-first)(?=.*${previousSummary})(?=.*Operator feedback:.*${feedback})`,
      structuredOutput: {
        candidates: [candidate("Refined architecture", "refined architecture")],
      },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: input.model,
    },
    {
      match: `(?=.*risk-first)(?=.*${previousSummary})(?=.*Operator feedback:.*${feedback})`,
      structuredOutput: { candidates: [candidate("Refined risk", "refined risk")] },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: input.model,
    },
  ];
}

afterEach(() => {
  project?.cleanup();
  project = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("nightcrew propose", () => {
  it("generates one stable artifact from three structured read-only fake-provider passes", async () => {
    project = await makeTempProject();
    project.setConfig({
      provider: {
        default: "fake",
        fake: { script: project.scriptFile },
        codex: { tiers: { heavy: "proposal-heavy" } },
      },
      routing: { propose: "heavy" },
    });
    project.setScript(proposalScriptEntries("proposal-heavy"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T09:00:00.000Z"));

    const output = await captureConsole(() =>
      runCli(["propose", "Add proposal workflow", "--root", project?.root ?? ""]),
    );

    const relPath = ".nightcrew/proposals/2026-07-03-add-proposal-workflow.json";
    const file = join(project.root, relPath);
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain(`created ${relPath}`);
    expect(output.stdout).toContain("1. Minimal candidate");
    expect(output.stdout).toContain("3. Risk candidate");
    expect(output.stdout).toContain("select with: nightcrew propose select --ids 1,3");

    const artifact = readProposalArtifact(file);
    expect(artifact).toMatchObject({
      version: 1,
      id: "2026-07-03-add-proposal-workflow",
      goal: "Add proposal workflow",
      status: "pending",
      routingTier: "heavy",
    });
    expect(artifact.items.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(artifact.items.map((item) => item.lens)).toEqual([
      "minimal_path",
      "architecture_first",
      "risk_first",
    ]);
    expect(artifact.passes).toHaveLength(3);

    project.setScript(proposalScriptEntries("proposal-heavy"));
    await captureConsole(() =>
      runCli(["propose", "Add proposal workflow", "--root", project?.root ?? ""]),
    );
    expect(listPendingProposals(project.ctx().paths).map((entry) => entry.file)).toEqual([file]);
  });

  it("selects generated proposal items through the interactive helper and archives the artifact", async () => {
    project = await makeTempProject();
    project.setConfig({
      provider: {
        default: "fake",
        fake: { script: project.scriptFile },
        codex: { tiers: { light: "proposal-light" } },
      },
    });
    project.setScript(proposalScriptEntries("proposal-light"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T09:30:00.000Z"));

    let stdoutBeforePrompt = "";
    const output = await captureConsole(async (captured) => {
      await runPropose(requireProject().ctx(), "Add interactive selection", {
        isTty: true,
        prompt: async (proposal) => {
          stdoutBeforePrompt = captured.stdout();
          expect(proposal.items.map((item) => item.id)).toEqual(["1", "2", "3"]);
          return ["2"];
        },
      });
    });

    const relPath = ".nightcrew/proposals/2026-07-03-add-interactive-selection.json";
    const file = join(project.root, relPath);
    const archived = join(
      project.ctx().paths.archivedProposalsDir,
      "2026-07-03-add-interactive-selection.json",
    );
    const crew = readFileSync(project.ctx().paths.crewFile, "utf8");
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain(`created ${relPath}`);
    expect(stdoutBeforePrompt).toContain("1. Minimal candidate");
    expect(stdoutBeforePrompt).toContain("source lens: minimal_path");
    expect(stdoutBeforePrompt).toContain(candidate("Minimal candidate", "minimal").body);
    expect(stdoutBeforePrompt).toContain("3. Risk candidate");
    expect(stdoutBeforePrompt).toContain("source lens: risk_first");
    expect(stdoutBeforePrompt).toContain(candidate("Risk candidate", "risk").body);
    expect(output.stdout).toContain("selected 1 item");
    expect(output.stdout).toContain("archived .nightcrew/proposals/archive/");
    expect(crew).toContain(candidate("Architecture candidate", "architecture").body);
    expect(crew).not.toContain(candidate("Minimal candidate", "minimal").body);
    expect(crew).not.toContain(candidate("Risk candidate", "risk").body);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(archived)).toBe(true);
  });

  it("refines the latest pending proposal with feedback and archives the source", async () => {
    project = await makeTempProject();
    project.setConfig({
      provider: {
        default: "fake",
        fake: { script: project.scriptFile },
        codex: { tiers: { light: "proposal-light" } },
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T09:45:00.000Z"));
    const older = writeProposalArtifact(project.ctx().paths, {
      goal: "A older proposal",
      routingTier: "light",
      passes: [],
      items: [{ ...candidate("Older minimal", "older"), lens: "minimal_path" }],
    });
    const latest = writeProposalArtifact(project.ctx().paths, {
      goal: "Z latest proposal",
      routingTier: "light",
      passes: [],
      items: [
        { ...candidate("Source minimal", "source minimal"), lens: "minimal_path" },
        { ...candidate("Source architecture", "source architecture"), lens: "architecture_first" },
      ],
    });
    const feedback = "Keep the implementation smaller and preserve lineage.";
    project.setScript(
      refinementScriptEntries({
        model: "proposal-light",
        feedback,
        previousTitle: "Source minimal",
      }),
    );

    const output = await captureConsole(() =>
      runCli(["propose", "refine", "--feedback", feedback, "--root", project?.root ?? ""]),
    );

    const refinedFile = join(
      project.root,
      ".nightcrew/proposals",
      `${latest.proposal.id}-refined.json`,
    );
    const archivedSource = join(
      project.ctx().paths.archivedProposalsDir,
      `${latest.proposal.id}.json`,
    );
    const refined = readProposalArtifact(refinedFile);
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain(
      `refined .nightcrew/proposals/${latest.proposal.id}-refined.json`,
    );
    expect(output.stdout).toContain(
      `archived .nightcrew/proposals/archive/${latest.proposal.id}.json`,
    );
    expect(output.stdout).toContain("1. Refined minimal");
    expect(output.stdout).toContain(
      `select with: nightcrew propose select --ids 1,3 --proposal ${latest.proposal.id}-refined`,
    );
    expect(refined).toMatchObject({
      id: `${latest.proposal.id}-refined`,
      goal: latest.proposal.goal,
      status: "pending",
      routingTier: "light",
      refinedFrom: latest.proposal.id,
      feedback,
    });
    expect(refined.items.map((item) => item.lens)).toEqual([
      "minimal_path",
      "architecture_first",
      "risk_first",
    ]);
    expect(refined.passes).toHaveLength(3);
    expect(existsSync(older.file)).toBe(true);
    expect(existsSync(latest.file)).toBe(false);
    expect(existsSync(archivedSource)).toBe(true);
    expect(existsSync(refinedFile)).toBe(true);
  });

  it("prompts for feedback on zero TTY selections, refines, and reopens the picker", async () => {
    project = await makeTempProject();
    project.setConfig({
      provider: {
        default: "fake",
        fake: { script: project.scriptFile },
        codex: { tiers: { light: "proposal-light" } },
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T09:50:00.000Z"));
    const { file, proposal } = writeProposalArtifact(project.ctx().paths, {
      goal: "Retry proposal feedback",
      routingTier: "light",
      passes: [],
      items: [{ ...candidate("Source minimal", "source minimal"), lens: "minimal_path" }],
    });
    const feedback = "Focus on the lower-risk path.";
    project.setScript(
      refinementScriptEntries({
        model: "proposal-light",
        feedback,
        previousTitle: "Source minimal",
      }),
    );

    const promptedProposalIds: string[] = [];
    const feedbackResponses = [feedback, ""];
    const output = await captureConsole(async () => {
      await reviewProposal(
        requireProject().ctx(),
        { file: proposal.id },
        {
          isTty: true,
          prompt: async (current) => {
            promptedProposalIds.push(current.id);
            return [];
          },
          feedbackPrompt: async () => feedbackResponses.shift() ?? "",
        },
      );
    });

    const refinedId = `${proposal.id}-refined`;
    const refinedFile = join(project.root, ".nightcrew/proposals", `${refinedId}.json`);
    const archivedSource = join(project.ctx().paths.archivedProposalsDir, `${proposal.id}.json`);
    const refined = readProposalArtifact(refinedFile);
    expect(output.stderr).toBe("");
    expect(promptedProposalIds).toEqual([proposal.id, refinedId]);
    expect(output.stdout).toContain(`refined .nightcrew/proposals/${refinedId}.json`);
    expect(output.stdout).toContain("no items selected; proposal left pending");
    expect(refined.refinedFrom).toBe(proposal.id);
    expect(refined.feedback).toBe(feedback);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(archivedSource)).toBe(true);
    expect(existsSync(refinedFile)).toBe(true);
  });

  it("lists pending proposals, selects bodies verbatim, and archives the artifact", async () => {
    project = await makeTempProject();
    project.setCrew(["Keep existing backlog item"]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T10:00:00.000Z"));
    const firstBody = candidate("First selected", "first").body;
    const secondBody = candidate("Not selected", "second").body;
    const thirdBody = candidate("Third selected", "third").body;
    const { file, proposal } = writeProposalArtifact(project.ctx().paths, {
      goal: "Refine proposals",
      routingTier: "light",
      passes: [],
      items: [
        { ...candidate("First selected", "first"), lens: "minimal_path" },
        { ...candidate("Not selected", "second"), lens: "architecture_first" },
        { ...candidate("Third selected", "third"), lens: "risk_first" },
      ],
    });

    const listed = await captureConsole(() =>
      runCli(["propose", "list", "--root", project?.root ?? ""]),
    );
    expect(listed.stdout).toContain(proposal.id);
    expect(listed.stdout).toContain("3 items");
    expect(listed.stdout).toContain("Refine proposals");

    const beforeCrew = readFileSync(project.ctx().paths.crewFile, "utf8");
    const selected = await captureConsole(() =>
      runCli(["propose", "select", "--ids", "1,3", "--root", project?.root ?? ""]),
    );

    const crew = readFileSync(project.ctx().paths.crewFile, "utf8");
    expect(selected.stderr).toBe("");
    expect(selected.stdout).toContain("selected 2 items");
    expect(crew).toContain(firstBody);
    expect(crew).toContain(thirdBody);
    expect(crew).not.toContain(secondBody);
    expect(crew.indexOf(firstBody)).toBeGreaterThan(crew.indexOf("Keep existing backlog item"));
    expect(crew).not.toBe(beforeCrew);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(project.ctx().paths.archivedProposalsDir, `${proposal.id}.json`))).toBe(
      true,
    );

    const afterList = await captureConsole(() =>
      runCli(["propose", "list", "--root", project?.root ?? ""]),
    );
    expect(afterList.stdout).toBe("no pending proposals");
  });

  it("reviews stored proposals in non-TTY mode without changing crew.md", async () => {
    project = await makeTempProject();
    project.setCrew(["Keep existing backlog item"]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T10:30:00.000Z"));
    const { file, proposal } = writeProposalArtifact(project.ctx().paths, {
      goal: "Review stored proposal",
      routingTier: "light",
      passes: [],
      items: [
        { ...candidate("Review first", "first"), lens: "minimal_path" },
        { ...candidate("Review second", "second"), lens: "architecture_first" },
      ],
    });
    const beforeCrew = readFileSync(project.ctx().paths.crewFile, "utf8");

    const latest = await captureConsole(() =>
      runCli(["propose", "review", "--latest", "--root", project?.root ?? ""]),
    );
    expect(latest.stderr).toBe("");
    expect(latest.stdout).toContain(`reviewing .nightcrew/proposals/${proposal.id}.json`);
    expect(latest.stdout).toContain("1. Review first [minimal_path]");
    expect(latest.stdout).toContain("1. Review first");
    expect(latest.stdout).toContain(candidate("Review first", "first").body);
    expect(latest.stdout).not.toContain("source lens:");
    expect(latest.stdout).toContain(
      `select with: nightcrew propose select --ids 1,3 --proposal ${proposal.id}`,
    );
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(beforeCrew);
    expect(existsSync(file)).toBe(true);

    const byFile = await captureConsole(() =>
      runCli(["propose", "review", file, "--root", project?.root ?? ""]),
    );
    expect(byFile.stderr).toBe("");
    expect(byFile.stdout).toContain(`reviewing .nightcrew/proposals/${proposal.id}.json`);
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(beforeCrew);
    expect(existsSync(file)).toBe(true);
  });

  it("leaves crew.md and the artifact untouched when interactive review selects nothing", async () => {
    project = await makeTempProject();
    project.setScript([
      {
        match: "this script must not be consumed when feedback is empty",
        structuredOutput: { candidates: [candidate("Should not run", "unused")] },
      },
    ]);
    const { file, proposal } = writeProposalArtifact(project.ctx().paths, {
      goal: "Maybe later",
      routingTier: "light",
      passes: [],
      items: [{ ...candidate("Deferred item", "deferred"), lens: "minimal_path" }],
    });
    const beforeCrew = readFileSync(project.ctx().paths.crewFile, "utf8");

    let stdoutBeforePrompt = "";
    const output = await captureConsole(async (captured) => {
      await reviewProposal(
        requireProject().ctx(),
        { file: proposal.id },
        {
          isTty: true,
          prompt: async () => {
            stdoutBeforePrompt = captured.stdout();
            return [];
          },
          feedbackPrompt: async () => "",
        },
      );
    });

    const archived = join(project.ctx().paths.archivedProposalsDir, `${proposal.id}.json`);
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain(`reviewing .nightcrew/proposals/${proposal.id}.json`);
    expect(stdoutBeforePrompt).toContain("1. Deferred item");
    expect(stdoutBeforePrompt).toContain("source lens: minimal_path");
    expect(stdoutBeforePrompt).toContain(candidate("Deferred item", "deferred").body);
    expect(output.stdout).toContain("no items selected; proposal left pending");
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(beforeCrew);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(archived)).toBe(false);
  });

  it("does not write an artifact when a proposal pass fails", async () => {
    project = await makeTempProject();
    project.setScript([
      {
        match: "minimal path",
        status: "error",
        errorMessage: "research failed",
      },
    ]);

    const output = await captureConsole(() =>
      runCli(["propose", "Risky goal", "--root", project?.root ?? ""]),
    );

    expect(process.exitCode).toBe(1);
    expect(output.stderr).toContain("proposal pass minimal_path failed");
    expect(listPendingProposals(project.ctx().paths)).toEqual([]);
  });

  it("leaves crew.md and the artifact untouched when selection ids are invalid", async () => {
    project = await makeTempProject();
    const { file } = writeProposalArtifact(project.ctx().paths, {
      goal: "Select carefully",
      routingTier: "light",
      passes: [],
      items: [{ ...candidate("Only item", "only"), lens: "minimal_path" }],
    });
    const beforeCrew = readFileSync(project.ctx().paths.crewFile, "utf8");

    const output = await captureConsole(() =>
      runCli(["propose", "select", "--ids", "2", "--root", project?.root ?? ""]),
    );

    expect(process.exitCode).toBe(1);
    expect(output.stderr).toContain("proposal item id(s) not found: 2");
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(beforeCrew);
    expect(existsSync(file)).toBe(true);
  });
});
