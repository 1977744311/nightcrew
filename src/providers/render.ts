import { NIGHTCREW_DIR } from "../core/paths";
import type { WorkSpec } from "../core/types";
import { dateStamp } from "../utils/id";

/**
 * Render a WorkSpec into provider input.
 *
 * Hard-learned rule: the input must END with a mandatory imperative. Without
 * it, agents in non-interactive mode occasionally treat the context dump as
 * "no task given" and reply with a question to an operator who is not there —
 * burning an entire iteration (and, chained, tripping the idle guard).
 */

export const IDLE_MARKER = "IDLE";
export const COMPLETE_MARKER = "PLAN COMPLETE";
export const CONTINUE_MARKER = "CONTINUE";

export interface Signals {
  idle: boolean;
  complete: boolean;
}

export function parseSignals(finalMessage: string): Signals {
  return {
    idle: finalMessage.includes(IDLE_MARKER),
    complete: finalMessage.includes(COMPLETE_MARKER),
  };
}

/** True when the plan body has checkboxes and none of them is unchecked. */
export function allCheckboxesDone(body: string): boolean {
  const total = body.match(/^\s*[-*] \[[ xX]\]/gm)?.length ?? 0;
  const open = body.match(/^\s*[-*] \[ \]/gm)?.length ?? 0;
  return total > 0 && open === 0;
}

function header(spec: WorkSpec): string[] {
  return [
    `You are a nightcrew agent working unattended on project "${spec.projectName}".`,
    "",
    `This is an automated iteration. operation = **${spec.operation}**.`,
    "No operator is watching: never ask clarifying questions, never wait for",
    "confirmation. If something is genuinely undecidable, record it as an open",
    `question in \`${NIGHTCREW_DIR}/questions.md\` and move on within your scope.`,
    "",
  ];
}

function constraints(spec: WorkSpec): string[] {
  const lines = [
    "## Constraints",
    "",
    `- Working directory: ${spec.workingDirectory}`,
    `- Never modify these protected paths: ${["`.git`", ...spec.protectedPaths.map((p) => `\`${p}\``)].join(", ")}.`,
  ];
  if (spec.writeScope === "control") {
    lines.push(
      `- This is a control-surface operation: only files under \`${NIGHTCREW_DIR}/\` may change.`,
    );
  } else {
    lines.push(
      "- You are on an isolated git worktree branch for this plan. Commit your",
      "  work in small, clearly-messaged commits as you go. Uncommitted changes",
      "  are auto-committed at iteration end.",
    );
  }
  lines.push("");
  return lines;
}

function section(title: string, content: string | undefined | null): string[] {
  if (!content?.trim()) return [];
  return [`## ${title}`, "", "```md", content.trim(), "```", ""];
}

function planOpTask(): string[] {
  const today = dateStamp();
  return [
    "## Your Task (act now — do not ask what to do)",
    "",
    `Read the BACKLOG section in \`${NIGHTCREW_DIR}/crew.md\` above. Pick the single`,
    "most valuable unchecked item that is not already covered by an existing plan,",
    `and create **exactly one** plan file at \`${NIGHTCREW_DIR}/plans/active/${today}-<slug>.md\`:`,
    "",
    "```md",
    "---",
    `id: ${today}-<slug>`,
    "title: <short imperative title>",
    `created: ${today}`,
    "parallel: false",
    "---",
    "",
    "## Goal",
    "<one paragraph: the seam this plan closes and why now>",
    "",
    "## Acceptance",
    "- [ ] <verifiable criterion>",
    "- [ ] <verifiable criterion>",
    "",
    "## Steps",
    "1. <bounded step>",
    "```",
    "",
    "Rules:",
    "- One plan, one bounded seam, completable in a few iterations. Do NOT write product code now.",
    "- Only plan work the BACKLOG authorizes. Never invent scope beyond it.",
    `- If the BACKLOG is empty or fully covered, create NO file and reply with exactly \`${IDLE_MARKER}\`.`,
    "",
    "Create the plan file now.",
  ];
}

