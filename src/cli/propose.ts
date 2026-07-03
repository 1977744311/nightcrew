import { relative } from "node:path";
import pc from "picocolors";
import type { ProjectContext } from "../config/load";
import { generateProposal } from "../proposals/generate";
import {
  listPendingProposals,
  loadProposalArtifact,
  parseProposalIds,
  selectProposalItems,
} from "../proposals/proposals";
import { buildProvider } from "../providers/factory";
import {
  type ProposalSelectionOptions,
  printProposalHeader,
  printProposalSelectionResult,
  reviewProposalSelection,
} from "./proposal-selection";

export async function runPropose(
  ctx: ProjectContext,
  goal: string,
  options: ProposalSelectionOptions = {},
): Promise<void> {
  const provider = buildProvider(ctx.config, ctx.root);
  const artifact = await generateProposal({
    goal,
    root: ctx.root,
    paths: ctx.paths,
    config: ctx.config,
    provider,
  });
  printProposalHeader(ctx, artifact, "created");
  await reviewProposalSelection(ctx, artifact, options);
}

export function printProposalList(ctx: ProjectContext): void {
  const proposals = listPendingProposals(ctx.paths);
  if (proposals.length === 0) {
    console.log("no pending proposals");
    return;
  }
  for (const { file, proposal } of proposals) {
    const rel = relative(ctx.root, file).replaceAll("\\", "/");
    console.log(
      `${pc.bold(proposal.id)}  ${proposal.items.length} items  ${pc.dim(rel)}\n  ${proposal.goal}`,
    );
  }
}

export function selectProposal(ctx: ProjectContext, idsValue: string, proposal?: string): void {
  const ids = parseProposalIds(idsValue);
  const result = selectProposalItems(ctx.paths, { ids, proposalIdOrFile: proposal });
  printProposalSelectionResult(ctx, result);
}

export async function reviewProposal(
  ctx: ProjectContext,
  options: { file?: string; latest?: boolean },
  selectionOptions: ProposalSelectionOptions = {},
): Promise<void> {
  if (options.file && options.latest) {
    throw new Error("use --latest or <file>, not both");
  }
  const artifact = loadProposalArtifact(ctx.paths, options.file);
  printProposalHeader(ctx, artifact, "reviewing");
  await reviewProposalSelection(ctx, artifact, {
    includeProposalHint: true,
    ...selectionOptions,
  });
}
