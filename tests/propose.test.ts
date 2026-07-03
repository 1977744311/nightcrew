import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/program";
import { renderProposalItemPreview } from "../src/cli/proposal-selection";
import { resumeProposals, reviewProposal, runPropose } from "../src/cli/propose";
import { createProposalProgressReporter } from "../src/cli/propose-progress";
import {
  generateProposal,
  type ProposalProgressEvent,
  refineProposal,
} from "../src/proposals/generate";
import {
  listPendingProposals,
  type ProposalLens,
  readProposalArtifact,
  writeProposalArtifact,
} from "../src/proposals/proposals";
import type { Provider, ProviderRunOptions, ProviderRunResult } from "../src/providers/types";
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

function lensFromPrompt(prompt: string): ProposalLens {
  if (prompt.includes("minimal path:")) return "minimal_path";
  if (prompt.includes("architecture-first:")) return "architecture_first";
  if (prompt.includes("risk-first:")) return "risk_first";
  if (prompt.includes("balanced:")) return "balanced";
  throw new Error(`could not identify proposal lens from prompt: ${prompt}`);
}

function proposalRunResult(lens: ProposalLens, title: string): ProviderRunResult {
  return {
    status: "ok",
    finalMessage: JSON.stringify({ candidates: [candidate(title, lens)] }),
    sessionId: `${lens}-session`,
    usage: null,
  };
}

function deferredProvider(): {
  provider: Provider;
  runs: ProposalLens[];
  resolve: (lens: ProposalLens, result: ProviderRunResult) => void;
} {
  const runs: ProposalLens[] = [];
  const resolvers = new Map<ProposalLens, (result: ProviderRunResult) => void>();
  return {
    runs,
    provider: {
      name: "deferred",
      run: async (options) => {
        const lens = lensFromPrompt(options.prompt);
        runs.push(lens);
        return await new Promise<ProviderRunResult>((resolve) => {
          resolvers.set(lens, resolve);
        });
      },
    },
    resolve: (lens, result) => {
      const resolve = resolvers.get(lens);
      if (!resolve) throw new Error(`proposal pass ${lens} has not started`);
      resolve(result);
    },
  };
}

function balancedScriptEntries(model: string) {
  return [
    {
      match: "balanced:",
      structuredOutput: {
        candidates: [
          candidate("Minimal candidate", "minimal"),
          candidate("Architecture candidate", "architecture"),
          candidate("Risk candidate", "risk"),
        ],
      },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: model,
    },
  ];
}

