import type { NightcrewConfig } from "../config/schema";
import { REVIEW_VERDICTS, type ReviewRecord, type ReviewVerdict } from "../core/types";
import { reviewModel, webSearchModeFor } from "../providers/factory";
import type { Provider } from "../providers/types";
import type { MergeReviewInput, PlanReviewInput, Reviewer } from "./types";

export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: [...REVIEW_VERDICTS] },
    notes: { type: "string" },
  },
  required: ["verdict", "notes"],
  additionalProperties: false,
} as const;

export function parseVerdict(text: string): { verdict: ReviewVerdict; notes: string } | null {
  // Accept raw JSON, fenced JSON, or JSON embedded in prose.
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as { verdict?: unknown; notes?: unknown };
      if (
        typeof parsed.verdict === "string" &&
        (REVIEW_VERDICTS as readonly string[]).includes(parsed.verdict)
      ) {
        return {
          verdict: parsed.verdict as ReviewVerdict,
          notes: typeof parsed.notes === "string" ? parsed.notes : "",
        };
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const OUTPUT_CONTRACT = [
  "## Output contract",
  "",
  "Respond with ONLY a JSON object, no prose around it:",
  "",
  "```json",
  '{ "verdict": "approve" | "approve_with_notes" | "request_changes" | "escalate", "notes": "<short, specific>" }',
  "```",
  "",
  "- approve: correct and in scope.",
  "- approve_with_notes: acceptable now; notes are follow-ups, not blockers.",
  "- request_changes: concrete fixable problems — notes MUST say exactly what to change.",
  "- escalate: outside your authority to judge (scope conflict, ambiguous intent, suspicious changes); a human must decide.",
].join("\n");

function planReviewPrompt(input: PlanReviewInput): string {
  return [
    "You are an independent plan reviewer for an unattended coding crew.",
    "You did NOT write this plan. Judge it against the operator's directives only.",
    "",
    "## Operator directives (crew.md)",
    "",
    "```md",
    input.crew.trim(),
    "```",
    "",
    `## Proposed plan (${input.plan.id})`,
    "",
    "```md",
    input.plan.body.trim(),
    "```",
    "",
    "## Judge exactly two things",
    "",
    "1. Authorization: is this plan clearly authorized by a BACKLOG item (not invented scope)?",
    "2. Boundedness: is it one bounded seam with verifiable acceptance criteria, completable in a few iterations?",
    "",
    "Do not judge implementation approach. Do not rewrite the plan.",
    "",
    OUTPUT_CONTRACT,
    "",
    "Respond with the JSON verdict now.",
  ].join("\n");
}

function mergeReviewPrompt(input: MergeReviewInput): string {
  const verifyText = input.verify
    ? input.verify.steps
        .map((step) => `- ${step.name}: ${step.ok ? "ok" : `FAILED (exit ${step.exitCode})`}`)
        .join("\n")
    : "- (no verify steps configured)";
  return [
    "You are an independent merge reviewer for an unattended coding crew.",
    "You did NOT write this diff. Deterministic gates already passed; you judge",
    "intent compliance, scope, and honesty — not style.",
    "",
    `## The plan this diff claims to implement (${input.plan.id})`,
    "",
    "```md",
    input.plan.body.trim(),
    "```",
    "",
    "## Operator rules (crew.md)",
    "",
    "```md",
    input.crew.trim(),
    "```",
    "",
    "## Verify gates",
    "",
    verifyText,
    "",
    "## The diff (plan branch vs base)",
    "",
    "```diff",
    input.diff.trim() || "(empty diff)",
    "```",
    "",
    "## Judge exactly three things",
    "",
    "1. Intent: does the diff actually implement what the plan states — no more, no less?",
    "2. Scope: are all changes within the plan's scope and the operator's rules?",
    "3. Honesty: any red flags — fabricated data, weakened/deleted tests, checked-off acceptance items the diff does not earn, unrelated churn?",
    "",
    `This is review round ${input.round}. Only request changes for concrete, fixable problems.`,
    "",
    OUTPUT_CONTRACT,
    "",
    "Respond with the JSON verdict now.",
  ].join("\n");
}

/**
 * Provider-backed reviewer. Fresh session per review, light model tier,
 * read-only sandbox. Input is evidence only (plan, diff, gates, rules) —
 * never the maker's self-summary. Unparseable output retries once, then
 * escalates: a mute reviewer must never silently approve.
 */
export class AgentReviewer implements Reviewer {
  readonly mode: "advisory" | "gate";

  constructor(
    private readonly provider: Provider,
    private readonly config: NightcrewConfig,
    private readonly projectRoot: string,
  ) {
    this.mode = this.config.review.mode === "gate" ? "gate" : "advisory";
  }

  private async runReview(prompt: string): Promise<{ verdict: ReviewVerdict; notes: string }> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await this.provider.run({
        prompt,
        workingDirectory: this.projectRoot,
        model: reviewModel(this.config),
        webSearchMode: webSearchModeFor(this.config, "review"),
        sessionId: null,
        timeoutMs: Math.min(this.config.loop.iterationTimeoutMs, 900_000),
        idleTimeoutMs: this.config.loop.idleTimeoutMs,
        readOnly: true,
        outputSchema: VERDICT_SCHEMA,
      });
      if (result.status === "ok") {
        const parsed = parseVerdict(result.finalMessage);
        if (parsed) return parsed;
        if (attempt === 1) continue;
        return { verdict: "escalate", notes: "reviewer output was not a valid verdict JSON" };
      }
      if (attempt === 1) continue;
      return {
        verdict: "escalate",
        notes: `reviewer run failed (${result.status}): ${result.errorMessage ?? "unknown"}`,
      };
    }
    return { verdict: "escalate", notes: "unreachable" };
  }

  async reviewPlan(input: PlanReviewInput): Promise<ReviewRecord> {
    if (!this.config.review.planReview) {
      return { point: "plan", verdict: "approve", notes: "", round: 1, mode: this.mode };
    }
    const { verdict, notes } = await this.runReview(planReviewPrompt(input));
    return { point: "plan", verdict, notes, round: 1, mode: this.mode };
  }

  async reviewMerge(input: MergeReviewInput): Promise<ReviewRecord> {
    if (!this.config.review.mergeReview) {
      return { point: "merge", verdict: "approve", notes: "", round: input.round, mode: this.mode };
    }
    const { verdict, notes } = await this.runReview(mergeReviewPrompt(input));
    return { point: "merge", verdict, notes, round: input.round, mode: this.mode };
  }
}
