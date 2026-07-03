import { relative } from "node:path";
import pc from "picocolors";
import type { ProjectContext } from "../config/load";
import { buildProvider } from "../providers/factory";
import { generateProposal } from "../proposals/generate";
import {
  listPendingProposals,
  parseProposalIds,
  selectProposalItems,
} from "../proposals/proposals";

export async function runPropose(ctx: ProjectContext, goal: string): Promise<void> {
  const provider = buildProvider(ctx.config, ctx.root);
  const { file, proposal } = await generateProposal({
    goal,
    root: ctx.root,
    paths: ctx.paths,
    config: ctx.config,
    provider,
  });
  const rel = relative(ctx.root, file).replaceAll("\\", "/");
  console.log(`${pc.green("created")} ${rel}`);
  console.log(`${proposal.items.length} candidate${proposal.items.length === 1 ? "" : "s"}`);
  for (const item of proposal.items) {
    console.log(`${pc.bold(item.id)}. ${item.title} ${pc.dim(`[${item.lens}]`)}`);
  }
  console.log(pc.dim("select with: nightcrew propose select --ids 1,3"));
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
  const archiveRel = relative(ctx.root, result.archivedFile).replaceAll("\\", "/");
  console.log(
    `${pc.green("selected")} ${result.selectedItems.length} item${
      result.selectedItems.length === 1 ? "" : "s"
    } from ${result.proposal.id}`,
  );
  console.log(`${pc.dim("archived")} ${archiveRel}`);
}
