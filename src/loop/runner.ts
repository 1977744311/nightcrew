import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectContext } from "../config/load";
import { resolveOperation } from "../core/operations";
import { isControlPath } from "../core/paths";
import type {
  FailureKind,
  IterationRecord,
  Operation,
  PlanDoc,
  RuntimeState,
  StopReason,
  VerifySummary,
} from "../core/types";
import {
  addAllAndCommit,
  changedPathsBetween,
  commitPaths,
  commitsSince,
  currentBranch,
  diffBetween,
  headSha,
  revertPaths,
  statusEntries,
} from "../git/git";
import { mergeBranch } from "../git/merge";
import { enforceWriteScope, snapshotDirtyPaths } from "../git/scope";
import { ensureWorktree, planBranch, removeWorktree } from "../git/worktree";
import { findPlan, listPlans, movePlan, readPlan, validatePlan } from "../plans/plans";
import { overTokenCap, quotaResumeAt } from "../policy/budget";
import { applyIteration } from "../policy/guards";
import { modelForOperation } from "../providers/factory";
import { allCheckboxesDone, parseSignals, renderPrompt } from "../providers/render";
import type { Provider, ProviderRunResult } from "../providers/types";
import type { Reviewer } from "../review/types";
import { emitEvent } from "../state/events";
import { appendHistory } from "../state/history";
import { readState, updateState } from "../state/state";
import { appendLine, readTextIfExists } from "../utils/fs";
import { isoNow, newId } from "../utils/id";
import { namedMutex } from "../utils/mutex";
import { runShell, tail } from "../utils/process";
import { runVerify } from "../verify/verify";

export interface RunnerDeps {
  provider: Provider;
  reviewer: Reviewer;
}

export interface RunOptions {
  operation?: Operation;
  planId?: string;
  /** Plans already being driven by concurrent runners (parallel scheduling). */
  excludePlanIds?: string[];
}

interface StopOverride {
  reason: StopReason;
  detail: string;
}

function failureKindFor(result: ProviderRunResult): FailureKind {
  switch (result.status) {
    case "timeout":
      return "timeout";
    case "idle_timeout":
      return "idle_timeout";
    case "quota":
      return "quota_exhausted";
    default:
      return "provider_error";
  }
}

function controlSurface(file: string): string | undefined {
  return readTextIfExists(file) ?? undefined;
}

async function appendQuestion(ctx: ProjectContext, text: string): Promise<void> {
  const stampText = `- [ ] (${isoNow().slice(0, 16)}) ${text}`;
  appendLine(ctx.paths.questionsFile, stampText);
  const rel = relative(ctx.root, ctx.paths.questionsFile);
  await commitPaths(ctx.root, [rel], "nightcrew: record open question");
}

/** Serializes every main-checkout mutation (control commits, merges) per repo. */
function mainLock(ctx: ProjectContext) {
  return namedMutex(`main:${ctx.root}`);
}

/**
 * Persist one iteration's effects into fresh on-disk state under the state
 * lock. Concurrent lanes each merge only their own plan-keyed entries, so
 * streak math and sibling-plan sessions never clobber each other.
 */
function persistIteration(
  ctx: ProjectContext,
  snapshot: RuntimeState,
  snapshotBefore: { activePlanId: string | null },
  record: IterationRecord,
  stopOverride: StopOverride | null,
): { reason: StopReason; detail?: string } | null {
  let stop: { reason: StopReason; detail?: string } | null = null;

  updateState(ctx.paths, (fresh) => {
    const planId = record.planId;
    if (planId) {
      for (const map of ["sessions", "pendingRepairs", "reviewRounds"] as const) {
        const value = snapshot[map][planId];
        if (value === undefined) {
          delete fresh[map][planId];
        } else {
          (fresh[map] as Record<string, unknown>)[planId] = value;
        }
      }
    }
    // activePlanId is the serial cursor; merge it defensively so a parallel
    // lane completing plan A never clobbers a cursor moved to plan B.
    if (snapshot.activePlanId !== snapshotBefore.activePlanId) {
      if (snapshot.activePlanId === null) {
        if (fresh.activePlanId === record.planId) fresh.activePlanId = null;
      } else if (
        fresh.activePlanId === snapshotBefore.activePlanId ||
        fresh.activePlanId === null
      ) {
        fresh.activePlanId = snapshot.activePlanId;
      }
    }

    for (const staleId of Object.keys(fresh.pendingRepairs)) {
      const plan = findPlan(ctx.paths, staleId);
      if (plan?.status !== "active") delete fresh.pendingRepairs[staleId];
    }

    if (record.status === "quota") {
      fresh.resumeAt = quotaResumeAt(ctx.config);
      record.notes?.push(`quota exhausted; resume scheduled at ${fresh.resumeAt}`);
    }

    const guard = applyIteration(fresh, record, ctx.config);
    stop = stopOverride ?? guard.stop;
    fresh.stop = stop ? { reason: stop.reason, at: isoNow(), detail: stop.detail } : undefined;
  });

  return stop;
}

