import type { CodexWebSearchMode } from "../config/schema";
import type { TokenUsage } from "../core/types";

/**
 * The provider seam. nightcrew owns the outer loop; a Provider owns exactly
 * one inner iteration. Adapters are one file per vendor and must converge on
 * this interface — a breaking SDK change is absorbed inside the adapter.
 */

export type ProviderEventKind =
  | "session"
  | "message"
  | "reasoning"
  | "command"
  | "file_change"
  | "tool"
  | "usage"
  | "error";

export interface ProviderEvent {
  kind: ProviderEventKind;
  text: string;
}

export type ProviderRunStatus = "ok" | "error" | "timeout" | "idle_timeout" | "quota";

export interface ProviderRunOptions {
  prompt: string;
  workingDirectory: string;
  model?: string;
  /** Resume an existing provider session/thread when set. */
  sessionId?: string | null;
  timeoutMs: number;
  /** Abort when no provider events arrive for this long (buffered-output trap). */
  idleTimeoutMs: number;
  readOnly?: boolean;
  /** Codex web-search behavior for this provider run. Non-Codex adapters may ignore it. */
  webSearchMode?: CodexWebSearchMode;
  /** JSON schema for structured output (used by review). */
  outputSchema?: unknown;
  onEvent?: (event: ProviderEvent) => void;
}

export interface ProviderRunResult {
  status: ProviderRunStatus;
  finalMessage: string;
  sessionId: string | null;
  usage: TokenUsage | null;
  errorMessage?: string;
}

export interface Provider {
  readonly name: string;
  run(options: ProviderRunOptions): Promise<ProviderRunResult>;
}

/** Overall + idle watchdog shared by adapters. */
export class Watchdog {
  private idleTimer: NodeJS.Timeout | null = null;
  private overallTimer: NodeJS.Timeout | null = null;
  fired: "timeout" | "idle_timeout" | null = null;

  constructor(
    private readonly timeoutMs: number,
    private readonly idleTimeoutMs: number,
    private readonly onFire: (kind: "timeout" | "idle_timeout") => void,
  ) {
    this.overallTimer = setTimeout(() => this.fire("timeout"), this.timeoutMs);
    this.touch();
  }

  private fire(kind: "timeout" | "idle_timeout"): void {
    if (this.fired) return;
    this.fired = kind;
    this.onFire(kind);
  }

  /** Call on every provider event to prove liveness. */
  touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.fire("idle_timeout"), this.idleTimeoutMs);
  }

  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.overallTimer) clearTimeout(this.overallTimer);
    this.idleTimer = null;
    this.overallTimer = null;
  }
}

const QUOTA_RE = /usage limit|rate.?limit|quota|too many requests|429|insufficient_quota/i;

export function looksLikeQuotaError(message: string): boolean {
  return QUOTA_RE.test(message);
}
