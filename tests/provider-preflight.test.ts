import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configSchema } from "../src/config/schema";
import {
  assertProviderPreflight,
  ProviderPreflightError,
  preflightProvider,
} from "../src/providers/preflight";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempCodexHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "nightcrew-codex-home-"));
  tempDirs.push(dir);
  return dir;
}

function config(provider: Record<string, unknown>) {
  return configSchema.parse({
    project: { name: "demo", baseBranch: "main" },
    provider,
  });
}

describe("provider preflight", () => {
  it("skips fake provider auth checks", () => {
    const parsed = config({ default: "fake", fake: { script: "fake.json" } });

    const result = preflightProvider(parsed);

    expect(result).toMatchObject({
      name: "provider auth",
      ok: true,
      status: "skip",
      provider: "fake",
    });
  });

  it("passes when Codex auth.json is readable JSON", () => {
    const codexHome = tempCodexHome();
    writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ tokens: { access: "test" } }));
    const parsed = config({ default: "codex" });

    const result = preflightProvider(parsed, { codexHome });

    expect(result).toMatchObject({
      ok: true,
      status: "pass",
      provider: "codex",
    });
    expect(result.detail).toContain("auth.json");
  });

  it("fails with a codex login hint when auth is missing or invalid", () => {
    const codexHome = tempCodexHome();
    const parsed = config({ default: "codex" });

    const missing = preflightProvider(parsed, { codexHome });
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain("codex login");

    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, "auth.json"), "not json");
    const invalid = preflightProvider(parsed, { codexHome });
    expect(invalid.ok).toBe(false);
    expect(invalid.detail).toContain("codex login");
  });

  it("throws a typed startup error for failed Codex preflight", () => {
    const parsed = config({ default: "codex" });

    expect(() => assertProviderPreflight(parsed, { codexHome: tempCodexHome() })).toThrow(
      ProviderPreflightError,
    );
    try {
      assertProviderPreflight(parsed, { codexHome: tempCodexHome() });
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderPreflightError);
      expect((error as ProviderPreflightError).code).toBe("provider_preflight_failed");
    }
  });
});