function executeOpTask(spec: WorkSpec): string[] {
  return [
    "## Your Task (act now — do not ask what to do)",
    "",
    `Implement the active plan above (\`${spec.plan?.id ?? "unknown"}\`). Work only within its`,
    "stated scope. Follow the Steps, keep the Acceptance checklist honest: check",
    "off items in the plan file only when they are truly done and verified.",
    "",
    "- Run the project's own tests/build as you go when useful.",
    "- Commit in small steps with clear messages.",
    `- End your final message with \`${COMPLETE_MARKER}\` only when every acceptance`,
    `  criterion is met. Otherwise end with \`${CONTINUE_MARKER}\` and a one-line note of what remains.`,
    "",
    "Start implementing now.",
  ];
}

function repairOpTask(spec: WorkSpec): string[] {
  const failure = spec.repair;
  const lines = [
    "## Failure To Repair",
    "",
    `- kind: ${failure?.reason ?? "unknown"}`,
    `- detail: ${failure?.message ?? "n/a"}`,
  ];
  if (failure?.verify && !failure.verify.passed) {
    lines.push("", "Failing verify steps:");
    for (const step of failure.verify.steps.filter((s) => !s.ok)) {
      lines.push(
        "",
        `### ${step.name} (exit ${step.exitCode})`,
        "",
        "```",
        step.outputTail.trim(),
        "```",
      );
    }
  }
  if (failure?.reviewNotes) {
    lines.push("", "Reviewer notes to address:", "", "```md", failure.reviewNotes.trim(), "```");
  }
  if (failure?.reason === "merge_conflict") {
    lines.push(
      "",
      `The plan branch no longer merges cleanly into \`${spec.baseBranch}\`.`,
      `Run \`git merge ${spec.baseBranch}\`, resolve every conflict faithfully to both sides' intent, and commit the merge.`,
    );
  }
  lines.push(
    "",
    "## Your Task (act now — do not ask what to do)",
    "",
    "Fix the failure above inside this worktree. Make the smallest honest fix —",
    "no scope creep, no deleting tests to make them pass, no fabricated output.",
    `Commit the fix. End with \`${COMPLETE_MARKER}\` if the plan's acceptance is now fully met,`,
    `otherwise \`${CONTINUE_MARKER}\`.`,
    "",
    "Start repairing now.",
  );
  return lines;
}

function gardenOpTask(): string[] {
  return [
    "## Your Task (act now — do not ask what to do)",
    "",
    `Do control-surface hygiene inside \`${NIGHTCREW_DIR}/\` only:`,
    "",
    `1. In \`crew.md\`, check off BACKLOG items whose plans are in \`plans/completed/\`.`,
    "2. Remove answered/stale entries from `questions.md` (fold durable decisions into a short note where the question was).",
    "3. In `qa.md`, drop entries that are demonstrably fixed; keep the file lean.",
    "4. Keep every file small and pointer-like: prune duplicated prose, dead references, stale plan mentions.",
    "",
    "Do NOT write product code, do NOT create or rewrite plans, do NOT invent new",
    "backlog items. Hygiene only. Start now.",
  ];
}

export function renderPrompt(spec: WorkSpec): string {
  const lines: string[] = [...header(spec), ...constraints(spec)];

  if (spec.operation === "plan" || spec.operation === "garden") {
    lines.push(...section(`${NIGHTCREW_DIR}/crew.md (operator directives + BACKLOG)`, spec.crew));
    lines.push(...section(`${NIGHTCREW_DIR}/questions.md`, spec.questions));
    lines.push(...section(`${NIGHTCREW_DIR}/qa.md`, spec.qa));
  }

  if (spec.operation === "execute" || spec.operation === "repair") {
    lines.push(
      ...section(`Active plan: ${NIGHTCREW_DIR}/plans/active/${spec.plan?.id}.md`, spec.plan?.body),
    );
    if (spec.crew) {
      lines.push(
        ...section(`${NIGHTCREW_DIR}/crew.md (operator rules — read, never edit)`, spec.crew),
      );
    }
  }

  switch (spec.operation) {
    case "plan":
      lines.push(...planOpTask());
      break;
    case "execute":
      lines.push(...executeOpTask(spec));
      break;
    case "repair":
      lines.push(...repairOpTask(spec));
      break;
    case "garden":
      lines.push(...gardenOpTask());
      break;
    case "verify":
      lines.push("## Your Task", "", "No provider work: verify runs deterministically.");
      break;
  }

  return `${lines.join("\n")}\n`;
}
