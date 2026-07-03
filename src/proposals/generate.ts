import type { NightcrewConfig } from "../config/schema";
import type { ProjectPaths } from "../core/paths";
import { proposeModel, webSearchModeFor } from "../providers/factory";
import type { Provider, ProviderRunResult } from "../providers/types";
import { readTextIfExists } from "../utils/fs";
import type { ProposalArtifact } from "./proposals";
import {
  archiveProposal,
  BALANCED_LENS,
  nextRefinedProposalId,
  type ProposalArtifactFile,
  type ProposalLens,
  type ProposalPass,
  RESEARCH_LENSES,
  writeProposalArtifact,
} from "./proposals";

const LENS_LABELS: Record<ProposalLens, string> = {
  balanced: "balanced",
  minimal_path: "minimal path",
  architecture_first: "architecture-first",
  risk_first: "risk-first",
};

const LENS_INSTRUCTIONS: Record<ProposalLens, string> = {
  balanced:
    "Weigh the smallest useful seam, durable structure, and risk burn-down together; recommend the strongest overall candidates.",
  minimal_path:
    "Prefer the smallest useful seam that can land quickly with clear tests and minimal churn.",
  architecture_first:
    "Prefer the candidate that establishes the right durable interface, schema, or module boundary first.",
  risk_first:
    "Prefer the candidate that burns down operational, correctness, migration, or testability risk first.",
};

/** Single balanced pass by default; the three research lenses on `--lenses`. */
function lensesFor(useResearchLenses: boolean): readonly ProposalLens[] {
  return useResearchLenses ? RESEARCH_LENSES : [BALANCED_LENS];
}

/** Goal label carried by qa-sourced proposal artifacts. */
export const QA_TRIAGE_GOAL = "qa triage";

/**
 * The defect bullets of `.nightcrew/qa.md` (one `- ` bullet per defect by
 * convention). Null when the file has no bullets — nothing to triage.
 */
export function qaDefectBullets(text: string | null): string | null {
  if (!text) return null;
  const bullets = text.split("\n").filter((line) => /^\s*[-*]\s+\S/.test(line));
  return bullets.length > 0 ? bullets.join("\n") : null;
}

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
  /** Run the three research lenses concurrently instead of one balanced pass. */
  lenses?: boolean;
  /** Draft candidates from `.nightcrew/qa.md` defects instead of an operator goal. */
  fromQa?: boolean;
  onProgress?: ProposalProgressReporter;
}

export interface RefineProposalOptions {
  source: ProposalArtifactFile;
  feedback: string;
  root: string;
  paths: ProjectPaths;
  config: NightcrewConfig;
  provider: Provider;
  onProgress?: ProposalProgressReporter;
}

export interface RefineProposalResult {
  artifact: ProposalArtifactFile;
  archivedFile: string;
}

export type ProposalProgressEvent =
  | { kind: "start"; lens: ProposalLens }
  | { kind: "finish"; lens: ProposalLens; elapsedMs: number; candidateCount: number }
  | { kind: "failure"; lens: ProposalLens; elapsedMs: number; reason: string };

export type ProposalProgressReporter = (event: ProposalProgressEvent) => void;

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

function proposalPassError(lens: ProposalLens, result: ProviderRunResult): Error {
  return new Error(
    `proposal pass ${lens} failed (${result.status}): ${result.errorMessage ?? "unknown"}`,
  );
}

function progressFailureReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function nowMs(): number {
  return Date.now();
}

function proposalPrompt(input: {
  goal: string;
  projectName: string;
  lens: ProposalLens;
  crew: string;
  qaInbox?: string;
  refinement?: {
    source: ProposalArtifact;
    feedback: string;
  };
}): string {
  const lines = [
    `You are researching BACKLOG candidates for the nightcrew project "${input.projectName}".`,
    "This is a read-only proposal pass. Inspect the repository if needed, but do not modify files.",
    "Use a fresh, independent judgment for this pass.",
    "",
  ];

  if (input.qaInbox) {
    lines.push(
      "## QA Inbox (operator-recorded defects to triage)",
      "",
      "```md",
      input.qaInbox.trim(),
      "```",
      "",
      "Convert the actionable defects above into BACKLOG candidates: merge duplicates,",
      "skip defects already covered by an existing BACKLOG item in the operator surface",
      "below, and when a defect has competing fix strategies, emit them as separate",
      "candidates stating the trade-off in each rationale.",
      "",
    );
  } else {
    lines.push("## Operator Goal", "", input.goal, "");
  }

  if (input.refinement) {
    lines.push(
      "## Refinement Context",
      "",
      `Previous proposal: ${input.refinement.source.id}`,
      "",
      "Previous candidate summaries:",
      ...input.refinement.source.items.map((item) => `- ${item.id}. ${item.title} [${item.lens}]`),
      "",
      "Operator feedback:",
      "",
      input.refinement.feedback,
      "",
      "Regenerate candidates that respond directly to the feedback while preserving the original goal.",
      "",
    );
  }

  const languageSource = input.refinement
    ? "operator feedback"
    : input.qaInbox
      ? "QA inbox entries"
      : "operator goal text";
  lines.push(
    "## Language",
    "",
    `- Write every candidate \`title\`, \`body\`, and \`rationale\` in the same language as the ${languageSource}.`,
    "- Preserve the BACKLOG checkbox formatting rules below regardless of language.",
    "",
  );

  lines.push(
    "## Source Lens",
    "",
    `${LENS_LABELS[input.lens]}: ${LENS_INSTRUCTIONS[input.lens]}`,
    "",
    "## External Ecosystem Research",
    "",
    "- When the goal involves external ecosystems (UI patterns, library choices, framework APIs, vendor services, best practices, ecosystem norms, or current third-party behavior), run web searches first before proposing candidates.",
    "- For candidates that rely on external findings, cite 1-2 reference sources inside that candidate's `rationale` field.",
    "- Keep citations inside `rationale`; do not add fields or change the JSON output shape.",
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
  );
  return lines.join("\n");
}

