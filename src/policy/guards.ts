import type { NightcrewConfig } from "../config/schema";
import type { IterationRecord, RuntimeState, StopReason } from "../core/types";

export interface GuardDecision {
  stop: { reason: StopReason; detail: string } | null;
}

/**
 * The moat. Fold one iteration's facts into runtime state and decide whether
 * the loop must halt. Called after EVERY iteration — one-shot runs keep state
 * truthful too.
 *
 * Streak semantics (learned the hard way):
 * - failure streak counts consecutive failed iterations of any operation;
 *   quota exhaustion is NOT a failure.
 * - no-commit / control-only streaks count execute/repair iterations only,
 *   and interleaved plan/garden iterations do NOT reset them.
 */
export function applyIteration(
  state: RuntimeState,
  record: IterationRecord,
  config: NightcrewConfig,
): GuardDecision {
  const codeOp = record.operation === "execute" || record.operation === "repair";

  if (record.operation === "garden" && record.status === "success") {
    state.iterationsSinceGarden = 0;
  } else {
    state.iterationsSinceGarden += 1;
  }

  if (record.status === "failed") {
    state.streaks.failure += 1;
  } else if (record.status === "success" || record.status === "idle") {
    state.streaks.failure = 0;
  }

  if (codeOp && record.status === "success") {
    if (record.commits.length === 0) {
      state.streaks.noCommit += 1;
    } else {
      state.streaks.noCommit = 0;
      if (record.controlOnly) {
        state.streaks.controlOnly += 1;
      } else {
        state.streaks.controlOnly = 0;
      }
    }
  }

  state.lastOperation = record.operation;

  if (state.streaks.failure >= config.loop.maxFailureStreak) {
    return {
      stop: {
        reason: "failure_streak",
        detail: `${state.streaks.failure} consecutive failed iterations (last: ${record.failure?.kind ?? "unknown"})`,
      },
    };
  }
  if (state.streaks.noCommit >= config.loop.maxNoCommitStreak) {
    return {
      stop: {
        reason: "no_commit_streak",
        detail: `${state.streaks.noCommit} execute/repair iterations landed no commits`,
      },
    };
  }
  if (state.streaks.controlOnly >= config.loop.maxControlOnlyStreak) {
    return {
      stop: {
        reason: "control_only_streak",
        detail: `${state.streaks.controlOnly} iterations only touched .nightcrew/ paths`,
      },
    };
  }
  if (record.status === "idle") {
    return {
      stop: { reason: "idle", detail: "no active plans and the BACKLOG authorizes nothing new" },
    };
  }
  return { stop: null };
}
