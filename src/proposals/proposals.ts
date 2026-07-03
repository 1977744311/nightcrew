import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { ProjectPaths } from "../core/paths";
import type { ModelTier, TokenUsage } from "../core/types";
import { ensureDir, writeTextAtomic } from "../utils/fs";
import { dateStamp, isoNow, slugify } from "../utils/id";

export const PROPOSAL_LENSES = ["minimal_path", "architecture_first", "risk_first"] as const;
export type ProposalLens = (typeof PROPOSAL_LENSES)[number];

export const PROPOSAL_ARTIFACT_VERSION = 1;

const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
});

const proposalItemSchema = z.strictObject({
  id: z.string().regex(/^[1-9]\d*$/),
  title: z.string().min(1),
  body: z.string().min(1),
  rationale: z.string().min(1),
  lens: z.enum(PROPOSAL_LENSES),
});

const proposalPassSchema = z.strictObject({
  lens: z.enum(PROPOSAL_LENSES),
  sessionId: z.string().nullable(),
  usage: usageSchema.nullable(),
});

export const proposalArtifactSchema = z.strictObject({
  version: z.literal(PROPOSAL_ARTIFACT_VERSION),
  id: z.string().min(1),
  goal: z.string().min(1),
  status: z.literal("pending"),
  createdAt: z.string().min(1),
  routingTier: z.enum(["light", "heavy"]),
  items: z.array(proposalItemSchema),
  passes: z.array(proposalPassSchema),
});

export type ProposalItem = z.infer<typeof proposalItemSchema>;
export type ProposalPass = z.infer<typeof proposalPassSchema>;
export type ProposalArtifact = z.infer<typeof proposalArtifactSchema>;

export interface ProposalArtifactFile {
  file: string;
  proposal: ProposalArtifact;
}

export interface CandidateProposalItem {
  title: string;
  body: string;
  rationale: string;
  lens: ProposalLens;
}

export interface WriteProposalArtifactInput {
  goal: string;
  routingTier: ModelTier;
  items: CandidateProposalItem[];
  passes: Array<{ lens: ProposalLens; sessionId: string | null; usage: TokenUsage | null }>;
  now?: Date;
}

export interface SelectProposalInput {
  ids: string[];
  proposalIdOrFile?: string;
}

export interface SelectProposalResult {
  proposal: ProposalArtifact;
  proposalFile: string;
  archivedFile: string;
  selectedItems: ProposalItem[];
}

function proposalIdForGoal(goal: string, now = new Date()): string {
  const slug = slugify(goal.trim());
  if (!slug) throw new Error("proposal goal must contain at least one ASCII letter or number");
  return `${dateStamp(now)}-${slug}`;
}

function proposalFile(paths: ProjectPaths, id: string): string {
  return join(paths.proposalsDir, `${id}.json`);
}

function cleanBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

function validateBacklogBody(body: string): string | null {
  const lines = cleanBody(body).split("\n");
  if (lines.length < 3 || lines.length > 10) {
    return "body must be 3-10 lines";
  }
  if (!/^- \[ \] \S/.test(lines[0] ?? "")) {
    return 'body first line must start with "- [ ] "';
  }
  return null;
}

function stableItems(items: CandidateProposalItem[]): ProposalItem[] {
  return items.map((item, index) => {
    const body = cleanBody(item.body);
    const problem = validateBacklogBody(body);
    if (problem) {
      throw new Error(`proposal item ${index + 1} from ${item.lens} is invalid: ${problem}`);
    }
    return {
      id: String(index + 1),
      title: item.title.trim(),
      body,
      rationale: item.rationale.trim(),
      lens: item.lens,
    };
  });
}

export function buildProposalArtifact(input: WriteProposalArtifactInput): ProposalArtifact {
  const goal = input.goal.trim();
  if (!goal) throw new Error("proposal goal is required");
  const now = input.now ?? new Date();
  const artifact: ProposalArtifact = {
    version: PROPOSAL_ARTIFACT_VERSION,
    id: proposalIdForGoal(goal, now),
    goal,
    status: "pending",
    createdAt: isoNow(),
    routingTier: input.routingTier,
    items: stableItems(input.items),
    passes: input.passes,
  };
  return proposalArtifactSchema.parse(artifact);
}

export function writeProposalArtifact(
  paths: ProjectPaths,
  input: WriteProposalArtifactInput,
): ProposalArtifactFile {
  const proposal = buildProposalArtifact(input);
  const file = proposalFile(paths, proposal.id);
  writeTextAtomic(file, `${JSON.stringify(proposal, null, 2)}\n`);
  return { file, proposal };
}

