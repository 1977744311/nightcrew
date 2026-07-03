import type { ProjectContext } from "../config/load";
import type { IterationRecord, PlanStatus, TokenUsage } from "../core/types";
import { addUsage, totalTokens } from "../core/types";
import { listPlans } from "./plans";

export type PlanMetricStatus = "landed" | "pending";

export interface PlanHistoryMetric {
  planId: string;
  title: string;
  iterations: number;
  usage: TokenUsage | null;
  totalTokens: number;
  durationMs: number;
  status: PlanMetricStatus;
  landed: boolean;
}

function planTitleIndex(ctx: ProjectContext): Map<string, string> {
  const titles = new Map<string, string>();
  for (const status of ["completed", "active", "paused"] as const satisfies PlanStatus[]) {
    for (const plan of listPlans(ctx.paths, status)) {
      if (!titles.has(plan.id)) titles.set(plan.id, plan.title);
    }
  }
  return titles;
}

export function aggregatePlanHistory(
  ctx: ProjectContext,
  history: IterationRecord[],
): PlanHistoryMetric[] {
  const titles = planTitleIndex(ctx);
  const plans = new Map<string, Omit<PlanHistoryMetric, "totalTokens" | "status">>();

  for (const record of history) {
    if (!record.planId) continue;
    const existing =
      plans.get(record.planId) ??
      ({
        planId: record.planId,
        title: titles.get(record.planId) ?? record.planId,
        iterations: 0,
        usage: null,
        durationMs: 0,
        landed: false,
      } satisfies Omit<PlanHistoryMetric, "totalTokens" | "status">);
    existing.iterations += 1;
    existing.usage = addUsage(existing.usage, record.usage);
    existing.durationMs += record.durationMs;
    existing.landed = existing.landed || record.merged;
    plans.set(record.planId, existing);
  }

  return [...plans.values()].map((plan) => ({
    ...plan,
    totalTokens: totalTokens(plan.usage),
    status: plan.landed ? "landed" : "pending",
  }));
}
