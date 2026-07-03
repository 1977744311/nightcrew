import type { ProjectContext } from "../config/load";
import { resolveOperation } from "../core/operations";
import type { IterationRecord } from "../core/types";
import { type RunnerDeps, runIteration } from "../loop/runner";
import { maybeTriageQa } from "../loop/triage";
import { findPlan } from "../plans/plans";
import { emitEvent } from "../state/events";
import { acquireProjectLock } from "../state/lock";
import { readState, updateState } from "../state/state";
import { isoNow } from "../utils/id";
import { log } from "../utils/log";
import { inWindow } from "./windows";

export interface SchedulerOptions {
  signal?: AbortSignal;
  pollMs?: number;
  /** Ignore schedule windows (interactive `crew start --now`). */
  ignoreWindows?: boolean;
  onRecord?: (record: IterationRecord) => void;
}

export interface SchedulerResult {
  iterations: number;
  reason: "aborted" | "locked";
}

type Gate = "go" | "wait" | "halt";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Drives one project indefinitely: serial by default, concurrent worktree
 * lanes for plans marked `parallel: true`, control ops only when no lane is
 * running. Guard stops wait for the operator; idle stops retry after a
 * cooldown (the operator may have pushed new BACKLOG items overnight).
 */
export async function runProjectScheduler(
  ctx: ProjectContext,
  deps: RunnerDeps,
  options: SchedulerOptions = {},
): Promise<SchedulerResult> {
  const { config, paths } = ctx;
  const name = config.project.name;
  const pollMs = options.pollMs ?? 15_000;
  let iterations = 0;
  let idleSince: number | null = null;

  const release = acquireProjectLock(paths, "crew-daemon");
  if (!release) {
    log.warn(`${name}: another process is already driving this project; skipping`);
    return { iterations: 0, reason: "locked" };
  }

  interface Lane {
    parallel: boolean;
    promise: Promise<void>;
    done: boolean;
  }
  const lanes = new Map<string, Lane>();

  const gate = (): Gate => {
    if (options.signal?.aborted) return "halt";
    if (!options.ignoreWindows && !inWindow(config.schedule.windows, config.schedule.days)) {
      return "wait";
    }
    const state = readState(paths);
    if (state.paused) return "wait";
    if (state.resumeAt && Date.parse(state.resumeAt) > Date.now()) return "wait";
    if (state.stop && state.stop.reason !== "idle") return "wait"; // operator must resume
    return "go";
  };

  const clearResumeIfDue = (): void => {
    const state = readState(paths);
    if (state.resumeAt && Date.parse(state.resumeAt) <= Date.now()) {
      updateState(paths, (s) => {
        s.resumeAt = undefined;
      });
      emitEvent(paths, name, "loop.quota_resumed", {});
    }
  };

  const runOne = async (planId?: string): Promise<IterationRecord> => {
    const state = readState(paths);
    const operation = planId
      ? state.pendingRepairs[planId]
        ? ("repair" as const)
        : ("execute" as const)
      : undefined;
    const record = await runIteration(ctx, deps, {
      operation,
      planId,
      excludePlanIds: [...lanes.keys()].filter((id) => id !== planId),
    });
    iterations += 1;
    options.onRecord?.(record);
    return record;
  };

  const laneLoop = async (planId: string): Promise<void> => {
    while (true) {
      if (gate() !== "go") {
        if (options.signal?.aborted) return;
        await sleep(Math.min(pollMs, 1_000), options.signal);
        if (gate() === "halt") return;
        continue;
      }
      const plan = findPlan(paths, planId);
      if (plan?.status !== "active") return;
      const record = await runOne(planId);
      if (record.merged || record.status === "idle") return;
      const state = readState(paths);
      if (state.stop) return;
      if (record.status === "failed") {
        const backoff = config.loop.backoffMs;
        const wait =
          backoff[Math.min(Math.max(state.streaks.failure, 1) - 1, backoff.length - 1)] ?? 0;
        await sleep(wait, options.signal);
      }
    }
  };

  emitEvent(paths, name, "scheduler.started", {});

  try {
    while (true) {
      if (options.signal?.aborted) break;

      clearResumeIfDue();
      const gateNow = gate();
      if (gateNow === "halt") break;
      if (gateNow === "wait") {
        await sleep(pollMs, options.signal);
        continue;
      }

      // Idle cooldown: after an idle stop, nap before re-consulting the BACKLOG.
      const state = readState(paths);
      if (state.stop?.reason === "idle") {
        idleSince ??= Date.now();
        if (Date.now() - idleSince < config.schedule.idleCooldownMs) {
          await sleep(Math.min(pollMs, config.schedule.idleCooldownMs), options.signal);
          continue;
        }
        idleSince = null;
        updateState(paths, (s) => {
          s.stop = undefined;
        });
      }

      // New qa.md defects become a pending proposal (read-only, self-guarded).
      await maybeTriageQa(ctx, deps.provider);

      // Reap finished lanes (explicit flag: racing a settled promise against
      // Promise.resolve() is order-dependent and must never gate this).
      for (const [planId, lane] of [...lanes]) {
        if (lane.done) lanes.delete(planId);
      }

      const resolved = resolveOperation(readState(paths), paths, config, undefined, [
        ...lanes.keys(),
      ]);

      if ((resolved.operation === "execute" || resolved.operation === "repair") && resolved.plan) {
        const plan = resolved.plan;
        const everyLaneParallel = [...lanes.values()].every((lane) => lane.parallel);
        const canStart =
          lanes.size === 0 ||
          (plan.parallel && everyLaneParallel && lanes.size < config.loop.maxParallelPlans);

        if (canStart) {
          const lane: Lane = { parallel: plan.parallel, promise: Promise.resolve(), done: false };
          lane.promise = laneLoop(plan.id)
            .catch((error) => {
              log.error(`${name}: lane ${plan.id} crashed: ${error}`);
            })
            .finally(() => {
              lane.done = true;
            });
          lanes.set(plan.id, lane);
          emitEvent(paths, name, "scheduler.lane_started", { planId: plan.id, lanes: lanes.size });
          continue; // consider starting another parallel lane right away
        }
        await Promise.race([...lanes.values()].map((lane) => lane.promise));
        continue;
      }

      // Control ops (plan/garden/verify) need exclusive occupancy.
      if (lanes.size > 0) {
        await Promise.race([...lanes.values()].map((lane) => lane.promise));
        continue;
      }
      await runOne();
    }
  } finally {
    await Promise.allSettled([...lanes.values()].map((lane) => lane.promise));
    emitEvent(paths, name, "scheduler.stopped", { at: isoNow() });
    release();
  }

  return { iterations, reason: "aborted" };
}