export function readProposalArtifact(file: string): ProposalArtifact {
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return proposalArtifactSchema.parse(parsed);
}

export function listPendingProposals(paths: ProjectPaths): ProposalArtifactFile[] {
  if (!existsSync(paths.proposalsDir)) return [];
  const files = readdirSync(paths.proposalsDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => join(paths.proposalsDir, entry));
  return files.map((file) => ({ file, proposal: readProposalArtifact(file) }));
}

function resolveProposal(paths: ProjectPaths, idOrFile: string): ProposalArtifactFile {
  const file = isAbsolute(idOrFile)
    ? idOrFile
    : idOrFile.endsWith(".json") || idOrFile.includes("/")
      ? resolve(paths.root, idOrFile)
      : proposalFile(paths, idOrFile);
  if (!existsSync(file)) throw new Error(`proposal not found: ${idOrFile}`);
  return { file, proposal: readProposalArtifact(file) };
}

export function latestPendingProposal(paths: ProjectPaths): ProposalArtifactFile | null {
  const proposals = listPendingProposals(paths);
  return proposals.at(-1) ?? null;
}

export function parseProposalIds(value: string): string[] {
  const ids = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new Error("--ids must include at least one item id");
  for (const id of ids) {
    if (!/^[1-9]\d*$/.test(id)) throw new Error(`invalid proposal item id "${id}"`);
  }
  if (new Set(ids).size !== ids.length) throw new Error("--ids must not contain duplicates");
  return ids;
}

function selectItems(proposal: ProposalArtifact, ids: string[]): ProposalItem[] {
  const byId = new Map(proposal.items.map((item) => [item.id, item]));
  const selected = ids.map((id) => byId.get(id));
  const missing = ids.filter((id, index) => !selected[index]);
  if (missing.length > 0) {
    throw new Error(`proposal item id(s) not found: ${missing.join(",")}`);
  }
  return selected as ProposalItem[];
}

function backlogSectionBounds(markdown: string): { start: number; end: number } {
  const header = markdown.match(/^## BACKLOG\s*$/m);
  if (!header || header.index === undefined) {
    throw new Error("crew.md is missing a ## BACKLOG section");
  }
  const start = header.index + header[0].length;
  const rest = markdown.slice(start);
  const next = rest.match(/\n## [^\n]*$/m);
  return { start, end: next?.index === undefined ? markdown.length : start + next.index };
}

export function appendItemsToBacklog(crewMarkdown: string, bodies: string[]): string {
  const cleanBodies = bodies.map(cleanBody);
  const { end } = backlogSectionBounds(crewMarkdown);
  const before = crewMarkdown.slice(0, end).replace(/\s*$/g, "");
  const after = crewMarkdown.slice(end).replace(/^\n*/g, "");
  const inserted = `${before}\n\n${cleanBodies.join("\n")}\n`;
  return after ? `${inserted}\n${after}` : inserted;
}

function archiveTarget(paths: ProjectPaths, file: string): string {
  ensureDir(paths.archivedProposalsDir);
  const name = basename(file, extname(file));
  const ext = extname(file) || ".json";
  let target = join(paths.archivedProposalsDir, `${name}${ext}`);
  let suffix = 2;
  while (existsSync(target)) {
    target = join(paths.archivedProposalsDir, `${name}.${suffix}${ext}`);
    suffix += 1;
  }
  return target;
}

export function archiveProposal(paths: ProjectPaths, file: string): string {
  const target = archiveTarget(paths, file);
  renameSync(file, target);
  return target;
}

export function selectProposalItems(
  paths: ProjectPaths,
  input: SelectProposalInput,
): SelectProposalResult {
  const artifact = input.proposalIdOrFile
    ? resolveProposal(paths, input.proposalIdOrFile)
    : latestPendingProposal(paths);
  if (!artifact) throw new Error("no pending proposals");

  const selectedItems = selectItems(artifact.proposal, input.ids);
  const crew = readFileSync(paths.crewFile, "utf8");
  const nextCrew = appendItemsToBacklog(
    crew,
    selectedItems.map((item) => item.body),
  );
  writeFileSync(paths.crewFile, nextCrew, "utf8");
  const archivedFile = archiveProposal(paths, artifact.file);
  return {
    proposal: artifact.proposal,
    proposalFile: artifact.file,
    archivedFile,
    selectedItems,
  };
}