/**
 * Run exactly one iteration. Always returns a record; always leaves runtime
 * state, the history ledger, and the event feed updated — success or failure.
 */
export async function runIteration(
  ctx: ProjectContext,
  deps: RunnerDeps,
  options: RunOptions = {},
): Promise<IterationRecord> {
  const startedAt = isoNow();
  const startMs = Date.now();
  const state = readState(ctx.paths);
  const stateBefore = { activePlanId: state.activePlanId };

  // Pending repairs whose plans are gone (completed/paused/removed) are stale.
  for (const planId of Object.keys(state.pendingRepairs)) {
    const repairPlan = findPlan(ctx.paths, planId);
    if (repairPlan?.status !== "active") delete state.pendingRepairs[planId];
  }

  const resolved = resolveOperation(
    state,
    ctx.paths,
    ctx.config,
    options,
    options.excludePlanIds ?? [],
  );

  const record: IterationRecord = {
    id: newId(),
    projectName: ctx.config.project.name,
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    operation: resolved.operation,
    planId: resolved.plan?.id ?? null,
    status: "success",
    commits: [],
    controlOnly: false,
    usage: null,
    merged: false,
    notes: [resolved.reason],
  };

  emitEvent(ctx.paths, ctx.config.project.name, "iteration.started", {
    iterationId: record.id,
    operation: resolved.operation,
    planId: record.planId,
    reason: resolved.reason,
  });

  const logFile = join(ctx.paths.logsDir, `${record.id}.log`);
  const logEvent = (kind: string, text: string): void => {
    appendLine(logFile, `[${isoNow().slice(11, 19)}] ${kind}: ${text}`);
    if (kind === "command" || kind === "file_change" || kind === "error" || kind === "usage") {
      emitEvent(ctx.paths, ctx.config.project.name, `provider.${kind}`, {
        iterationId: record.id,
        text: text.slice(0, 300),
      });
    }
  };

  let stopOverride: StopOverride | null = null;

  try {
    switch (resolved.operation) {
      case "plan":
      case "garden": {
        const op = resolved.operation;
        // Control ops own the main checkout for their whole iteration.
        stopOverride = await mainLock(ctx).withLock(() =>
          runControlOp(ctx, deps, state, record, op, logEvent),
        );
        break;
      }
      case "execute":
      case "repair":
        stopOverride = await runCodeOp(ctx, deps, state, record, resolved.plan, logEvent);
        break;
      case "verify":
        await runVerifyOp(ctx, state, record, resolved.plan);
        break;
    }
  } catch (error) {
    record.status = "failed";
    record.failure = {
      kind: "internal_error",
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  }

  record.endedAt = isoNow();
  record.durationMs = Date.now() - startMs;

  if (overTokenCap(ctx.config, record.usage)) {
    record.notes?.push("iteration exceeded budget.maxTokensPerIteration");
  }

  const stop = persistIteration(ctx, state, stateBefore, record, stopOverride);
  appendHistory(ctx.paths, record);
  emitEvent(ctx.paths, ctx.config.project.name, "iteration.finished", {
    iterationId: record.id,
    operation: record.operation,
    planId: record.planId,
    status: record.status,
    failure: record.failure?.kind,
    commits: record.commits.length,
    merged: record.merged,
    stop: stop?.reason,
  });

  return record;
}

/** plan + garden: provider works on the main checkout, scoped to `.nightcrew/`. */
async function runControlOp(
  ctx: ProjectContext,
  deps: RunnerDeps,
  state: RuntimeState,
  record: IterationRecord,
  operation: "plan" | "garden",
  logEvent: (kind: string, text: string) => void,
): Promise<StopOverride | null> {
  const { paths, config, root } = ctx;
  const before = await snapshotDirtyPaths(root);
  const plansBefore = new Set(listPlans(paths, "active").map((plan) => plan.file));

  const summary = (plan: PlanDoc): { id: string; title: string } => ({
    id: plan.id,
    title: plan.title,
  });
  const prompt = renderPrompt({
    operation,
    projectName: config.project.name,
    workingDirectory: root,
    baseBranch: config.project.baseBranch ?? "HEAD",
    crew: controlSurface(paths.crewFile),
    questions: controlSurface(paths.questionsFile),
    qa: controlSurface(paths.qaFile),
    existingPlans: {
      active: listPlans(paths, "active").map(summary),
      completed: listPlans(paths, "completed").map(summary),
    },
    protectedPaths: config.protectedPaths,
    writeScope: "control",
  });

  const result = await deps.provider.run({
    prompt,
    workingDirectory: root,
    model: modelForOperation(config, operation),
    sessionId: null,
    timeoutMs: config.loop.iterationTimeoutMs,
    idleTimeoutMs: config.loop.idleTimeoutMs,
    onEvent: (event) => logEvent(event.kind, event.text),
  });
  record.usage = result.usage;

  const revertAllNew = async (): Promise<void> => {
    const after = await statusEntries(root);
    const touched = after.map((entry) => entry.path).filter((path) => !before.has(path));
    await revertPaths(root, touched);
  };

  if (result.status !== "ok") {
    await revertAllNew();
    if (result.status === "quota") {
      record.status = "quota";
      record.failure = { kind: "quota_exhausted", message: result.errorMessage ?? "quota" };
    } else {
      record.status = "failed";
      record.failure = {
        kind: failureKindFor(result),
        message: result.errorMessage ?? "provider failed",
      };
    }
    return null;
  }

  const scope = await enforceWriteScope({
    cwd: root,
    scope: "control",
    protectedPaths: config.protectedPaths,
    before,
  });
  if (scope.violations.length > 0) {
    await revertAllNew();
    record.status = "failed";
    record.failure = {
      kind: "write_scope_violation",
      message: scope.violations.map((v) => `${v.path} (${v.reason})`).join(", "),
    };
    return null;
  }

  if (operation === "plan") {
    return await concludePlanOp(
      ctx,
      deps,
      state,
      record,
      result.finalMessage,
      plansBefore,
      before,
      revertAllNew,
    );
  }

  // garden: commit whatever hygiene changed.
  const after = await statusEntries(root);
  const touched = after.map((entry) => entry.path).filter((path) => !before.has(path));
  const sha = await commitPaths(root, touched, "nightcrew(garden): control-surface hygiene");
  if (sha) {
    record.commits.push(sha);
    record.controlOnly = true;
  }
  return null;
}

async function concludePlanOp(
  ctx: ProjectContext,
  deps: RunnerDeps,
  state: RuntimeState,
  record: IterationRecord,
  finalMessage: string,
  plansBefore: Set<string>,
  before: Set<string>,
  revertAllNew: () => Promise<void>,
): Promise<StopOverride | null> {
  const { paths, root } = ctx;
  const newPlans = listPlans(paths, "active").filter((plan) => !plansBefore.has(plan.file));
  const signals = parseSignals(finalMessage);

  if (newPlans.length === 0) {
    if (signals.idle) {
      record.status = "idle";
      record.notes?.push("BACKLOG authorizes nothing new");
      return null;
    }
    record.status = "failed";
    record.failure = {
      kind: "plan_invalid",
      message: "plan operation created no plan file and did not declare IDLE",
    };
    return null;
  }

  if (newPlans.length > 1) {
    await revertAllNew();
    record.status = "failed";
    record.failure = {
      kind: "plan_invalid",
      message: `plan operation created ${newPlans.length} plans; exactly one is allowed`,
    };
    return null;
  }

  const plan = newPlans[0] as PlanDoc;
  record.planId = plan.id;
  const problems = validatePlan(plan);
  if (problems.length > 0) {
    await revertAllNew();
    record.status = "failed";
    record.failure = { kind: "plan_invalid", message: problems.join("; ") };
    return null;
  }

  const review = await deps.reviewer.reviewPlan({
    plan,
    crew: controlSurface(paths.crewFile) ?? "",
  });
  record.reviews = [review];

  if (review.mode === "gate" && review.verdict === "escalate") {
    await revertAllNew();
    await appendQuestion(ctx, `plan review escalated for "${plan.title}": ${review.notes}`);
    record.status = "failed";
    record.failure = { kind: "review_rejected", message: review.notes };
    return {
      reason: "review_escalated",
      detail: `plan review escalated: ${review.notes.slice(0, 200)}`,
    };
  }
  if (review.mode === "gate" && review.verdict === "request_changes") {
    await revertAllNew();
    await appendQuestion(
      ctx,
      `plan review rejected "${plan.title}" — next plan pass must address: ${review.notes}`,
    );
    record.status = "failed";
    record.failure = { kind: "review_rejected", message: review.notes };
    return null;
  }
  if (review.verdict !== "approve" && review.notes) {
    record.notes?.push(`plan review (${review.verdict}): ${review.notes.slice(0, 300)}`);
  }

  const after = await statusEntries(root);
  const touched = after.map((entry) => entry.path).filter((path) => !before.has(path));
  const sha = await commitPaths(root, touched, `nightcrew(plan): add ${plan.id}`);
  if (sha) {
    record.commits.push(sha);
    record.controlOnly = true;
  }
  state.activePlanId = plan.id;
  record.notes?.push(`authored plan ${plan.id}`);
  return null;
}

/** execute + repair: provider works inside the plan's worktree. */
async function runCodeOp(
  ctx: ProjectContext,
  deps: RunnerDeps,
  state: RuntimeState,
  record: IterationRecord,
  plan: PlanDoc | null,
  logEvent: (kind: string, text: string) => void,
): Promise<StopOverride | null> {
  const { paths, config, root } = ctx;
  const operation = record.operation as "execute" | "repair";

  if (!plan) {
    record.status = "idle";
    record.notes?.push("no active plan to execute");
    return null;
  }
  record.planId = plan.id;

  const base = config.project.baseBranch ?? (await currentBranch(root));

  // A manually-dropped plan file must be committed before branching from base.
  const planRel = relative(root, plan.file);
  await mainLock(ctx).withLock(async () => {
    const mainDirty = await statusEntries(root);
    if (mainDirty.some((entry) => entry.path === planRel)) {
      await commitPaths(root, [planRel], `nightcrew: add plan ${plan.id} (operator)`);
    }
  });

  const worktree = await ensureWorktree(paths, plan.id, base);
  if (worktree.created && config.bootstrap.length > 0) {
    for (const step of config.bootstrap) {
      const result = await runShell(step.run, { cwd: worktree.path, timeoutMs: step.timeoutMs });
      if (result.timedOut || result.exitCode !== 0) {
        record.status = "failed";
        record.failure = {
          kind: "bootstrap_failed",
          message: `bootstrap step "${step.name}" failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${tail(result.output, 2_000)}`,
        };
        state.pendingRepairs[plan.id] = {
          planId: plan.id,
          reason: "bootstrap_failed",
          message: record.failure.message,
        };
        return null;
      }
    }
    record.notes?.push("worktree created and bootstrapped");
  }

  const baseline = await headSha(worktree.path);
  const before = await snapshotDirtyPaths(worktree.path);
  const planInWorktree = readPlan(join(worktree.path, planRel), "active") ?? plan;

  const prompt = renderPrompt({
    operation,
    projectName: config.project.name,
    workingDirectory: worktree.path,
    baseBranch: base,
    plan: planInWorktree,
    crew: controlSurface(paths.crewFile),
    repair: operation === "repair" ? state.pendingRepairs[plan.id] : undefined,
    protectedPaths: config.protectedPaths,
    writeScope: "code",
  });

  const result = await deps.provider.run({
    prompt,
    workingDirectory: worktree.path,
    model: modelForOperation(config, operation),
    sessionId: state.sessions[plan.id] ?? null,
    timeoutMs: config.loop.iterationTimeoutMs,
    idleTimeoutMs: config.loop.idleTimeoutMs,
    onEvent: (event) => logEvent(event.kind, event.text),
  });
  record.usage = result.usage;
  if (result.sessionId) state.sessions[plan.id] = result.sessionId;

  // Revert protected-path edits even on failed runs; junk must never linger.
  const scope = await enforceWriteScope({
    cwd: worktree.path,
    scope: "code",
    protectedPaths: config.protectedPaths,
    before,
  });

  if (result.status === "quota") {
    record.status = "quota";
    record.failure = { kind: "quota_exhausted", message: result.errorMessage ?? "quota" };
    return null;
  }
  if (result.status !== "ok") {
    record.status = "failed";
    record.failure = {
      kind: failureKindFor(result),
      message: result.errorMessage ?? "provider failed",
    };
    state.pendingRepairs[plan.id] = {
      planId: plan.id,
      reason: record.failure.kind,
      message: record.failure.message,
    };
    return null;
  }
  if (scope.violations.length > 0) {
    record.status = "failed";
    record.failure = {
      kind: "write_scope_violation",
      message: scope.violations.map((v) => `${v.path} (${v.reason})`).join(", "),
    };
    state.pendingRepairs[plan.id] = {
      planId: plan.id,
      reason: "write_scope_violation",
      message: record.failure.message,
    };
    return null;
  }

  await addAllAndCommit(worktree.path, `nightcrew(${operation}): ${plan.id} iteration work`);
  record.commits = await commitsSince(worktree.path, baseline);
  const changed = await changedPathsBetween(worktree.path, baseline, "HEAD");
  record.controlOnly = record.commits.length > 0 && changed.every((path) => isControlPath(path));

  const profile = config.verify.profiles[config.verify.profile];
  let verify: VerifySummary | null = null;
  if (profile && profile.steps.length > 0) {
    verify = await runVerify(config, worktree.path);
    record.verify = verify;
    if (!verify.passed) {
      record.status = "failed";
      record.failure = {
        kind: "verify_failed",
        message: `verify profile "${verify.profile}" failed`,
      };
      state.pendingRepairs[plan.id] = {
        planId: plan.id,
        reason: "verify_failed",
        message: record.failure.message,
        verify,
      };
      return null;
    }
  }

  if (operation === "repair") {
    delete state.pendingRepairs[plan.id];
  }

  const updatedPlan = readPlan(join(worktree.path, planRel), "active") ?? planInWorktree;
  const signals = parseSignals(result.finalMessage);
  const complete = signals.complete || allCheckboxesDone(updatedPlan.body);
  if (!complete) {
    record.notes?.push("plan in progress");
    return null;
  }

  // Landing mutates the main checkout: one lane at a time.
  return await mainLock(ctx).withLock(() =>
    promotePlan(ctx, deps, state, record, updatedPlan, base, verify),
  );
}

/** Green gates + complete plan → review → land → clean up. */
async function promotePlan(
  ctx: ProjectContext,
  deps: RunnerDeps,
  state: RuntimeState,
  record: IterationRecord,
  plan: PlanDoc,
  baseBranch: string,
  verify: VerifySummary | null,
): Promise<StopOverride | null> {
  const { paths, config, root } = ctx;
  const branch = planBranch(plan.id);
  const round = (state.reviewRounds[plan.id] ?? 0) + 1;

  const review = await deps.reviewer.reviewMerge({
    plan,
    diff: await diffBetween(root, baseBranch, branch),
    verify,
    crew: controlSurface(paths.crewFile) ?? "",
    round,
  });
  record.reviews = [...(record.reviews ?? []), review];

  if (review.mode === "gate" && review.verdict === "request_changes") {
    state.reviewRounds[plan.id] = round;
    if (round >= config.review.maxReviewRounds) {
      await appendQuestion(
        ctx,
        `merge review hit max rounds (${round}) for "${plan.title}"; branch ${branch} awaits a decision: ${review.notes}`,
      );
      record.status = "failed";
      record.failure = { kind: "review_rejected", message: review.notes };
      return {
        reason: "review_escalated",
        detail: `merge review exhausted ${round} rounds for ${plan.id}`,
      };
    }
    record.status = "failed";
    record.failure = { kind: "review_rejected", message: review.notes };
    state.pendingRepairs[plan.id] = {
      planId: plan.id,
      reason: "review_rejected",
      message: "merge review requested changes",
      reviewNotes: review.notes,
    };
    return null;
  }
  if (review.mode === "gate" && review.verdict === "escalate") {
    await appendQuestion(
      ctx,
      `merge review escalated for "${plan.title}" (branch ${branch}): ${review.notes}`,
    );
    record.status = "failed";
    record.failure = { kind: "review_rejected", message: review.notes };
    return { reason: "review_escalated", detail: `merge review escalated for ${plan.id}` };
  }
  if (review.verdict !== "approve" && review.notes) {
    record.notes?.push(`merge review (${review.verdict}): ${review.notes.slice(0, 300)}`);
  }

  const completePlanFiles = async (note: string): Promise<void> => {
    const mainPlan = listPlans(paths, "active").find((candidate) => candidate.id === plan.id);
    const moved: string[] = [];
    if (mainPlan) {
      const target = movePlan(paths, mainPlan, "completed");
      moved.push(relative(root, mainPlan.file), relative(root, target));
    }
    await commitPaths(root, moved, `nightcrew: complete plan ${plan.id}${note}`);
    delete state.sessions[plan.id];
    delete state.reviewRounds[plan.id];
    if (state.activePlanId === plan.id) state.activePlanId = null;
    delete state.pendingRepairs[plan.id];
  };

  if (config.merge.policy === "branch") {
    await completePlanFiles(` (branch ${branch} awaits manual merge)`);
    await removeWorktree(paths, plan.id, { deleteBranch: "keep" });
    record.notes?.push(`branch ready for manual merge: ${branch}`);
    return null;
  }

  const outcome = await mergeBranch(root, baseBranch, branch, `nightcrew: land plan ${plan.id}`);
  switch (outcome.result) {
    case "merged": {
      record.merged = true;
      record.commits.push(outcome.sha);
      await completePlanFiles("");
      await removeWorktree(paths, plan.id, { deleteBranch: "merged" });
      record.notes?.push(`landed ${branch} into ${baseBranch}`);
      return null;
    }
    case "nothing": {
      await completePlanFiles(" (no code changes)");
      await removeWorktree(paths, plan.id, { deleteBranch: "force" });
      record.notes?.push("plan complete with no code changes to land");
      return null;
    }
    case "conflict": {
      record.status = "failed";
      record.failure = { kind: "merge_conflict", message: outcome.detail.slice(0, 2_000) };
      state.pendingRepairs[plan.id] = {
        planId: plan.id,
        reason: "merge_conflict",
        message: `branch ${branch} conflicts with ${baseBranch}; merge ${baseBranch} into the worktree and resolve`,
      };
      return null;
    }
    case "blocked": {
      record.notes?.push(`merge blocked: ${outcome.detail}`);
      return {
        reason: "operator",
        detail: `plan ${plan.id} is complete but landing is blocked: ${outcome.detail}. Branch ${branch} is preserved.`,
      };
    }
  }
}

/** verify as an explicit operation: deterministic gates only, no provider. */
async function runVerifyOp(
  ctx: ProjectContext,
  state: RuntimeState,
  record: IterationRecord,
  plan: PlanDoc | null,
): Promise<void> {
  const { paths, config } = ctx;
  const active =
    plan ??
    (state.activePlanId
      ? listPlans(paths, "active").find((p) => p.id === state.activePlanId)
      : undefined) ??
    null;
  const worktreePath = active ? join(paths.worktreesDir, active.id) : null;
  const cwd = worktreePath && existsSync(worktreePath) ? worktreePath : ctx.root;

  const verify = await runVerify(config, cwd);
  record.verify = verify;
  record.planId = active?.id ?? null;
  if (!verify.passed) {
    record.status = "failed";
    record.failure = {
      kind: "verify_failed",
      message: `verify profile "${verify.profile}" failed`,
    };
    if (active) {
      state.pendingRepairs[active.id] = {
        planId: active.id,
        reason: "verify_failed",
        message: record.failure.message,
        verify,
      };
    }
  }
}
