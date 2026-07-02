import type { PlanDoc, ReviewMode, ReviewRecord, VerifySummary } from "../core/types";

/**
 * The review seam in the promotion pipeline. Wired from Phase 1 so the
 * pipeline shape never changes; the provider-backed reviewer ships in Phase 2.
 */

export interface PlanReviewInput {
  plan: PlanDoc;
  crew: string;
}

export interface MergeReviewInput {
  plan: PlanDoc;
  diff: string;
  verify: VerifySummary | null;
  crew: string;
  round: number;
}

export interface Reviewer {
  readonly mode: ReviewMode;
  reviewPlan(input: PlanReviewInput): Promise<ReviewRecord>;
  reviewMerge(input: MergeReviewInput): Promise<ReviewRecord>;
}

/** Review disabled: everything is approved silently. */
export class NullReviewer implements Reviewer {
  readonly mode = "off";

  async reviewPlan(): Promise<ReviewRecord> {
    return { point: "plan", verdict: "approve", notes: "", round: 1, mode: "off" };
  }

  async reviewMerge(input: MergeReviewInput): Promise<ReviewRecord> {
    return { point: "merge", verdict: "approve", notes: "", round: input.round, mode: "off" };
  }
}
