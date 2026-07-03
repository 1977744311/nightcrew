import pc from "picocolors";
import type { ProjectContext } from "../config/load";
import type { FailureKind, IterationRecord, TokenUsage } from "../core/types";
import { addUsage, totalTokens } from "../core/types";
import { listPlans } from "../plans/plans";
import { aggregatePlanHistory } from "../plans/accounting";
import { readHistory } from "../state/history";
import { readState } from "../state/state";
import { readTextIfExists } from "../utils/fs";

export interface ReportData {
  project: string;
  since: string;
  until: string;
  iterations: {
    total: number;
    success: number;
    failed: number;
    idle: number;
    quota: number;
  };
  plans: ReportPlanBreakdown[];
  landed: Array<{ planId: string; title: string; commits: number }>;
  commits: number;
  usage: TokenUsage | null;
  totalTokens: number;
  failures: Array<{ kind: FailureKind; count: number }>;
  escalations: string[];
  openQuestions: string[];
  activePlans: Array<{ id: string; title: string }>;
  state: {
    paused: boolean;
    stop?: { reason: string; detail?: string };
    resumeAt?: string;
    pendingRepairs: string[];
  };
}

export interface ReportPlanBreakdown {
  planId: string;
  title: string;
  iterations: number;
  usage: TokenUsage | null;
  totalTokens: number;
  landed: boolean;
}

/** Unchecked `- [ ]` items from questions.md — decisions awaiting the operator. */
function openQuestions(text: string | null): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .filter((line) => /^\s*-\s*\[ \]/.test(line))
    .map((line) => line.replace(/^\s*-\s*\[ \]\s*/, "").trim())
    .filter(Boolean);
}

/** Everything the morning digest needs, as data (the CLI renders it, tests assert it). */
export function buildReport(ctx: ProjectContext, sinceMs: number): ReportData {
  const now = Date.now();
  const since = new Date(now - sinceMs);
  const history = readHistory(ctx.paths).filter(
    (record) => Date.parse(record.startedAt) >= since.getTime(),
  );
  const state = readState(ctx.paths);
  const planMetrics = aggregatePlanHistory(ctx, history);
  const planTitles = new Map(planMetrics.map((plan) => [plan.planId, plan.title]));

  const iterations = {
    total: history.length,
    success: history.filter((r) => r.status === "success").length,
    failed: history.filter((r) => r.status === "failed").length,
    idle: history.filter((r) => r.status === "idle").length,
    quota: history.filter((r) => r.status === "quota").length,
  };

  const landed = history
    .filter((record) => record.merged && record.planId)
    .map((record) => ({
      planId: record.planId as string,
      title: planTitles.get(record.planId as string) ?? (record.planId as string),
      commits: record.commits.length,
    }));

  const failureCounts = new Map<FailureKind, number>();
  for (const record of history) {
    if (record.failure) {
      failureCounts.set(record.failure.kind, (failureCounts.get(record.failure.kind) ?? 0) + 1);
    }
  }

  const escalations: string[] = [];
  for (const record of history) {
    for (const review of record.reviews ?? []) {
      if (review.verdict === "escalate") {
        escalations.push(`${review.point} review (${record.planId ?? "no plan"}): ${review.notes}`);
      }
    }
  }

  const usage = history.reduce<TokenUsage | null>((acc, r: IterationRecord) => {
    return addUsage(acc, r.usage);
  }, null);

  return {
    project: ctx.config.project.name,
    since: since.toISOString(),
    until: new Date(now).toISOString(),
    iterations,
    plans: planMetrics.map(({ planId, title, iterations, usage, totalTokens, landed }) => ({
      planId,
      title,
      iterations,
      usage,
      totalTokens,
      landed,
    })),
    landed,
    commits: history.reduce((sum, record) => sum + record.commits.length, 0),
    usage,
    totalTokens: totalTokens(usage),
    failures: [...failureCounts.entries()].map(([kind, count]) => ({ kind, count })),
    escalations,
    openQuestions: openQuestions(readTextIfExists(ctx.paths.questionsFile)),
    activePlans: listPlans(ctx.paths, "active").map((plan) => ({
      id: plan.id,
      title: plan.title,
    })),
    state: {
      paused: state.paused,
      stop: state.stop ? { reason: state.stop.reason, detail: state.stop.detail } : undefined,
      resumeAt: state.resumeAt,
      pendingRepairs: Object.keys(state.pendingRepairs),
    },
  };
}

