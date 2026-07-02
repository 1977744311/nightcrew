import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CodexProvider } from "../src/providers/codex";

/**
 * Real-SDK smoke test. Costs a (tiny) amount of the operator's Codex quota,
 * so it never runs in CI: NIGHTCREW_SMOKE=1 npm test -- codex-smoke
 */
const enabled = process.env.NIGHTCREW_SMOKE === "1";

const dir = mkdtempSync(join(tmpdir(), "nightcrew-smoke-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!enabled)("codex adapter smoke", () => {
  it("runs one tiny read-only turn on the operator's subscription", async () => {
    writeFileSync(join(dir, "marker.txt"), "nightcrew smoke marker 4711\n");
    const provider = new CodexProvider({ sandbox: "read-only", networkAccess: false });
    const events: string[] = [];

    const result = await provider.run({
      prompt:
        "Read the file marker.txt in the working directory and reply with exactly its numeric code. Reply with only the number.",
      workingDirectory: dir,
      sessionId: null,
      timeoutMs: 300_000,
      idleTimeoutMs: 120_000,
      readOnly: true,
      onEvent: (event) => events.push(event.kind),
    });

    expect(result.status).toBe("ok");
    expect(result.finalMessage).toContain("4711");
    expect(result.sessionId).toBeTruthy();
    expect(result.usage?.inputTokens ?? 0).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
  }, 300_000);
});
