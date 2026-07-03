import type { NightcrewConfig } from "../config/schema";
import type { ProjectPaths } from "../core/paths";
import { proposeModel } from "../providers/factory";
import type { Provider } from "../providers/types";
import { readTextIfExists } from "../utils/fs";
import {
  PROPOSAL_LENSES,
  type ProposalArtifactFile,
  type ProposalLens,
  type ProposalPass,
  writeProposalArtifact,
} from "./proposals";

const LENS_LABELS: Record<ProposalLens, string> = {
  minimal_path: "minimal path",
  architecture_first: "architecture-first",
  risk_first: "risk-first",
};

const LENS_INSTRUCTIONS: Record<ProposalLens, string> = {
  minimal_path:
    "Prefer the smallest useful seam that can land quickly with clear tests and minimal churn.",
  architecture_first:
    "Prefer the candidate that establishes the right durable interface, schema, or module boundary first.",
  risk_first:
    "Prefer the candidate that burns down operational, correctness, migration, or testability risk first.",
};

export const PROPOSAL_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["title", "body", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

interface LensCandidate {
  title: string;
  body: string;
  rationale: string;
}

interface LensOutput {
  candidates: LensCandidate[];
}

export interface GenerateProposalOptions {
  goal: string;
  root: string;
  paths: ProjectPaths;
  config: NightcrewConfig;
  provider: Provider;
}

function parseJsonObject(text: string): unknown {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim()) as unknown;
    } catch {
      // keep trying less-clean SDK/fake-provider output
    }
  }
  throw new Error("proposal pass returned invalid JSON");
}

function parseLensOutput(text: string, lens: ProposalLens): LensOutput {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`proposal pass ${lens} did not return a JSON object`);
  }
  const candidates = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) {
    throw new Error(`proposal pass ${lens} did not return candidates[]`);
  }
  return {
    candidates: candidates.map((candidate, index) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error(`proposal pass ${lens} candidate ${index + 1} is not an object`);
      }
      const item = candidate as Record<string, unknown>;
      if (
        typeof item.title !== "string" ||
        typeof item.body !== "string" ||
        typeof item.rationale !== "string"
      ) {
        throw new Error(
          `proposal pass ${lens} candidate ${index + 1} must include title, body, and rationale`,
        );
      }
      return {
        title: item.title,
        body: item.body,
        rationale: item.rationale,
      };
    }),
  };
}

function proposalPrompt(input: {
  goal: string;
  projectName: string;
  lens: ProposalLens;
  crew: string;
}): string {
  return [
    `You are researching BACKLOG candidates for the nightcrew project "${input.projectName}".`,
    "This is a read-only proposal pass. Inspect the repository if needed, but do not modify files.",
    "Use a fresh, independent judgment for this pass.",
    "",
    `## Operator Goal`,
    "",
    input.goal,
    "",
    "## Source Lens",
    "",
    `${LENS_LABELS[input.lens]}: ${LENS_INSTRUCTIONS[input.lens]}`,
    "",
    "## Existing Operator Surface",
    "",
    "```md",
    input.crew.trim() || "(empty)",
    "```",
    "",
    "## Candidate Requirements",
    "",
    "- Return 1-3 candidate BACKLOG items that are directly authorized by the goal.",
    "- Each candidate body must be exactly the checkbox text ready for `## BACKLOG`.",
    "- Each body must be 3-10 lines.",
    '- The first body line must start with "- [ ] ".',
    "- Continuation lines should be indented with six spaces.",
    "- Include tests in the body when the candidate changes behavior.",
    "- Do not include markdown fences in candidate bodies.",
    "",
    "## Output Contract",
    "",
    "Respond with ONLY this JSON object shape:",
    "",
    "```json",
    '{ "candidates": [{ "title": "<short title>", "body": "- [ ] ...", "rationale": "<why this candidate fits this lens>" }] }',
    "```",
  ].join("\n");
}

export async function generateProposal(
  options: GenerateProposalOptions,
): Promise<ProposalArtifactFile> {
  const goal = options.goal.trim();
  if (!goal) throw new Error("proposal goal is required");

  const crew = readTextIfExists(options.paths.crewFile) ?? "";
  const items: Array<LensCandidate & { lens: ProposalLens }> = [];
  const passes: ProposalPass[] = [];

  for (const lens of PROPOSAL_LENSES) {
    const result = await options.provider.run({
      prompt: proposalPrompt({
        goal,
        projectName: options.config.project.name,
        lens,
        crew,
      }),
      workingDirectory: options.root,
      model: proposeModel(options.config),
      sessionId: null,
      timeoutMs: Math.min(options.config.loop.iterationTimeoutMs, 900_000),
      idleTimeoutMs: options.config.loop.idleTimeoutMs,
      readOnly: true,
      outputSchema: PROPOSAL_OUTPUT_SCHEMA,
    });

    if (result.status !== "ok") {
      throw new Error(
        `proposal pass ${lens} failed (${result.status}): ${result.errorMessage ?? "unknown"}`,
      );
    }

    const output = parseLensOutput(result.finalMessage, lens);
    items.push(...output.candidates.map((candidate) => ({ ...candidate, lens })));
    passes.push({ lens, sessionId: result.sessionId, usage: result.usage });
  }

  if (items.length === 0) {
    throw new Error("proposal generation produced no candidate items");
  }

  return writeProposalArtifact(options.paths, {
    goal,
    routingTier: options.config.routing.propose,
    items,
    passes,
  });
}
