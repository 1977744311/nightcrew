import type { NightcrewConfig } from "../config/schema";
import { findPlan, listPlans, selectNextPlan } from "../plans/plans";
import type { ProjectPaths } from "./paths";
import type { Operation, PlanDoc, RuntimeState } from "./types";

export interface ResolvedOperation {
  operation: Operation;
  plan: PlanDoc | null;
  reason: string;
}

/**
 * Auto-resolution order (the loop's heartbeat):
 *   pending repair → forced garden → active plan → author a plan.
 */
export function resolveOperation(
  state: RuntimeState,
  paths: ProjectPaths,
  config: NightcrewConfig,
  override?: { operation?: Operation; planId?: string },
): ResolvedOperation {
  const pickPlan = (planId?: string): PlanDoc | null => {
    if (planId) return findPlan(paths, planId);
    if (state.activePlanId) {
      const active = findPlan(paths, state.activePlanId);
      if (active && active.status === "active") return active;
    }
    return selectNextPlan(paths);
  };

  if (override?.operation) {
    const needsPlan = override.operation === "execute" || override.operation === "repair";
    return {
      operation: override.operation,
      plan: needsPlan ? pickPlan(override.planId) : null,
      reason: "operator override",
    };
  }

  if (state.pendingRepair) {
    const plan = findPlan(paths, state.pendingRepair.planId);
    if (plan && plan.status === "active") {
      return { operation: "repair", plan, reason: `pending repair: ${state.pendingRepair.reason}` };
    }
  }

  if (state.iterationsSinceGarden >= config.loop.gardenEvery) {
    return {
      operation: "garden",
      plan: null,
      reason: `forced garden every ${config.loop.gardenEvery} iterations`,
    };
  }

  const plan = pickPlan();
  if (plan) {
    return { operation: "execute", plan, reason: `active plan ${plan.id}` };
  }

  return {
    operation: "plan",
    plan: null,
    reason: listPlans(paths, "active").length === 0 ? "no active plans" : "no eligible plan",
  };
}
