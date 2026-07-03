import { relative } from "node:path";
import { isCancel, multiselect } from "@clack/prompts";
import pc from "picocolors";
import type { ProjectContext } from "../config/load";
import {
  type ProposalArtifact,
  type ProposalArtifactFile,
  type ProposalItem,
  type SelectProposalResult,
  selectProposalItems,
} from "../proposals/proposals";

export type ProposalPrompt = (proposal: ProposalArtifact) => Promise<string[] | symbol>;

export interface ProposalSelectionOptions {
  isTty?: boolean;
  prompt?: ProposalPrompt;
  includeProposalHint?: boolean;
}

export interface ProposalSelectionOutcome {
  mode: "interactive" | "non-tty";
  selectedItems: ProposalItem[];
  result?: SelectProposalResult;
}

export function printProposalHeader(
  ctx: ProjectContext,
  artifact: ProposalArtifactFile,
  label: "created" | "reviewing",
): void {
  const rel = relative(ctx.root, artifact.file).replaceAll("\\", "/");
  console.log(`${label === "created" ? pc.green(label) : pc.cyan(label)} ${rel}`);
  console.log(
    `${artifact.proposal.items.length} candidate${artifact.proposal.items.length === 1 ? "" : "s"}`,
  );
}

export function printProposalItems(proposal: ProposalArtifact): void {
  for (const item of proposal.items) {
    console.log(`${pc.bold(item.id)}. ${item.title} ${pc.dim(`[${item.lens}]`)}`);
    console.log(item.body);
  }
}

export function printProposalSelectHint(
  proposal: ProposalArtifact,
  options: { includeProposal?: boolean } = {},
): void {
  const proposalArg = options.includeProposal ? ` --proposal ${proposal.id}` : "";
  console.log(pc.dim(`select with: nightcrew propose select --ids 1,3${proposalArg}`));
}

export function printProposalSelectionResult(
  ctx: ProjectContext,
  result: SelectProposalResult,
): void {
  const archiveRel = relative(ctx.root, result.archivedFile).replaceAll("\\", "/");
  console.log(
    `${pc.green("selected")} ${result.selectedItems.length} item${
      result.selectedItems.length === 1 ? "" : "s"
    } from ${result.proposal.id}`,
  );
  console.log(`${pc.dim("archived")} ${archiveRel}`);
}

async function promptProposalIds(proposal: ProposalArtifact): Promise<string[]> {
  const selected = await multiselect<string>({
    message: "Select proposal items to append to BACKLOG",
    options: proposal.items.map((item) => ({
      value: item.id,
      label: `${item.id}. ${item.title}`,
      hint: item.lens,
    })),
    required: false,
  });
  if (isCancel(selected)) return [];
  return selected;
}

export async function reviewProposalSelection(
  ctx: ProjectContext,
  artifact: ProposalArtifactFile,
  options: ProposalSelectionOptions = {},
): Promise<ProposalSelectionOutcome> {
  const isTty = options.isTty ?? process.stdout.isTTY === true;
  if (!isTty) {
    printProposalItems(artifact.proposal);
    printProposalSelectHint(artifact.proposal, { includeProposal: options.includeProposalHint });
    return { mode: "non-tty", selectedItems: [] };
  }

  const picked = await (options.prompt ?? promptProposalIds)(artifact.proposal);
  if (isCancel(picked) || picked.length === 0) {
    console.log(pc.dim("no items selected; proposal left pending"));
    return { mode: "interactive", selectedItems: [] };
  }

  const result = selectProposalItems(ctx.paths, {
    ids: picked,
    proposalIdOrFile: artifact.file,
  });
  printProposalSelectionResult(ctx, result);
  return {
    mode: "interactive",
    selectedItems: result.selectedItems,
    result,
  };
}
