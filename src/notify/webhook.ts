import type { ProjectContext } from "../config/load";
import type { NotifyEvent } from "../config/schema";
import type { StopReason } from "../core/types";
import { listPendingProposals } from "../proposals/proposals";
import { parseQuestions } from "../questions/questions";
import { readHistory } from "../state/history";
import { readTextIfExists } from "../utils/fs";
import { log } from "../utils/log";

export interface NotifyCounts {
  landed: number;
  failed: number;
  openQuestions: number;
  pendingProposals: number;
}

export interface NotifyPayload {
  event: NotifyEvent;
  project: string;
  counts: NotifyCounts;
  consoleUrl: string;
  reason?: StopReason;
  detail?: string;
  question?: string;
  proposalId?: string;
  selectedItems?: number;
}

export type NotifyPost = (webhook: string, payload: NotifyPayload) => Promise<void>;

export interface NotifyOptions {
  post?: NotifyPost;
  warn?: (message: string) => void;
}

export type NotifyInput =
  | { event: "loop_stopped"; reason: StopReason; detail?: string }
  | { event: "open_question"; question: string }
  | { event: "proposal_landed"; proposalId: string; selectedItems: number };

const DEFAULT_CONSOLE_URL = "http://127.0.0.1:4711";
const DEFAULT_TIMEOUT_MS = 5_000;

export function notificationCounts(ctx: ProjectContext): NotifyCounts {
  const history = readHistory(ctx.paths);
  const questions = parseQuestions(readTextIfExists(ctx.paths.questionsFile) ?? "");
  return {
    landed: history.filter((record) => record.merged).length,
    failed: history.filter((record) => record.status === "failed").length,
    openQuestions: questions.filter((entry) => !entry.checked && !entry.answer).length,
    pendingProposals: listPendingProposals(ctx.paths).length,
  };
}

export function buildNotifyPayload(ctx: ProjectContext, input: NotifyInput): NotifyPayload {
  const base = {
    event: input.event,
    project: ctx.config.project.name,
    counts: notificationCounts(ctx),
    consoleUrl: DEFAULT_CONSOLE_URL,
  };
  switch (input.event) {
    case "loop_stopped":
      return { ...base, reason: input.reason, detail: input.detail };
    case "open_question":
      return { ...base, question: input.question };
    case "proposal_landed":
      return {
        ...base,
        proposalId: input.proposalId,
        selectedItems: input.selectedItems,
      };
  }
}

async function postJson(webhook: string, payload: NotifyPayload): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function notifyWebhook(
  ctx: ProjectContext,
  input: NotifyInput,
  options: NotifyOptions = {},
): Promise<NotifyPayload | null> {
  const webhook = ctx.config.notify.webhook;
  if (!webhook || !ctx.config.notify.events.includes(input.event)) return null;

  try {
    const payload = buildNotifyPayload(ctx, input);
    await (options.post ?? postJson)(webhook, payload);
    return payload;
  } catch (error) {
    (options.warn ?? log.warn)(
      `${ctx.config.project.name}: notify webhook ${input.event} failed: ${errorMessage(error)}`,
    );
    return null;
  }
}
