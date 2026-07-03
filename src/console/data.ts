import { existsSync } from "node:fs";
import { loadProject, type ProjectContext } from "../config/load";
import { readRegistry } from "../config/registry";
import { projectPaths } from "../core/paths";
import type { IterationRecord, PlanDoc, RuntimeState } from "../core/types";
import { aggregatePlanHistory, type PlanHistoryMetric } from "../plans/accounting";
import { listPlans } from "../plans/plans";
import { type BudgetSummary, summarizeBudget } from "../policy/budget";
import { listPendingProposals, type ProposalItem } from "../proposals/proposals";
import { readHistory } from "../state/history";
import { readState } from "../state/state";

export interface ProjectSummary {
  name: string;
  root: string;
  ok: boolean;
  error?: string;
  state?: RuntimeState;
  activePlans: number;
  completedPlans: number;
  lastIteration?: Pick<IterationRecord, "startedAt" | "operation" | "status" | "planId" | "merged">;
}

export interface ProjectDetail {
  name: string;
  root: string;
  state: RuntimeState;
  plans: {
    active: Array<Pick<PlanDoc, "id" | "title" | "parallel">>;
    paused: Array<Pick<PlanDoc, "id" | "title">>;
    completedCount: number;
  };
  proposals: Array<{
    id: string;
    goal: string;
    createdAt: string;
    items: Array<Pick<ProposalItem, "id" | "title" | "body" | "lens">>;
  }>;
  planMetrics: PlanHistoryMetric[];
  history: IterationRecord[];
  budget: BudgetSummary;
}

export interface RegisteredProject {
  name: string;
  root: string;
}

export function registeredProjects(): RegisteredProject[] {
  return readRegistry().projects;
}

export function summarize(project: RegisteredProject): ProjectSummary {
  const paths = projectPaths(project.root);
  if (!existsSync(paths.configFile)) {
    return {
      name: project.name,
      root: project.root,
      ok: false,
      error: "config.yaml missing",
      activePlans: 0,
      completedPlans: 0,
    };
  }
  try {
    const state = readState(paths);
    const history = readHistory(paths, 1);
    const last = history[history.length - 1];
    return {
      name: project.name,
      root: project.root,
      ok: true,
      state,
      activePlans: listPlans(paths, "active").length,
      completedPlans: listPlans(paths, "completed").length,
      lastIteration: last
        ? {
            startedAt: last.startedAt,
            operation: last.operation,
            status: last.status,
            planId: last.planId,
            merged: last.merged,
          }
        : undefined,
    };
  } catch (error) {
    return {
      name: project.name,
      root: project.root,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      activePlans: 0,
      completedPlans: 0,
    };
  }
}

export function detail(root: string): ProjectDetail {
  const ctx: ProjectContext = loadProject(root);
  const state = readState(ctx.paths);
  const history = readHistory(ctx.paths, 100);
  return {
    name: ctx.config.project.name,
    root: ctx.root,
    state,
    plans: {
      active: listPlans(ctx.paths, "active").map((plan) => ({
        id: plan.id,
        title: plan.title,
        parallel: plan.parallel,
      })),
      paused: listPlans(ctx.paths, "paused").map((plan) => ({ id: plan.id, title: plan.title })),
      completedCount: listPlans(ctx.paths, "completed").length,
    },
    proposals: listPendingProposals(ctx.paths).map(({ proposal }) => ({
      id: proposal.id,
      goal: proposal.goal,
      createdAt: proposal.createdAt,
      items: proposal.items.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        lens: item.lens,
      })),
    })),
    planMetrics: aggregatePlanHistory(ctx, history),
    history,
    budget: summarizeBudget(history),
  };
}
