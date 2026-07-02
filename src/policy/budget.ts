import type { NightcrewConfig } from "../config/schema";
import type { IterationRecord, TokenUsage } from "../core/types";
import { totalTokens } from "../core/types";

/**
 * Quota exhaustion is scheduling, not failure. Without an exact reset time
 * from the provider, resume one full quota window from now — worst case we
 * wake with budget already refilled.
 */
export function quotaResumeAt(config: NightcrewConfig, now = new Date()): string {
  return new Date(now.getTime() + config.budget.quotaWindowHours * 3_600_000).toISOString();
}

export function overTokenCap(config: NightcrewConfig, usage: TokenUsage | null): boolean {
  const cap = config.budget.maxTokensPerIteration;
  if (!cap || !usage) return false;
  return totalTokens(usage) > cap;
}

export interface BudgetSummary {
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function summarizeBudget(records: IterationRecord[]): BudgetSummary {
  const summary: BudgetSummary = {
    iterations: records.length,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  for (const record of records) {
    if (!record.usage) continue;
    summary.inputTokens += record.usage.inputTokens;
    summary.outputTokens += record.usage.outputTokens;
    summary.totalTokens += totalTokens(record.usage);
  }
  return summary;
}
