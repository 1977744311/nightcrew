import { relative } from "node:path";
import { isCancel, MultiSelectPrompt, settings } from "@clack/core";
import { text } from "@clack/prompts";
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

export function renderProposalItemPreview(item: ProposalItem): string {
  return [
    `${item.id}. ${item.title}`,
    `source lens: ${item.lens}`,
    `rationale: ${item.rationale}`,
    "",
    item.body,
  ].join("\n");
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

interface ProposalPickerOption {
  value: string;
  label: string;
  hint: string;
  item: ProposalItem;
}

function renderProposalPickerOption(
  option: ProposalPickerOption,
  options: { active: boolean; selected: boolean },
): string {
  const checkbox = options.selected ? "[x]" : "[ ]";
  const marker = options.active ? ">" : " ";
  const label = `${checkbox} ${option.label} ${pc.dim(`[${option.hint}]`)}`;
  if (options.active) return pc.cyan(`${marker} ${label}`);
  if (options.selected) return pc.green(`${marker} ${label}`);
  return pc.dim(`${marker} ${label}`);
}

function renderProposalPickerPreview(item: ProposalItem): string {
  return renderProposalItemPreview(item)
    .split("\n")
    .map((line, index) => (index === 0 ? pc.bold(line) : line))
    .join("\n");
}

async function promptProposalIds(proposal: ProposalArtifact): Promise<string[] | symbol> {
  const options: ProposalPickerOption[] = proposal.items.map((item) => ({
    value: item.id,
    label: `${item.id}. ${item.title}`,
    hint: item.lens,
    item,
  }));
  const selected = await new MultiSelectPrompt<ProposalPickerOption>({
    options,
    required: false,
    render() {
      const selectedValues = this.value ?? [];
      const current = this.options[this.cursor] ?? this.options[0];
      const optionLines = this.options.map((option, index) =>
        renderProposalPickerOption(option, {
          active: index === this.cursor,
          selected: selectedValues.includes(option.value),
        }),
      );
      const preview = current ? renderProposalPickerPreview(current.item) : "no proposal item";
      const instructions = [
        `${pc.dim("up/down")} navigate`,
        `${pc.dim("Space")} select`,
        `${pc.dim("Enter")} confirm`,
      ].join(" | ");

      switch (this.state) {
        case "submit": {
          const labels =
            this.options
              .filter((option) => selectedValues.includes(option.value))
              .map((option) => option.label)
              .join(", ") || "none";
          return `${pc.green("o")} Select proposal items to append to BACKLOG\n${pc.dim(labels)}`;
        }
        case "cancel":
          return `${pc.red("x")} Select proposal items to append to BACKLOG\n${pc.dim(
            settings.messages.cancel,
          )}`;
        case "error":
          return [
            `${pc.yellow("!")} Select proposal items to append to BACKLOG`,
            ...optionLines,
            pc.yellow(this.error),
            "",
            preview,
            "",
            instructions,
          ].join("\n");
        default:
          return [
            `${pc.cyan("?")} Select proposal items to append to BACKLOG`,
            ...optionLines,
            "",
            preview,
            "",
            instructions,
          ].join("\n");
      }
    },
  }).prompt();
  if (isCancel(selected)) return selected;
  if (!selected) return [];
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