export function renderReport(report: ReportData): string {
  const lines: string[] = [];
  const hours = Math.round((Date.parse(report.until) - Date.parse(report.since)) / 3_600_000);
  lines.push("");
  lines.push(
    pc.bold(`☾ ${report.project}`) +
      pc.dim(`  last ${hours}h  (${report.since.slice(5, 16)} → ${report.until.slice(5, 16)})`),
  );
  lines.push("");

  const it = report.iterations;
  const parts = [
    pc.green(`${it.success} ok`),
    it.failed > 0 ? pc.red(`${it.failed} failed`) : pc.dim("0 failed"),
    pc.dim(`${it.idle} idle`),
    ...(it.quota > 0 ? [pc.yellow(`${it.quota} quota`)] : []),
  ];
  lines.push(`  iterations  ${pc.bold(String(it.total))}  ${parts.join(pc.dim(" · "))}`);
  lines.push(
    `  commits     ${pc.bold(String(report.commits))}    tokens  ${pc.bold(report.totalTokens.toLocaleString())}`,
  );

  lines.push("");
  lines.push(pc.bold("  plans"));
  if (report.plans.length === 0) {
    lines.push(pc.dim("    no plan-scoped iterations in this window"));
  } else {
    lines.push(pc.dim("    iter      tokens  status   plan"));
    for (const plan of report.plans) {
      const iterations = pc.bold(String(plan.iterations).padStart(4));
      const tokens = pc.bold(plan.totalTokens.toLocaleString().padStart(10));
      const statusText = plan.landed ? "landed" : "pending";
      const status = plan.landed ? pc.green(statusText.padEnd(7)) : pc.dim(statusText.padEnd(7));
      lines.push(`    ${iterations}  ${tokens}  ${status}  ${plan.planId}  ${plan.title}`);
    }
  }

  lines.push("");
  lines.push(pc.bold("  landed"));
  if (report.landed.length === 0) {
    lines.push(pc.dim("    nothing merged in this window"));
  }
  for (const plan of report.landed) {
    lines.push(
      `    ${pc.green("✓")} ${plan.planId}  ${plan.title} ${pc.dim(`(${plan.commits} commits)`)}`,
    );
  }

  if (report.failures.length > 0) {
    lines.push("");
    lines.push(pc.bold("  failures"));
    for (const failure of report.failures) {
      lines.push(`    ${pc.red("✗")} ${failure.kind} × ${failure.count}`);
    }
  }

  if (report.escalations.length > 0) {
    lines.push("");
    lines.push(pc.bold(pc.yellow("  needs your judgment")));
    for (const escalation of report.escalations) {
      lines.push(`    ⚠ ${escalation}`);
    }
  }

  if (report.openQuestions.length > 0) {
    lines.push("");
    lines.push(pc.bold(pc.yellow(`  open questions (${report.openQuestions.length})`)));
    for (const question of report.openQuestions) {
      lines.push(`    ? ${question}`);
    }
  }

  lines.push("");
  lines.push(pc.bold("  queue"));
  if (report.activePlans.length === 0) {
    lines.push(pc.dim("    no active plans — refill the BACKLOG in .nightcrew/crew.md"));
  }
  for (const plan of report.activePlans) {
    lines.push(`    · ${plan.id}  ${plan.title}`);
  }

  const flags: string[] = [];
  if (report.state.paused) flags.push(pc.yellow("paused"));
  if (report.state.stop) {
    flags.push(
      pc.red(
        `stopped: ${report.state.stop.reason}${report.state.stop.detail ? ` — ${report.state.stop.detail}` : ""}`,
      ),
    );
  }
  if (report.state.resumeAt) flags.push(pc.yellow(`quota resume at ${report.state.resumeAt}`));
  for (const planId of report.state.pendingRepairs) {
    flags.push(pc.magenta(`pending repair: ${planId}`));
  }
  if (flags.length > 0) {
    lines.push("");
    lines.push(pc.bold("  attention"));
    for (const flag of flags) lines.push(`    ${flag}`);
  }

  lines.push("");
  return lines.join("\n");
}
