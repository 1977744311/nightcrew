import { relative } from "node:path";
import { isCancel, multiselect, text } from "@clack/prompts";
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
export type ProposalFeedbackPrompt = (proposal: ProposalArtifact) => Promise<string | symbol>;
export type ProposalRefineHandler = (
  artifact: ProposalArtifactFile,
  feedback: string,
) => Promise<ProposalArtifactFile>;

export interface ProposalSelectionOptions {
  isTty?: boolean;
  prompt?: ProposalPrompt;
  feedbackPrompt?: ProposalFeedbackPrompt;
  refineOnEmpty?: ProposalRefineHandler;
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
  label: "created" | "reviewing" | "refined",
): void {
  const rel = relative(ctx.root, artifact.file).replaceAll("\\", "/");
  console.log(`${label === "reviewing" ? pc.cyan(label) : pc.green(label)} ${rel}`);
  console.log(
    `${artifact.proposal.items.length} candidate${artifact.proposal.items.length === 1 ? "" : "s"}`,
  );
}

export function printProposalArchive(ctx: ProjectContext, archivedFile: string): void {
  const archiveRel = relative(ctx.root, archivedFile).replaceAll("\\", "/");
  console.log(`${pc.dim("archived")} ${archiveRel}`);
}

export function printProposalItems(proposal: ProposalArtifact): void {
  for (const item of proposal.items) {
    console.log(`${pc.bold(item.id)}. ${item.title} ${pc.dim(`[${item.lens}]`)}`);
    console.log(item.body);
  }
}

export function printProposalPromptDetails(proposal: ProposalArtifact): void {
  for (const item of proposal.items) {
    console.log(`${pc.bold(item.id)}. ${item.title}`);
    console.log(pc.dim(`source lens: ${item.lens}`));
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

async function promptProposalIds(proposal: ProposalArtifact): Promise<string[] | symbol> {
  const selected = await multiselect<string>({
    message: "Select proposal items to append to BACKLOG",
    options: proposal.items.map((item) => ({
      value: item.id,
      label: `${item.id}. ${item.title}`,
      hint: item.lens,
    })),
    required: false,
  });
  if (isCancel(selected)) return selected;
  return selected;
}

async function promptProposalFeedback(proposal: ProposalArtifact): Promise<string | symbol> {
  return await text({
    message: `Optional feedback for ${proposal.id}`,
    placeholder: "Leave blank to keep this proposal pending",
  });
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

  printProposalPromptDetails(artifact.proposal);
  const picked = await (options.prompt ?? promptProposalIds)(artifact.proposal);
  if (isCancel(picked) || !Array.isArray(picked)) {
    console.log(pc.dim("no items selected; proposal left pending"));
    return { mode: "interactive", selectedItems: [] };
  }
  if (picked.length === 0) {
    const feedback = options.refineOnEmpty
      ? await (options.feedbackPrompt ?? promptProposalFeedback)(artifact.proposal)
      : "";
    if (!isCancel(feedback) && typeof feedback === "string" && feedback.trim()) {
      const refined = await options.refineOnEmpty?.(artifact, feedback.trim());
      if (refined) {
        return await reviewProposalSelection(ctx, refined, options);
      }
    }
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
