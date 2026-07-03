import { describe, expect, it } from "vitest";
import { configSchema } from "../src/config/schema";

describe("config schema", () => {
  it("applies defaults on a minimal config", () => {
    const config = configSchema.parse({ project: { name: "demo" } });
    expect(config.version).toBe(1);
    expect(config.provider.default).toBe("codex");
    expect(config.provider.codex.sandbox).toBe("workspace-write");
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
    expect(config.protectedPaths).toContain(".nightcrew/config.yaml");
    expect(config.verify.profile).toBe("default");
  });

  it("rejects unknown keys loudly", () => {
    expect(() =>
      configSchema.parse({ project: { name: "demo" }, loop: { maxFailureStrek: 5 } }),
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
