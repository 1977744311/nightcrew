import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TokenUsage } from "../core/types";
import { runShell } from "../utils/process";
import type { Provider, ProviderRunOptions, ProviderRunResult } from "./types";
import { Watchdog } from "./types";

/**
 * Deterministic scripted provider for synthetic e2e tests (and offline demos).
 * The script file is a JSON array; each run consumes the first unconsumed
 * entry whose `match` regex (if any) matches the prompt.
 */

export interface FakeAction {
  type: "write" | "append" | "delete" | "exec" | "commit";
  path?: string;
  content?: string;
  command?: string;
  message?: string;
}

export interface FakeScriptEntry {
  /** Regex tested against the rendered prompt. Omit to match anything. */
  match?: string;
  actions?: FakeAction[];
  finalMessage?: string;
  structuredOutput?: unknown;
  status?: "ok" | "error" | "quota";
  errorMessage?: string;
  requireOutputSchema?: boolean;
  expectReadOnly?: boolean;
  expectModel?: string | null;
  /** Sleep without emitting events — trips the idle watchdog in tests. */
  silentMs?: number;
  usage?: Partial<TokenUsage>;
}

interface Cursor {
  consumed: number[];
}

function readScript(file: string): FakeScriptEntry[] {
  return JSON.parse(readFileSync(file, "utf8")) as FakeScriptEntry[];
}

function cursorFile(script: string): string {
  return `${script}.cursor.json`;
}

function readCursor(script: string): Cursor {
  const file = cursorFile(script);
  if (!existsSync(file)) return { consumed: [] };
  return JSON.parse(readFileSync(file, "utf8")) as Cursor;
}

function writeCursor(script: string, cursor: Cursor): void {
  writeFileSync(cursorFile(script), JSON.stringify(cursor));
}

async function applyAction(action: FakeAction, cwd: string): Promise<void> {
  const target = action.path ? resolve(cwd, action.path) : null;
  switch (action.type) {
    case "write": {
      if (!target) throw new Error("write action requires path");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, action.content ?? "", "utf8");
      return;
    }
    case "append": {
      if (!target) throw new Error("append action requires path");
      mkdirSync(dirname(target), { recursive: true });
      const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
      writeFileSync(target, existing + (action.content ?? ""), "utf8");
      return;
    }
    case "delete": {
      if (!target) throw new Error("delete action requires path");
      rmSync(target, { force: true, recursive: true });
      return;
    }
    case "exec": {
      if (!action.command) throw new Error("exec action requires command");
      await runShell(action.command, { cwd, timeoutMs: 60_000 });
      return;
    }
    case "commit": {
      const message = action.message ?? "fake: commit";
      await runShell(
        `git add -A && git -c user.name=fake -c user.email=fake@nightcrew.local commit -m ${JSON.stringify(message)} --allow-empty`,
        { cwd, timeoutMs: 60_000 },
      );
      return;
    }
  }
}

export class FakeProvider implements Provider {
  readonly name = "fake";

  constructor(private readonly scriptFile: string) {}

  async run(options: ProviderRunOptions): Promise<ProviderRunResult> {
    const script = readScript(this.scriptFile);
    const cursor = readCursor(this.scriptFile);

    let index = -1;
    for (let i = 0; i < script.length; i += 1) {
      if (cursor.consumed.includes(i)) continue;
      const entry = script[i];
      if (!entry) continue;
      if (entry.match && !new RegExp(entry.match, "s").test(options.prompt)) continue;
      index = i;
      break;
    }

    const sessionId = options.sessionId ?? `fake-session-${Math.random().toString(36).slice(2, 8)}`;
    if (index === -1) {
      return { status: "ok", finalMessage: "IDLE", sessionId, usage: null };
    }

    cursor.consumed.push(index);
    writeCursor(this.scriptFile, cursor);
    const entry = script[index] as FakeScriptEntry;
    const expectationFailure =
      entry.requireOutputSchema && !options.outputSchema
        ? "fake provider expected outputSchema"
        : entry.expectReadOnly !== undefined && entry.expectReadOnly !== (options.readOnly ?? false)
          ? `fake provider expected readOnly=${entry.expectReadOnly}`
          : entry.expectModel !== undefined && entry.expectModel !== (options.model ?? null)
            ? `fake provider expected model=${entry.expectModel ?? "unset"}`
            : null;

    const controller = new AbortController();
    const watchdog = new Watchdog(options.timeoutMs, options.idleTimeoutMs, () =>
      controller.abort(),
    );

    try {
      options.onEvent?.({ kind: "session", text: sessionId });
      watchdog.touch();

      if (entry.silentMs) {
        await new Promise<void>((resolveSleep) => {
          const timer = setTimeout(resolveSleep, entry.silentMs);
          controller.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolveSleep();
          });
        });
      }

      if (watchdog.fired === "timeout") {
        return {
          status: "timeout",
          finalMessage: "",
          sessionId,
          usage: null,
          errorMessage: "iteration timeout",
        };
      }
      if (watchdog.fired === "idle_timeout") {
        return {
          status: "idle_timeout",
          finalMessage: "",
          sessionId,
          usage: null,
          errorMessage: "no provider events within idle timeout",
        };
      }

      const usage: TokenUsage = {
        inputTokens: entry.usage?.inputTokens ?? 1_000,
        cachedInputTokens: entry.usage?.cachedInputTokens ?? 0,
        outputTokens: entry.usage?.outputTokens ?? 200,
        reasoningOutputTokens: entry.usage?.reasoningOutputTokens ?? 0,
      };
      const finalMessage =
        entry.structuredOutput === undefined
          ? (entry.finalMessage ?? "DONE")
          : JSON.stringify(entry.structuredOutput);

      if (expectationFailure) {
        return {
          status: "error",
          finalMessage,
          sessionId,
          usage,
          errorMessage: expectationFailure,
        };
      }

      for (const action of entry.actions ?? []) {
        await applyAction(action, options.workingDirectory);
        options.onEvent?.({
          kind: "command",
          text: `${action.type} ${action.path ?? action.command ?? ""}`,
        });
        watchdog.touch();
      }

      if (entry.status === "error") {
        return {
          status: "error",
          finalMessage,
          sessionId,
          usage,
          errorMessage: entry.errorMessage ?? "fake provider error",
        };
      }
      if (entry.status === "quota") {
        return {
          status: "quota",
          finalMessage,
          sessionId,
          usage,
          errorMessage: entry.errorMessage ?? "usage limit reached",
        };
      }
      return { status: "ok", finalMessage, sessionId, usage };
    } finally {
      watchdog.stop();
    }
  }
}
