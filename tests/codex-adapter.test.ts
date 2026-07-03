import { beforeEach, describe, expect, it, vi } from "vitest";

const codexMock = vi.hoisted(() => {
  const runStreamed = vi.fn();
  const startThread = vi.fn();
  const resumeThread = vi.fn();
  const Codex = vi.fn(function Codex() {
    return { startThread, resumeThread };
  });
  return { Codex, resumeThread, runStreamed, startThread };
});

vi.mock("@openai/codex-sdk", () => ({ Codex: codexMock.Codex }));

import { CodexProvider } from "../src/providers/codex";

function streamEvents() {
  return (async function* () {
    yield { type: "thread.started", thread_id: "thread-1" };
    yield {
      type: "item.completed",
      item: { id: "item-1", type: "agent_message", text: "done" },
    };
    yield {
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 2,
        output_tokens: 3,
        reasoning_output_tokens: 1,
      },
    };
  })();
}

beforeEach(() => {
  vi.clearAllMocks();
  codexMock.runStreamed.mockImplementation(async () => ({ events: streamEvents() }));
  codexMock.startThread.mockReturnValue({ runStreamed: codexMock.runStreamed });
  codexMock.resumeThread.mockReturnValue({ runStreamed: codexMock.runStreamed });
});

describe("CodexProvider", () => {
  it("passes default and per-run webSearchMode values to ThreadOptions", async () => {
    const provider = new CodexProvider({
      sandbox: "workspace-write",
      networkAccess: false,
      webSearchMode: "cached",
    });

    await provider.run({
      prompt: "first",
      workingDirectory: "/tmp",
      model: "proposal-light",
      sessionId: null,
      timeoutMs: 60_000,
      idleTimeoutMs: 60_000,
    });

    expect(codexMock.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "proposal-light",
        sandboxMode: "workspace-write",
        webSearchMode: "cached",
      }),
    );

    await provider.run({
      prompt: "second",
      workingDirectory: "/tmp",
      model: "proposal-heavy",
      sessionId: "thread-existing",
      timeoutMs: 60_000,
      idleTimeoutMs: 60_000,
      readOnly: true,
      webSearchMode: "live",
    });

    expect(codexMock.resumeThread).toHaveBeenCalledWith(
      "thread-existing",
      expect.objectContaining({
        model: "proposal-heavy",
        sandboxMode: "read-only",
        webSearchMode: "live",
      }),
    );
  });
});
