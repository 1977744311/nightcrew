import { relative } from "node:path";
import pc from "picocolors";
import type { ProjectContext } from "../config/load";
import { notifyWebhook } from "../notify/webhook";
import {
  generateProposal,
  type ProposalProgressReporter,
  refineProposal,
} from "../proposals/generate";
import {
  listPendingProposals,
  loadProposalArtifact,
  parseProposalIds,
  selectProposalItems,
} from "../proposals/proposals";
import { buildProvider } from "../providers/factory";
import {
  type ProposalSelectionOptions,
  printProposalArchive,
  printProposalHeader,
  printProposalSelectionResult,
  reviewProposalSelection,
} from "./proposal-selection";
import {
  createProposalProgressReporter,
  type ProposalProgressRenderOptions,
} from "./propose-progress";

export type ProposeCommandOptions = ProposalSelectionOptions & {
  /** Run the three research lenses concurrently instead of one balanced pass. */
  lenses?: boolean;
  /** Draft candidates from `.nightcrew/qa.md` defects instead of a goal. */
  fromQa?: boolean;
  progress?: ProposalProgressReporter | false;
  progressRender?: ProposalProgressRenderOptions;
};

function proposalProgress(options: ProposeCommandOptions): ProposalProgressReporter | undefined {
  if (options.progress === false) return undefined;
  return options.progress ?? createProposalProgressReporter(options.progressRender);
}

function selectionOptions(options: ProposeCommandOptions): ProposalSelectionOptions {
  const {
    lenses: _lenses,
    fromQa: _fromQa,
    progress: _progress,
    progressRender: _progressRender,
    ...selection
  } = options;
  return selection;
}

function withFeedbackRefinement(
  ctx: ProjectContext,
  existingProvider?: ReturnType<typeof buildProvider>,
  options: ProposeCommandOptions = {},
): ProposalSelectionOptions["refineOnEmpty"] {
  let provider = existingProvider;
  return async (artifact, feedback) => {
    provider ??= buildProvider(ctx.config, ctx.root);
    const result = await refineProposal({
      source: artifact,
      feedback,
      root: ctx.root,
      paths: ctx.paths,
      config: ctx.config,
      provider,
      onProgress: proposalProgress(options),
    });
    printProposalHeader(ctx, result.artifact, "refined");
    printProposalArchive(ctx, result.archivedFile);
    return result.artifact;
  };
}

export async function runPropose(
  ctx: ProjectContext,
  goal: string,
  options: ProposeCommandOptions = {},
): Promise<void> {
  const provider = buildProvider(ctx.config, ctx.root);
  const artifact = await generateProposal({
    goal,
    root: ctx.root,
    paths: ctx.paths,
    config: ctx.config,
    provider,
    lenses: options.lenses ?? false,
    fromQa: options.fromQa ?? false,
    onProgress: proposalProgress(options),
  });
  printProposalHeader(ctx, artifact, "created");
  await reviewProposalSelection(ctx, artifact, {
    refineOnEmpty: withFeedbackRefinement(ctx, provider, options),
    ...selectionOptions(options),
  });
}

function printProposalList(ctx: ProjectContext): void {
  const proposals = listPendingProposals(ctx.paths);
  for (const { file, proposal } of proposals) {
    const rel = relative(ctx.root, file).replaceAll("\\", "/");
    console.log(
      `${pc.bold(proposal.id)}  ${proposal.items.length} items  ${pc.dim(rel)}\n  ${proposal.goal}`,
    );
  }
}

export async function selectProposal(
  ctx: ProjectContext,
  idsValue: string,
  proposal?: string,
): Promise<void> {
  const ids = parseProposalIds(idsValue);
  const result = selectProposalItems(ctx.paths, { ids, proposalIdOrFile: proposal });
  printProposalSelectionResult(ctx, result);
  await notifyWebhook(ctx, {
    event: "proposal_landed",
    proposalId: result.proposal.id,
    selectedItems: result.selectedItems.length,
  });
}

export async function reviewProposal(
  ctx: ProjectContext,
  options: { file?: string },
  commandOptions: ProposeCommandOptions = {},
): Promise<void> {
  const artifact = loadProposalArtifact(ctx.paths, options.file);
  printProposalHeader(ctx, artifact, "reviewing");
  await reviewProposalSelection(ctx, artifact, {
    includeProposalHint: true,
    refineOnEmpty: withFeedbackRefinement(ctx, undefined, commandOptions),
    ...selectionOptions(commandOptions),
  });
}

/** Bare `nightcrew propose`: list pending drafts and reopen the latest (or targeted) one. */
export async function resumeProposals(
  ctx: ProjectContext,
  options: { file?: string } = {},
  commandOptions: ProposeCommandOptions = {},
): Promise<void> {
  if (options.file) {
    await reviewProposal(ctx, { file: options.file }, commandOptions);
    return;
  }
  if (listPendingProposals(ctx.paths).length === 0) {
    console.log('no pending proposals; draft one with `nightcrew propose "<goal>"`');
    return;
  }
  printProposalList(ctx);
  const isTty = commandOptions.isTty ?? process.stdout.isTTY === true;
  if (!isTty) {
    console.log(pc.dim("review with: nightcrew propose --proposal <id>"));
    return;
  }
  await reviewProposal(ctx, {}, commandOptions);
}

export async function refineStoredProposal(
  ctx: ProjectContext,
  options: { file?: string; feedback: string },
  commandOptions: ProposeCommandOptions = {},
): Promise<void> {
  const feedback = options.feedback.trim();
  if (!feedback) throw new Error("--feedback must not be empty");
  const source = loadProposalArtifact(ctx.paths, options.file);
  const provider = buildProvider(ctx.config, ctx.root);
  const result = await refineProposal({
    source,
    feedback,
    root: ctx.root,
    paths: ctx.paths,
    config: ctx.config,
    provider,
    onProgress: proposalProgress(commandOptions),
  });
  printProposalHeader(ctx, result.artifact, "refined");
  printProposalArchive(ctx, result.archivedFile);
  await reviewProposalSelection(ctx, result.artifact, {
    includeProposalHint: true,
    refineOnEmpty: withFeedbackRefinement(ctx, provider, commandOptions),
    ...selectionOptions(commandOptions),
  });
}