async function runProposalPasses(options: {
  goal: string;
  root: string;
  paths: ProjectPaths;
  config: NightcrewConfig;
  provider: Provider;
  lenses: readonly ProposalLens[];
  qaInbox?: string;
  onProgress?: ProposalProgressReporter;
  refinement?: {
    source: ProposalArtifact;
    feedback: string;
  };
}): Promise<{
  items: Array<LensCandidate & { lens: ProposalLens }>;
  passes: ProposalPass[];
}> {
  const goal = options.goal.trim();
  if (!goal) throw new Error("proposal goal is required");

  const crew = readTextIfExists(options.paths.crewFile) ?? "";
  const startedAt = new Map<ProposalLens, number>();

  for (const lens of options.lenses) {
    startedAt.set(lens, nowMs());
    options.onProgress?.({ kind: "start", lens });
  }

  const jobs = options.lenses.map(async (lens) => {
    try {
      const result = await options.provider.run({
        prompt: proposalPrompt({
          goal,
          projectName: options.config.project.name,
          lens,
          crew,
          ...(options.qaInbox ? { qaInbox: options.qaInbox } : {}),
          ...(options.refinement ? { refinement: options.refinement } : {}),
        }),
        workingDirectory: options.root,
        model: proposeModel(options.config),
        webSearchMode: webSearchModeFor(options.config, "propose"),
        sessionId: null,
        timeoutMs: Math.min(options.config.loop.iterationTimeoutMs, 900_000),
        idleTimeoutMs: options.config.loop.idleTimeoutMs,
        readOnly: true,
        outputSchema: PROPOSAL_OUTPUT_SCHEMA,
      });

      if (result.status !== "ok") {
        throw proposalPassError(lens, result);
      }

      const output = parseLensOutput(result.finalMessage, lens);
      const elapsedMs = nowMs() - (startedAt.get(lens) ?? nowMs());
      options.onProgress?.({
        kind: "finish",
        lens,
        elapsedMs,
        candidateCount: output.candidates.length,
      });
      return {
        lens,
        items: output.candidates.map((candidate) => ({ ...candidate, lens })),
        pass: { lens, sessionId: result.sessionId, usage: result.usage },
      };
    } catch (error) {
      options.onProgress?.({
        kind: "failure",
        lens,
        elapsedMs: nowMs() - (startedAt.get(lens) ?? nowMs()),
        reason: progressFailureReason(error),
      });
      throw error;
    }
  });

  const settled = await Promise.allSettled(jobs);
  const firstFailure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (firstFailure) {
    throw firstFailure.reason;
  }

  const ordered = settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const items = ordered.flatMap((result) => result.items);
  const passes = ordered.map((result) => result.pass);

  if (items.length === 0) {
    throw new Error("proposal generation produced no candidate items");
  }

  return { items, passes };
}

export async function generateProposal(
  options: GenerateProposalOptions,
): Promise<ProposalArtifactFile> {
  const goal = options.goal.trim();

  let qaInbox: string | undefined;
  if (options.fromQa) {
    const bullets = qaDefectBullets(readTextIfExists(options.paths.qaFile));
    if (!bullets) {
      throw new Error("qa.md has no defect bullets to triage (one `- ` bullet per defect)");
    }
    qaInbox = bullets;
  }

  const { items, passes } = await runProposalPasses({
    ...options,
    lenses: lensesFor(options.lenses === true),
    ...(qaInbox ? { qaInbox } : {}),
  });

  return writeProposalArtifact(options.paths, {
    goal,
    routingTier: options.config.routing.propose,
    ...(options.fromQa ? { source: "qa" as const } : {}),
    items,
    passes,
  });
}

/** Refinement reruns whatever passes produced the source artifact. */
function refinementLenses(source: ProposalArtifact): readonly ProposalLens[] {
  const lenses = [...new Set(source.passes.map((pass) => pass.lens))];
  return lenses.length > 0 ? lenses : [BALANCED_LENS];
}

export async function refineProposal(
  options: RefineProposalOptions,
): Promise<RefineProposalResult> {
  const feedback = options.feedback.trim();
  if (!feedback) throw new Error("proposal feedback is required");

  const source = options.source.proposal;
  const qaInbox =
    source.source === "qa"
      ? (qaDefectBullets(readTextIfExists(options.paths.qaFile)) ?? undefined)
      : undefined;
  const { items, passes } = await runProposalPasses({
    goal: source.goal,
    root: options.root,
    paths: options.paths,
    config: options.config,
    provider: options.provider,
    lenses: refinementLenses(source),
    ...(qaInbox ? { qaInbox } : {}),
    onProgress: options.onProgress,
    refinement: { source, feedback },
  });

  const artifact = writeProposalArtifact(options.paths, {
    id: nextRefinedProposalId(options.paths, source.id),
    goal: source.goal,
    routingTier: options.config.routing.propose,
    ...(source.source ? { source: source.source } : {}),
    refinedFrom: source.id,
    feedback,
    items,
    passes,
  });
  const archivedFile = archiveProposal(options.paths, options.source.file);
  return { artifact, archivedFile };
}
