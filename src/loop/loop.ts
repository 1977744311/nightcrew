import type { ProjectContext } from "../config/load";
import type { IterationRecord, StopReason } from "../core/types";
import { emitEvent } from "../state/events";
import { readState, updateState } from "../state/state";
import { isoNow } from "../utils/id";
import { log } from "../utils/log";
import { type RunnerDeps, runIteration } from "./runner";
import { maybeTriageQa } from "./triage";

export interface LoopOptions {
  maxIterations?: number;
  /** Poll cadence while paused / waiting for a quota window. */
  pollMs?: number;
  signal?: AbortSignal;
  onRecord?: (record: IterationRecord) => void;
}

export interface LoopResult {
  iterations: number;
  stop: { reason: StopReason; detail?: string } | null;
}

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
 * The durable loop: run iterations until a guard, the operator, or the
 * iteration budget stops it. Pause and quota windows suspend rather than
 * stop — the loop wakes up by itself.
 */
export async function runLoop(
  ctx: ProjectContext,
  deps: RunnerDeps,
  options: LoopOptions = {},
): Promise<LoopResult> {
  const { config, paths } = ctx;
  const maxIterations = options.maxIterations ?? config.loop.maxIterations;
  const pollMs = options.pollMs ?? 2_000;
  let iterations = 0;

  emitEvent(paths, config.project.name, "loop.started", { maxIterations });

  while (true) {
    if (options.signal?.aborted) {
      emitEvent(paths, config.project.name, "loop.stopped", {
        reason: "operator",
        detail: "aborted",
      });
      return { iterations, stop: { reason: "operator", detail: "aborted" } };
    }

    const state = readState(paths);

    if (state.paused) {
      await sleep(pollMs, options.signal);
      continue;
    }

    if (state.resumeAt) {
      const wait = Date.parse(state.resumeAt) - Date.now();
      if (wait > 0) {
        await sleep(Math.min(wait, pollMs), options.signal);
        continue;
      }
      updateState(paths, (s) => {
        s.resumeAt = undefined;
      });
      emitEvent(paths, config.project.name, "loop.quota_resumed", {});
      log.info(`${config.project.name}: quota window elapsed, resuming`);
    }

    if (iterations >= maxIterations) {
      const stop = { reason: "max_iterations" as const, detail: `${iterations} iterations` };
      updateState(paths, (s) => {
        s.stop = { reason: stop.reason, at: isoNow(), detail: stop.detail };
      });
      emitEvent(paths, config.project.name, "loop.stopped", stop);
      return { iterations, stop };
    }

    await maybeTriageQa(ctx, deps.provider);
    const record = await runIteration(ctx, deps);
    iterations += 1;
    options.onRecord?.(record);

    const after = readState(paths);
    if (after.stop) {
      emitEvent(paths, config.project.name, "loop.stopped", {
        reason: after.stop.reason,
        detail: after.stop.detail,
      });
      return { iterations, stop: { reason: after.stop.reason, detail: after.stop.detail } };
    }

    if (record.status === "failed") {
      const streak = Math.max(1, after.streaks.failure);
      const backoff = config.loop.backoffMs;
      const wait = backoff[Math.min(streak - 1, backoff.length - 1)] ?? 0;
      if (wait > 0) {
        log.debug(`${config.project.name}: backing off ${wait}ms after failure`);
        await sleep(wait, options.signal);
      }
    }
  }
}
