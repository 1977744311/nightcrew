import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configSchema, NOTIFY_EVENTS } from "../src/config/schema";
import { webSearchModeFor } from "../src/providers/factory";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("config schema", () => {
  it("keeps the committed JSON Schema in sync with the zod schema", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/generate-config-schema.mjs", "--check"],
        { cwd: repoRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("applies defaults on a minimal config", () => {
    const config = configSchema.parse({ project: { name: "demo" } });
    expect(config.version).toBe(1);
    expect(config.provider.default).toBe("codex");
    expect(config.provider.codex.sandbox).toBe("workspace-write");
    expect(config.provider.codex.webSearch).toBe("cached");
    expect(config.provider.codex.webSearchOverrides).toEqual({});
    expect(config.routing).toEqual({
      plan: "light",
      execute: "heavy",
      repair: "heavy",
      garden: "light",
      review: "light",
      propose: "light",
    });
    expect(config.loop.maxFailureStreak).toBe(3);
    expect(config.loop.maxNoCommitStreak).toBe(3);
    expect(config.loop.maxControlOnlyStreak).toBe(3);
    expect(config.loop.gardenEvery).toBe(8);
    expect(config.review.mode).toBe("advisory");
    expect(config.review.maxReviewRounds).toBe(2);
    expect(config.merge.policy).toBe("auto");
    expect(config.notify).toEqual({ events: [...NOTIFY_EVENTS] });
    expect(config.protectedPaths).toContain(".nightcrew/config.yaml");
    expect(config.verify.profile).toBe("default");
  });

  it("rejects unknown keys loudly", () => {
    expect(() =>
      configSchema.parse({ project: { name: "demo" }, loop: { maxFailureStrek: 5 } }),
    ).toThrow();
  });

  it("parses Codex web-search modes and resolves operation overrides", () => {
    const config = configSchema.parse({
      project: { name: "demo" },
      provider: {
        codex: {
          webSearch: "cached",
          webSearchOverrides: {
            propose: "live",
            execute: "disabled",
          },
        },
      },
    });

    expect(webSearchModeFor(config, "propose")).toBe("live");
    expect(webSearchModeFor(config, "execute")).toBe("disabled");
    expect(webSearchModeFor(config, "review")).toBe("cached");
  });

  it("rejects invalid Codex web-search modes and override keys", () => {
    expect(() =>
      configSchema.parse({
        project: { name: "demo" },
        provider: { codex: { webSearch: "online" } },
      }),
    ).toThrow();
    expect(() =>
      configSchema.parse({
        project: { name: "demo" },
        provider: { codex: { webSearchOverrides: { proposee: "live" } } },
      }),
    ).toThrow();
  });

  it("parses notify webhook URLs and optional event filters", () => {
    const config = configSchema.parse({
      project: { name: "demo" },
      notify: {
        webhook: "https://hooks.example.test/nightcrew",
        events: ["loop_stopped", "proposal_landed"],
      },
    });

    expect(config.notify.webhook).toBe("https://hooks.example.test/nightcrew");
    expect(config.notify.events).toEqual(["loop_stopped", "proposal_landed"]);
  });

  it("rejects malformed notify webhooks and event names", () => {
    expect(() =>
      configSchema.parse({
        project: { name: "demo" },
        notify: { webhook: "not a url" },
      }),
    ).toThrow();
    expect(() =>
      configSchema.parse({
        project: { name: "demo" },
        notify: { events: ["loop_stoped"] },
      }),
    ).toThrow();
  });

  it("rejects malformed schedule windows", () => {
    expect(() =>
      configSchema.parse({ project: { name: "demo" }, schedule: { windows: ["25:00-07:00"] } }),
    ).toThrow();
    const ok = configSchema.parse({
      project: { name: "demo" },
      schedule: { windows: ["23:00-07:00"] },
    });
    expect(ok.schedule.windows).toEqual(["23:00-07:00"]);
  });

  it("requires a project name", () => {
    expect(() => configSchema.parse({})).toThrow();
    expect(() => configSchema.parse({ project: { name: "" } })).toThrow();
  });
});
