import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maybeRunCanary } from "../src/loop/canary";
import type { NotifyPayload } from "../src/notify/webhook";
import { readState, updateState } from "../src/state/state";
import { makeTempProject, type TestProject } from "./helpers";

let project: TestProject | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  project?.cleanup();
  project = undefined;
});

function captureFetch(): { posts: NotifyPayload[] } {
  const posts: NotifyPayload[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    posts.push(JSON.parse(String(init?.body)) as NotifyPayload);
    return { ok: true, status: 204 } as Response;
  });
  return { posts };
}

function canaryConfig(run: string): Record<string, unknown> {
  return {
    canary: { profile: "canary" },
    verify: {
      profile: "default",
      profiles: {
        default: { steps: [] },
        canary: { steps: [{ name: "probe", run, timeoutMs: 30_000 }] },
      },
    },
  };
}

function qaContents(): string {
  if (!project) throw new Error("project not initialized");
  return readFileSync(join(project.root, ".nightcrew", "qa.md"), "utf8");
}

function ageLastCanaryAttempt(hoursAgo: number): void {
  if (!project) throw new Error("project not initialized");
  updateState(project.ctx().paths, (state) => {
    if (!state.canary) throw new Error("no canary state to age");
    state.canary.at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  });
}

describe("maybeRunCanary", () => {
  it("is disabled until a canary profile is configured", async () => {
    project = await makeTempProject();
    expect(await maybeRunCanary(project.ctx())).toBe("disabled");
    expect(readState(project.ctx().paths).canary).toBeUndefined();
  });

  it("passes, stamps state, and skips within the everyHours window", async () => {
    project = await makeTempProject(canaryConfig("echo canary-ok"));
    expect(await maybeRunCanary(project.ctx())).toBe("passed");

    const stamp = readState(project.ctx().paths).canary;
    expect(stamp?.ok).toBe(true);
    expect(stamp?.profile).toBe("canary");

    expect(await maybeRunCanary(project.ctx())).toBe("skipped");
  });

  it("reruns after the window elapses", async () => {
    project = await makeTempProject(canaryConfig("echo canary-ok"));
    expect(await maybeRunCanary(project.ctx())).toBe("passed");
    ageLastCanaryAttempt(21);
    expect(await maybeRunCanary(project.ctx())).toBe("passed");
  });

  it("records a failure in qa.md, notifies, and dedupes repeat failures", async () => {
    project = await makeTempProject({
      ...canaryConfig("echo integration broke >&2; exit 3"),
      notify: { webhook: "https://hooks.example.test/nightcrew", events: ["canary_failed"] },
    });
    const { posts } = captureFetch();

    expect(await maybeRunCanary(project.ctx())).toBe("failed");

    const qa = qaContents();
    expect(qa).toContain('- canary step "probe" failed (exit 3): integration broke');
    expect(readState(project.ctx().paths).canary?.ok).toBe(false);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.event).toBe("canary_failed");
    expect(posts[0]?.detail).toContain('canary step "probe" failed');

    // Same failure next night: no duplicate qa.md bullet.
    ageLastCanaryAttempt(21);
    expect(await maybeRunCanary(project.ctx())).toBe("failed");
    const again = qaContents();
    expect(again.match(/canary step "probe" failed/g)).toHaveLength(1);
  });

  it("treats an unknown canary profile as a failure, not a crash", async () => {
    project = await makeTempProject({ canary: { profile: "ghost" } });
    expect(await maybeRunCanary(project.ctx())).toBe("failed");
    expect(qaContents()).toContain('canary step "profile" failed');
  });

  it("runs before loop iterations and lands the failure ahead of qa triage", async () => {
    project = await makeTempProject({
      ...canaryConfig("echo smoke gap >&2; exit 1"),
      loop: { maxIterations: 1 },
    });
    project.setScript([]);

    await project.loop({ maxIterations: 1 });

    expect(qaContents()).toContain('- canary step "probe" failed (exit 1): smoke gap');
    // The same wake-up already attempted triage on the fresh bullet.
    expect(readState(project.ctx().paths).qaTriage).toBeDefined();
  });
});
