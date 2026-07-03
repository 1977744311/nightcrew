import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/program";
import {
  listPendingProposals,
  readProposalArtifact,
  writeProposalArtifact,
} from "../src/proposals/proposals";
import { makeTempProject, type TestProject } from "./helpers";

let project: TestProject | undefined;

async function captureConsole(
  action: () => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
  try {
    await action();
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
