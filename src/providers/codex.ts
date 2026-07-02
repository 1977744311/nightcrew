import { Codex, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";
import type { TokenUsage } from "../core/types";
import {
  looksLikeQuotaError,
  type Provider,
  type ProviderEvent,
  type ProviderRunOptions,
  type ProviderRunResult,
  Watchdog,
} from "./types";

export interface CodexAdapterOptions {
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  networkAccess: boolean;
}

function mapUsage(usage: {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
  };
}

function toProviderEvent(event: ThreadEvent): ProviderEvent | null {
  switch (event.type) {
    case "thread.started":
      return { kind: "session", text: event.thread_id };
    case "turn.started":
      return { kind: "session", text: "turn started" };
    case "turn.completed":
      return {
        kind: "usage",
        text: `tokens in=${event.usage.input_tokens} out=${event.usage.output_tokens}`,
      };
    case "turn.failed":
      return { kind: "error", text: event.error.message };
    case "error":
      return { kind: "error", text: event.message };
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = event.item;
      switch (item.type) {
        case "agent_message":
          return { kind: "message", text: item.text };
        case "reasoning":
          return { kind: "reasoning", text: item.text.slice(0, 200) };
        case "command_execution":
          return { kind: "command", text: item.command };
        case "file_change":
          return {
            kind: "file_change",
            text: item.changes.map((c) => `${c.kind} ${c.path}`).join(", "),
          };
        case "mcp_tool_call":
          return { kind: "tool", text: `${item.server}.${item.tool}` };
        case "web_search":
          return { kind: "tool", text: `web_search: ${item.query}` };
        case "todo_list":
          return null;
        case "error":
          return { kind: "error", text: item.message };
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/**
 * Codex SDK adapter. Auth rides on the operator's existing Codex login
 * (ChatGPT subscription) — the SDK resolves credentials the same way the CLI
 * does. Heartbeats come from typed thread events, never from byte-counting.
 */
export class CodexProvider implements Provider {
  readonly name = "codex";

  constructor(private readonly options: CodexAdapterOptions) {}

  async run(options: ProviderRunOptions): Promise<ProviderRunResult> {
    const codex = new Codex();
    const threadOptions: ThreadOptions = {
      model: options.model,
      workingDirectory: options.workingDirectory,
      sandboxMode: options.readOnly ? "read-only" : this.options.sandbox,
      skipGitRepoCheck: true,
      approvalPolicy: "never",
      networkAccessEnabled: this.options.networkAccess,
    };

    const thread = options.sessionId
      ? codex.resumeThread(options.sessionId, threadOptions)
      : codex.startThread(threadOptions);

    const controller = new AbortController();
    const watchdog = new Watchdog(options.timeoutMs, options.idleTimeoutMs, () =>
      controller.abort(),
    );

    let sessionId: string | null = options.sessionId ?? null;
    let finalMessage = "";
    let usage: TokenUsage | null = null;
    let errorMessage: string | undefined;

    try {
      const { events } = await thread.runStreamed(options.prompt, {
        signal: controller.signal,
        outputSchema: options.outputSchema,
      });
      for await (const event of events) {
        watchdog.touch();
        if (event.type === "thread.started") sessionId = event.thread_id;
        if (event.type === "turn.completed") usage = mapUsage(event.usage);
        if (event.type === "turn.failed") errorMessage = event.error.message;
        if (event.type === "error") errorMessage = event.message;
        if (
          (event.type === "item.completed" || event.type === "item.updated") &&
          event.item.type === "agent_message"
        ) {
          finalMessage = event.item.text;
        }
        const mapped = toProviderEvent(event);
        if (mapped) options.onEvent?.(mapped);
      }
    } catch (error) {
      if (!watchdog.fired) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    } finally {
      watchdog.stop();
    }

    if (watchdog.fired === "timeout") {
      return {
        status: "timeout",
        finalMessage,
        sessionId,
        usage,
        errorMessage: "iteration timeout",
      };
    }
    if (watchdog.fired === "idle_timeout") {
      return {
        status: "idle_timeout",
        finalMessage,
        sessionId,
        usage,
        errorMessage: "no provider events within idle timeout",
      };
    }
    if (errorMessage) {
      return {
        status: looksLikeQuotaError(errorMessage) ? "quota" : "error",
        finalMessage,
        sessionId,
        usage,
        errorMessage,
      };
    }
    return { status: "ok", finalMessage, sessionId, usage };
  }
}
