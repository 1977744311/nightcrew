import { appendFileSync } from "node:fs";
import type { ProjectContext } from "../config/load";
import type { VerifyStepResult } from "../core/types";
import { notifyWebhook } from "../notify/webhook";
import { emitEvent } from "../state/events";
import { readState, updateState } from "../state/state";
import { readTextIfExists } from "../utils/fs";
import { isoNow } from "../utils/id";
import { log } from "../utils/log";
import { runVerify } from "../verify/verify";

export type CanaryOutcome = "disabled" | "skipped" | "passed" | "failed";

function oneLine(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function failureDetail(step: VerifyStepResult): string {
  const exit = step.exitCode === null ? "timeout" : `exit ${step.exitCode}`;
  return `canary step "${step.name}" failed (${exit}): ${oneLine(step.outputTail)}`;
}

/**
 * The scheduled real-world smoke. Unlike verify (which gates a plan's diff in
 * its worktree), the canary runs in the project root outside any agent
 * sandbox, so its steps can exercise live integrations — real provider calls,
 * gh auth, webhook endpoints — that fake-provider tests structurally cannot.
 * A failure is advisory: it lands in qa.md (where triage drafts a fix
 * proposal) and fires the canary_failed webhook, but never blocks the loop.
 * Never throws.
 */
export async function maybeRunCanary(ctx: ProjectContext): Promise<CanaryOutcome> {
  const { config, paths } = ctx;
  const profile = config.canary.profile;
  if (!profile) return "disabled";

  const last = readState(paths).canary;
  const windowMs = config.canary.everyHours * 3_600_000;
  if (last && Date.now() - Date.parse(last.at) < windowMs) return "skipped";

  const startedAt = isoNow();
  log.info(`${config.project.name}: canary "${profile}" starting`);

  try {
    const summary = await runVerify(config, ctx.root, profile);
    updateState(paths, (state) => {
      state.canary = { at: startedAt, ok: summary.passed, profile };
    });

    if (summary.passed) {
      emitEvent(paths, config.project.name, "canary.passed", { profile });
      log.info(`${config.project.name}: canary "${profile}" passed`);
      return "passed";
    }

    const failed = summary.steps.find((step) => !step.ok);
    const detail = failed
      ? failureDetail(failed)
      : `canary profile "${profile}" failed without a step result`;
    recordCanaryFailure(ctx, detail);
    await notifyWebhook(ctx, { event: "canary_failed", detail });
    return "failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateState(paths, (state) => {
      state.canary = { at: startedAt, ok: false, profile };
    });
    recordCanaryFailure(ctx, `canary "${profile}" crashed: ${oneLine(message)}`);
    await notifyWebhook(ctx, { event: "canary_failed", detail: message });
    return "failed";
  }
}

/**
 * Append the failure to qa.md so the existing triage loop turns it into a
 * pending fix proposal. Deduped on the step marker so a broken integration
 * does not restate itself every night.
 */
function recordCanaryFailure(ctx: ProjectContext, detail: string): void {
  const { paths, config } = ctx;
  emitEvent(paths, config.project.name, "canary.failed", { detail });
  log.warn(`${config.project.name}: ${detail}`);

  const marker = detail.split(":")[0] ?? detail;
  const existing = readTextIfExists(paths.qaFile) ?? "";
  if (existing.includes(marker)) return;

  const separator = existing.endsWith("\n") || existing === "" ? "" : "\n";
  appendFileSync(paths.qaFile, `${separator}- ${detail}\n`, "utf8");
}