function proposalScriptEntries(model: string) {
  return [
    {
      match: "minimal path:",
      structuredOutput: { candidates: [candidate("Minimal candidate", "minimal")] },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: model,
    },
    {
      match: "architecture-first:",
      structuredOutput: { candidates: [candidate("Architecture candidate", "architecture")] },
      requireOutputSchema: true,
      expectReadOnly: true,
      expectModel: model,
    },
    {
      match: "risk-first:",
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
      match: `(?=.*balanced:)(?=.*${previousSummary})(?=.*Operator feedback:.*${feedback})`,
      structuredOutput: {
        candidates: [
          candidate("Refined minimal", "refined minimal"),
          candidate("Refined architecture", "refined architecture"),
          candidate("Refined risk", "refined risk"),
        ],
      },
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
  it("renders proposal preview text with title, source lens, rationale, and full body", () => {
    const item = {
      id: "2",
      lens: "architecture_first" as const,
      ...candidate("Preview candidate", "preview"),
    };

    expect(renderProposalItemPreview(item)).toBe(
      [
        "2. Preview candidate",
        "source lens: architecture_first",
        "rationale: preview rationale",
        "",
        candidate("Preview candidate", "preview").body,
      ].join("\n"),
    );
  });

  it("generates one stable artifact from a single balanced read-only pass by default", async () => {
    project = await makeTempProject();
    project.setConfig({
      provider: {
        default: "fake",
        fake: { script: project.scriptFile },
        codex: { tiers: { heavy: "proposal-heavy" } },
      },
      routing: { propose: "heavy" },
    });
    project.setScript(balancedScriptEntries("proposal-heavy"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T09:00:00.000Z"));

    const output = await captureConsole(() =>
      runCli(["propose", "Add proposal workflow", "--root", project?.root ?? ""]),
    );

    const relPath = ".nightcrew/proposals/2026-07-03-add-proposal-workflow.json";
    const file = join(project.root, relPath);
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain("proposal pass balanced started");
    expect(output.stdout).toContain("proposal pass balanced completed");
    expect(output.stdout).not.toContain("proposal pass minimal_path");
    expect(output.stdout).toContain(`created ${relPath}`);
    expect(output.stdout).toContain("1. Minimal candidate");
    expect(output.stdout).toContain("3. Risk candidate");
    expect(output.stdout).toContain("select with: nightcrew propose --ids 1,3");

    const artifact = readProposalArtifact(file);
    expect(artifact).toMatchObject({
      version: 1,
      id: "2026-07-03-add-proposal-workflow",
      goal: "Add proposal workflow",
      status: "pending",
      routingTier: "heavy",
    });
    expect(artifact.items.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(artifact.items.map((item) => item.lens)).toEqual(["balanced", "balanced", "balanced"]);
    expect(artifact.passes).toHaveLength(1);
    expect(artifact.passes[0]?.lens).toBe("balanced");

    project.setScript(balancedScriptEntries("proposal-heavy"));
    await captureConsole(() =>
      runCli(["propose", "Add proposal workflow", "--root", project?.root ?? ""]),
    );
    expect(listPendingProposals(project.ctx().paths).map((entry) => entry.file)).toEqual([file]);
  });

  it("runs the three research passes concurrently with --lenses", async () => {
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
    vi.setSystemTime(new Date("2026-07-03T09:05:00.000Z"));

    const output = await captureConsole(() =>
      runCli(["propose", "Add lensed workflow", "--lenses", "--root", project?.root ?? ""]),
    );

    const relPath = ".nightcrew/proposals/2026-07-03-add-lensed-workflow.json";
    const file = join(project.root, relPath);
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain("proposal pass minimal_path started");
    expect(output.stdout).toContain("proposal pass risk_first completed");
    expect(output.stdout).toContain(`created ${relPath}`);

    const artifact = readProposalArtifact(file);
    expect(artifact.items.map((item) => item.lens)).toEqual([
      "minimal_path",
      "architecture_first",
      "risk_first",
    ]);
    expect(artifact.passes).toHaveLength(3);
  });

  it("keeps candidate numbering in lens order when concurrent passes finish out of order", async () => {
    project = await makeTempProject();
    const deferred = deferredProvider();
    const events: ProposalProgressEvent[] = [];

    const pending = generateProposal({
      goal: "Order concurrent proposal passes",
      root: project.root,
      paths: project.ctx().paths,
      config: project.ctx().config,
      provider: deferred.provider,
      lenses: true,
      onProgress: (event) => events.push(event),
    });

    expect(deferred.runs).toEqual(["minimal_path", "architecture_first", "risk_first"]);
    expect(events.filter((event) => event.kind === "start").map((event) => event.lens)).toEqual([
      "minimal_path",
      "architecture_first",
      "risk_first",
    ]);

    deferred.resolve("risk_first", proposalRunResult("risk_first", "Risk finished first"));
    deferred.resolve("minimal_path", proposalRunResult("minimal_path", "Minimal finished second"));
    deferred.resolve(
      "architecture_first",
      proposalRunResult("architecture_first", "Architecture finished last"),
    );

    const artifact = await pending;
    expect(artifact.proposal.items.map((item) => `${item.id}:${item.title}`)).toEqual([
      "1:Minimal finished second",
      "2:Architecture finished last",
      "3:Risk finished first",
    ]);
    expect(artifact.proposal.items.map((item) => item.lens)).toEqual([
      "minimal_path",
      "architecture_first",
      "risk_first",
    ]);
    expect(artifact.proposal.passes.map((pass) => pass.lens)).toEqual([
      "minimal_path",
      "architecture_first",
      "risk_first",
    ]);
    expect(events.filter((event) => event.kind === "finish").map((event) => event.lens)).toEqual([
      "risk_first",
      "minimal_path",
      "architecture_first",
    ]);
  });

  it("fails the whole proposal when any concurrent pass fails", async () => {
    project = await makeTempProject();
    const deferred = deferredProvider();
    const events: ProposalProgressEvent[] = [];

    const pending = generateProposal({
      goal: "Fail one concurrent proposal pass",
      root: project.root,
      paths: project.ctx().paths,
      config: project.ctx().config,
      provider: deferred.provider,
      lenses: true,
      onProgress: (event) => events.push(event),
    });

    expect(deferred.runs).toEqual(["minimal_path", "architecture_first", "risk_first"]);
    deferred.resolve("risk_first", {
      status: "error",
      finalMessage: "",
      sessionId: "risk-session",
      usage: null,
      errorMessage: "risk research failed",
    });
    deferred.resolve("minimal_path", proposalRunResult("minimal_path", "Minimal still finished"));
    deferred.resolve(
      "architecture_first",
      proposalRunResult("architecture_first", "Architecture still finished"),
    );

    await expect(pending).rejects.toThrow(
      "proposal pass risk_first failed (error): risk research failed",
    );
    expect(events.filter((event) => event.kind === "failure").map((event) => event.lens)).toEqual([
      "risk_first",
    ]);
    expect(listPendingProposals(project.ctx().paths)).toEqual([]);
  });

  it("renders TTY proposal progress as stable live lens lines", () => {
    const writes: string[] = [];
    const stream = {
      isTTY: true,
      write: (chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      },
    } as NodeJS.WritableStream & { isTTY: boolean };
    const progress = createProposalProgressReporter({ isTty: true, stream });

    progress({ kind: "start", lens: "minimal_path" });
    progress({ kind: "start", lens: "architecture_first" });
    progress({ kind: "start", lens: "risk_first" });
    progress({ kind: "finish", lens: "risk_first", elapsedMs: 1234, candidateCount: 2 });
    progress({ kind: "failure", lens: "minimal_path", elapsedMs: 2000, reason: "bad output" });

    const output = writes.join("");
    expect(output).toContain("proposal minimal");
    expect(output).toContain("proposal architecture");
    expect(output).toContain("proposal risk");
    expect(output).toContain("completed 1.2s (2 candidates)");
    expect(output).toContain("failed 2.0s: bad output");
  });

  it("renders a single TTY progress line for the default balanced pass", () => {
    const writes: string[] = [];
    const stream = {
      isTTY: true,
      write: (chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      },
    } as NodeJS.WritableStream & { isTTY: boolean };
    const progress = createProposalProgressReporter({ isTty: true, stream });

    progress({ kind: "start", lens: "balanced" });
    progress({ kind: "finish", lens: "balanced", elapsedMs: 900, candidateCount: 3 });

    const output = writes.join("");
    expect(output).toContain("proposal balanced");
    expect(output).toContain("completed 0.9s (3 candidates)");
    expect(output).not.toContain("proposal minimal");
    expect(output).not.toContain("proposal architecture");
    expect(output).not.toContain("proposal risk");
  });

  it("passes the propose web-search override and includes external research guidance", async () => {
    project = await makeTempProject();
    project.setConfig({
      provider: {
        default: "fake",
        fake: { script: project.scriptFile },
        codex: {
          tiers: { light: "proposal-light" },
          webSearch: "cached",
          webSearchOverrides: { propose: "live" },
        },
      },
    });
    const runs: ProviderRunOptions[] = [];
    const provider: Provider = {
      name: "capture",
      run: async (options) => {
        runs.push(options);
        return {
          status: "ok",
          finalMessage: JSON.stringify({
            candidates: [candidate(`Candidate ${runs.length}`, "capture")],
          }),
          sessionId: `capture-${runs.length}`,
          usage: null,
        };
      },
    };

    await generateProposal({
      goal: "Choose current UI library best practices",
      root: project.root,
      paths: project.ctx().paths,
      config: project.ctx().config,
      provider,
    });

    expect(runs).toHaveLength(1);
    expect(runs.map((run) => run.webSearchMode)).toEqual(["live"]);
    expect(runs[0]?.prompt).toContain("balanced:");
    expect(runs[0]?.prompt).toContain("## External Ecosystem Research");
    expect(runs[0]?.prompt).toContain("run web searches first before proposing candidates");
    expect(runs[0]?.prompt).toContain(
      "cite 1-2 reference sources inside that candidate's `rationale` field",
    );
    expect(runs[0]?.prompt).toContain("do not add fields or change the JSON output shape");
  });

  it("instructs proposal passes to mirror the goal language while keeping BACKLOG formatting", async () => {
    project = await makeTempProject();
    const prompts: string[] = [];
    const provider: Provider = {
      name: "capture",
      run: async (options) => {
        prompts.push(options.prompt);
        const lens = lensFromPrompt(options.prompt);
        return proposalRunResult(lens, `Language ${prompts.length}`);
      },
    };

    await generateProposal({
      goal: "Add language mirroring to proposals",
      root: project.root,
      paths: project.ctx().paths,
      config: project.ctx().config,
      provider,
    });

    expect(prompts).toHaveLength(1);
    expect(prompts.map(lensFromPrompt)).toEqual(["balanced"]);
    for (const prompt of prompts) {
      expect(prompt).toContain("## Language");
      expect(prompt).toContain(
        "- Write every candidate `title`, `body`, and `rationale` in the same language as the operator goal text.",
      );
      expect(prompt).toContain(
        "- Preserve the BACKLOG checkbox formatting rules below regardless of language.",
      );
    }
  });

  it("instructs refinement passes to mirror the feedback language while keeping BACKLOG formatting", async () => {
    project = await makeTempProject();
    const source = writeProposalArtifact(project.ctx().paths, {
      goal: "Improve proposal wording",
      routingTier: "light",
      passes: [],
      items: [{ ...candidate("Source minimal", "source minimal"), lens: "minimal_path" }],
    });
    const prompts: string[] = [];
    const provider: Provider = {
      name: "capture",
      run: async (options) => {
        prompts.push(options.prompt);
        const lens = lensFromPrompt(options.prompt);
        return proposalRunResult(lens, `Refined language ${prompts.length}`);
      },
    };

    await refineProposal({
      source,
      feedback: "Follow the feedback language for regenerated candidates.",
      root: project.root,
      paths: project.ctx().paths,
      config: project.ctx().config,
      provider,
    });

    expect(prompts).toHaveLength(1);
    expect(prompts.map(lensFromPrompt)).toEqual(["balanced"]);
    for (const prompt of prompts) {
      expect(prompt).toContain("## Language");
      expect(prompt).toContain(
        "- Write every candidate `title`, `body`, and `rationale` in the same language as the operator feedback.",
      );
      expect(prompt).toContain(
        "- Preserve the BACKLOG checkbox formatting rules below regardless of language.",
      );
    }
  });

  it("reruns the research lenses on refine when the source artifact recorded them", async () => {
    project = await makeTempProject();
    const source = writeProposalArtifact(project.ctx().paths, {
      goal: "Keep lensed research on refinement",
      routingTier: "light",
      passes: [
        { lens: "minimal_path", sessionId: null, usage: null },
        { lens: "architecture_first", sessionId: null, usage: null },
        { lens: "risk_first", sessionId: null, usage: null },
      ],
      items: [{ ...candidate("Source minimal", "source minimal"), lens: "minimal_path" }],
    });
    const prompts: string[] = [];
    const provider: Provider = {
      name: "capture",
      run: async (options) => {
        prompts.push(options.prompt);
        const lens = lensFromPrompt(options.prompt);
        return proposalRunResult(lens, `Refined lensed ${prompts.length}`);
      },
    };

    const result = await refineProposal({
      source,
      feedback: "Keep researching through all three lenses.",
      root: project.root,
      paths: project.ctx().paths,
      config: project.ctx().config,
      provider,
    });

    expect(prompts.map(lensFromPrompt)).toEqual([
      "minimal_path",
      "architecture_first",
      "risk_first",
    ]);
    expect(result.artifact.proposal.passes.map((pass) => pass.lens)).toEqual([
      "minimal_path",
      "architecture_first",
      "risk_first",
    ]);
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
    project.setScript(balancedScriptEntries("proposal-light"));
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
    expect(stdoutBeforePrompt).not.toContain("1. Minimal candidate");
    expect(stdoutBeforePrompt).not.toContain("source lens:");
    expect(stdoutBeforePrompt).not.toContain(candidate("Minimal candidate", "minimal").body);
    expect(stdoutBeforePrompt).not.toContain("3. Risk candidate");
    expect(stdoutBeforePrompt).not.toContain(candidate("Risk candidate", "risk").body);
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
      runCli(["propose", "--feedback", feedback, "--root", project?.root ?? ""]),
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
      `select with: nightcrew propose --ids 1,3 --proposal ${latest.proposal.id}-refined`,
    );
    expect(refined).toMatchObject({
      id: `${latest.proposal.id}-refined`,
      goal: latest.proposal.goal,
      status: "pending",
      routingTier: "light",
      refinedFrom: latest.proposal.id,
      feedback,
    });
    expect(refined.items.map((item) => item.lens)).toEqual(["balanced", "balanced", "balanced"]);
    expect(refined.passes).toHaveLength(1);
    expect(refined.passes[0]?.lens).toBe("balanced");
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

    const listed = await captureConsole(() => runCli(["propose", "--root", project?.root ?? ""]));
    expect(listed.stdout).toContain(proposal.id);
    expect(listed.stdout).toContain("3 items");
    expect(listed.stdout).toContain("Refine proposals");
    expect(listed.stdout).toContain("review with: nightcrew propose --proposal <id>");

    const beforeCrew = readFileSync(project.ctx().paths.crewFile, "utf8");
    const selected = await captureConsole(() =>
      runCli(["propose", "--ids", "1,3", "--root", project?.root ?? ""]),
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
      runCli(["propose", "--root", project?.root ?? ""]),
    );
    expect(afterList.stdout).toBe(
      'no pending proposals; draft one with `nightcrew propose "<goal>"`',
    );
  });

  it("resumes the latest pending proposal with the picker on bare TTY propose", async () => {
    project = await makeTempProject();
    project.setCrew(["Keep existing backlog item"]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T10:15:00.000Z"));
    const older = writeProposalArtifact(project.ctx().paths, {
      goal: "A older pending proposal",
      routingTier: "light",
      passes: [],
      items: [{ ...candidate("Older item", "older"), lens: "minimal_path" }],
    });
    const latest = writeProposalArtifact(project.ctx().paths, {
      goal: "Z latest pending proposal",
      routingTier: "light",
      passes: [],
      items: [{ ...candidate("Latest item", "latest"), lens: "minimal_path" }],
    });

    const promptedProposalIds: string[] = [];
    const output = await captureConsole(async () => {
      await resumeProposals(
        requireProject().ctx(),
        {},
        {
          isTty: true,
          prompt: async (current) => {
            promptedProposalIds.push(current.id);
            return ["1"];
          },
        },
      );
    });

    expect(output.stderr).toBe("");
    expect(output.stdout).toContain(older.proposal.id);
    expect(output.stdout).toContain(latest.proposal.id);
    expect(promptedProposalIds).toEqual([latest.proposal.id]);
    expect(output.stdout).toContain(`selected 1 item from ${latest.proposal.id}`);
    const crew = readFileSync(project.ctx().paths.crewFile, "utf8");
    expect(crew).toContain(candidate("Latest item", "latest").body);
    expect(existsSync(latest.file)).toBe(false);
    expect(existsSync(older.file)).toBe(true);
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
      runCli(["propose", "--proposal", proposal.id, "--root", project?.root ?? ""]),
    );
    expect(latest.stderr).toBe("");
    expect(latest.stdout).toContain(`reviewing .nightcrew/proposals/${proposal.id}.json`);
    expect(latest.stdout).toContain("1. Review first [minimal_path]");
    expect(latest.stdout).toContain("1. Review first");
    expect(latest.stdout).toContain(candidate("Review first", "first").body);
    expect(latest.stdout).not.toContain("source lens:");
    expect(latest.stdout).toContain(
      `select with: nightcrew propose --ids 1,3 --proposal ${proposal.id}`,
    );
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(beforeCrew);
    expect(existsSync(file)).toBe(true);

    const byFile = await captureConsole(() =>
      runCli(["propose", "--proposal", file, "--root", project?.root ?? ""]),
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
    expect(stdoutBeforePrompt).not.toContain("1. Deferred item");
    expect(stdoutBeforePrompt).not.toContain("source lens: minimal_path");
    expect(stdoutBeforePrompt).not.toContain(candidate("Deferred item", "deferred").body);
    expect(output.stdout).toContain("no items selected; proposal left pending");
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(beforeCrew);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(archived)).toBe(false);
  });

  it("does not write an artifact when a proposal pass fails", async () => {
    project = await makeTempProject();
    project.setScript([
      {
        match: "balanced:",
        status: "error",
        errorMessage: "research failed",
      },
    ]);

    const output = await captureConsole(() =>
      runCli(["propose", "Risky goal", "--root", project?.root ?? ""]),
    );

    expect(process.exitCode).toBe(1);
    expect(output.stdout).toContain("proposal pass balanced started");
    expect(output.stdout).toContain("proposal pass balanced failed");
    expect(output.stderr).toContain("proposal pass balanced failed");
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
      runCli(["propose", "--ids", "2", "--root", project?.root ?? ""]),
    );

    expect(process.exitCode).toBe(1);
    expect(output.stderr).toContain("proposal item id(s) not found: 2");
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(beforeCrew);
    expect(existsSync(file)).toBe(true);
  });

  it("rejects conflicting propose flag combinations", async () => {
    project = await makeTempProject();

    const goalWithFlags = await captureConsole(() =>
      runCli(["propose", "New goal", "--ids", "1", "--root", project?.root ?? ""]),
    );
    expect(process.exitCode).toBe(1);
    expect(goalWithFlags.stderr).toContain("manage pending proposals");
    process.exitCode = undefined;

    const idsWithFeedback = await captureConsole(() =>
      runCli(["propose", "--ids", "1", "--feedback", "smaller", "--root", project?.root ?? ""]),
    );
    expect(process.exitCode).toBe(1);
    expect(idsWithFeedback.stderr).toContain("use --ids or --feedback, not both");
    process.exitCode = undefined;

    const lensesWithoutGoal = await captureConsole(() =>
      runCli(["propose", "--lenses", "--root", project?.root ?? ""]),
    );
    expect(process.exitCode).toBe(1);
    expect(lensesWithoutGoal.stderr).toContain("--lenses needs a goal");
    process.exitCode = undefined;

    const qaWithGoal = await captureConsole(() =>
      runCli(["propose", "Some goal", "--from-qa", "--root", project?.root ?? ""]),
    );
    expect(process.exitCode).toBe(1);
    expect(qaWithGoal.stderr).toContain("--from-qa replaces the goal");
    process.exitCode = undefined;

    const qaWithIds = await captureConsole(() =>
      runCli(["propose", "--from-qa", "--ids", "1", "--root", project?.root ?? ""]),
    );
    expect(process.exitCode).toBe(1);
    expect(qaWithIds.stderr).toContain("--from-qa drafts a new proposal");
  });

  it("drafts qa.md defects into a qa-sourced proposal with --from-qa", async () => {
    project = await makeTempProject();
    writeFileSync(
      join(project.root, ".nightcrew", "qa.md"),
      "# QA\n\n- login crashes on empty password\n- logout button dead on Safari\n",
    );
    project.setScript([
      {
        match: "QA Inbox",
        structuredOutput: {
          candidates: [candidate("Fix login crash", "qa")],
        },
        requireOutputSchema: true,
        expectReadOnly: true,
      },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T09:10:00.000Z"));

    const output = await captureConsole(() =>
      runCli(["propose", "--from-qa", "--root", project?.root ?? ""]),
    );

    const file = join(project.root, ".nightcrew/proposals/2026-07-03-qa-triage.json");
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain("1. Fix login crash");

    const artifact = readProposalArtifact(file);
    expect(artifact).toMatchObject({
      goal: "qa triage",
      source: "qa",
      status: "pending",
    });
    expect(artifact.passes.map((pass) => pass.lens)).toEqual(["balanced"]);
  });

  it("fails --from-qa fast when qa.md has no defect bullets", async () => {
    project = await makeTempProject();

    const output = await captureConsole(() =>
      runCli(["propose", "--from-qa", "--root", project?.root ?? ""]),
    );

    expect(process.exitCode).toBe(1);
    expect(output.stderr).toContain("qa.md has no defect bullets");
    expect(listPendingProposals(project.ctx().paths)).toEqual([]);
  });
});
