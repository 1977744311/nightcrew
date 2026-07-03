/**
 * Core domain types. This is the vocabulary of the whole system — every other
 * module speaks in these terms. Keep it dependency-free.
 */

/** The five run intents. `operation` is the single public run-intent field. */
export const OPERATIONS = ["plan", "execute", "verify", "repair", "garden"] as const;
export type Operation = (typeof OPERATIONS)[number];

/** Model routing tiers. Light for judgment/hygiene, heavy for code work. */
export type ModelTier = "light" | "heavy";

/** Every failed iteration carries exactly one typed failure kind. */
export const FAILURE_KINDS = [
  "provider_error",
  "timeout",
  "idle_timeout",
  "verify_failed",
  "write_scope_violation",
  "merge_conflict",
  "git_push_failed",
  "pull_request_failed",
  "quota_exhausted",
  "review_rejected",
  "plan_invalid",
  "bootstrap_failed",
  "cancelled",
  "internal_error",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export function totalTokens(usage: TokenUsage | null): number {
  if (!usage) return 0;
  return usage.inputTokens + usage.outputTokens + usage.reasoningOutputTokens;
}

export function addUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

/** One deterministic verify step result. */
export interface VerifyStepResult {
  name: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  outputTail: string;
}

export interface VerifySummary {
  profile: string;
  passed: boolean;
  steps: VerifyStepResult[];
}

/** Review verdicts, in both advisory and gate modes. */
export const REVIEW_VERDICTS = [
  "approve",
  "approve_with_notes",
  "request_changes",
  "escalate",
] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export type ReviewPoint = "plan" | "merge";
export type ReviewMode = "off" | "advisory" | "gate";

export interface ReviewRecord {
  point: ReviewPoint;
  verdict: ReviewVerdict;
  notes: string;
  round: number;
  mode: ReviewMode;
}

/** A plan file. Directory location is the source of truth for status. */
export type PlanStatus = "active" | "completed" | "paused";

export interface PlanDoc {
  id: string;
  title: string;
  file: string;
  status: PlanStatus;
  parallel: boolean;
  /** Exact first-line text of the unchecked BACKLOG item this plan covers. */
  backlog?: string;
  maxIterations?: number;
  createdAt?: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

/** Why a loop stopped. Recorded in runtime state and history. */
export const STOP_REASONS = [
  "failure_streak",
  "no_commit_streak",
  "control_only_streak",
  "idle",
  "max_iterations",
  "operator",
  "review_escalated",
  "quota_exhausted",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** One line of the history ledger (runtime/history.jsonl). */
export interface IterationRecord {
  id: string;
  projectName: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  operation: Operation;
  planId: string | null;
  status: "success" | "failed" | "idle" | "quota";
  failure?: { kind: FailureKind; message: string };
  /** Commit shas landed by this iteration (worktree branch or control surface). */
  commits: string[];
  /** True when every commit touches only `.nightcrew/` paths. */
  controlOnly: boolean;
  usage: TokenUsage | null;
  verify?: VerifySummary;
  reviews?: ReviewRecord[];
  merged: boolean;
  notes?: string[];
}

/** Pending repair context carried between iterations. */
export interface PendingRepair {
  planId: string;
  reason: FailureKind;
  message: string;
  reviewNotes?: string;
  verify?: VerifySummary;
}

/** Durable runtime state (runtime/state.json). Disposable, never committed. */
export interface RuntimeState {
  version: 1;
  paused: boolean;
  pausedReason?: string;
  /** ISO timestamp to auto-resume after quota exhaustion. */
  resumeAt?: string;
  activePlanId: string | null;
  /** planId -> provider session/thread id, for resume-within-plan. */
  sessions: Record<string, string>;
  streaks: {
    failure: number;
    noCommit: number;
    controlOnly: number;
  };
  iterationsSinceGarden: number;
  lastOperation?: Operation;
  /** Last qa.md triage attempt: content hash + timestamp. Retries only when qa.md changes. */
  qaTriage?: { hash: string; at: string };
  /** planId -> pending repair. One slot per plan so parallel plans fail independently. */
  pendingRepairs: Record<string, PendingRepair>;
  /** planId -> completed merge-review rounds for the current landing attempt. */
  reviewRounds: Record<string, number>;
  stop?: { reason: StopReason; at: string; detail?: string };
  updatedAt: string;
}

export function defaultRuntimeState(): RuntimeState {
  return {
    version: 1,
    paused: false,
    activePlanId: null,
    sessions: {},
    streaks: { failure: 0, noCommit: 0, controlOnly: 0 },
    iterationsSinceGarden: 0,
    pendingRepairs: {},
    reviewRounds: {},
    updatedAt: new Date().toISOString(),
  };
}

/** Everything the renderer needs to produce provider input for one iteration. */
export interface WorkSpec {
  operation: Operation;
  projectName: string;
  /** Directory the agent works in: plan worktree for code ops, repo root for control ops. */
  workingDirectory: string;
  baseBranch: string;
  plan?: PlanDoc;
  crew?: string;
  questions?: string;
  qa?: string;
  repair?: PendingRepair & { verify?: VerifySummary };
  /** Existing plan index, so control ops never duplicate covered BACKLOG items. */
  existingPlans?: {
    active: Array<{ id: string; title: string }>;
    completed: Array<{ id: string; title: string }>;
  };
  protectedPaths: string[];
  /** Control ops may only write inside `.nightcrew/`; code ops write product code. */
  writeScope: "control" | "code";
}
