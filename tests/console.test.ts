import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createConsoleServer } from "../src/console/server";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject;
let server: Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server?.close(resolve));
    server = null;
  }
  project?.cleanup();
});

async function listen(actions = false): Promise<string> {
  server = createConsoleServer({ port: 0, actions });
  await new Promise((resolve) => server?.once("listening", resolve));
  const address = server?.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}`;
}

describe("console API", () => {
  it("serves the board, project detail, and the HTML shell", async () => {
    project = await makeTempProject();
    project.setCrew(["One feature"]);
    project.setScript([
      {
        match: "operation = \\*\\*plan\\*\\*",
        actions: [
          {
            type: "write",
            path: ".nightcrew/plans/active/2026-07-02-one.md",
            content: planFileContents("2026-07-02-one", "One"),
          },
        ],
      },
    ]);
    await project.run();

    const base = await listen();

    const page = await (await fetch(`${base}/`)).text();
    expect(page).toContain("nightcrew console");

    const projects = (await (await fetch(`${base}/api/projects`)).json()) as Array<{
      name: string;
      ok: boolean;
      activePlans: number;
    }>;
    const demo = projects.find((p) => p.name === "demo");
    expect(demo?.ok).toBe(true);
    expect(demo?.activePlans).toBe(1);

    const detail = (await (await fetch(`${base}/api/projects/demo`)).json()) as {
      name: string;
      plans: { active: Array<{ id: string }> };
      history: unknown[];
      budget: { iterations: number };
    };
    expect(detail.name).toBe("demo");
    expect(detail.plans.active[0]?.id).toBe("2026-07-02-one");
    expect(detail.history.length).toBe(1);
    expect(detail.budget.iterations).toBe(1);

    const missing = await fetch(`${base}/api/projects/nope`);
    expect(missing.status).toBe(404);
  });

  it("rejects actions unless enabled, honors them when enabled", async () => {
    project = await makeTempProject();
    const readonlyBase = await listen(false);
    const denied = await fetch(`${readonlyBase}/api/projects/demo/pause`, { method: "POST" });
    expect(denied.status).toBe(404);
    await new Promise((resolve) => server?.close(resolve));
    server = null;

    const base = await listen(true);
    const paused = await fetch(`${base}/api/projects/demo/pause`, {
      method: "POST",
      body: JSON.stringify({ reason: "coffee break" }),
    });
    expect(paused.status).toBe(200);
    const { readState } = await import("../src/state/state");
    expect(readState(project.ctx().paths).paused).toBe(true);
    expect(readState(project.ctx().paths).pausedReason).toBe("coffee break");

    const resumed = await fetch(`${base}/api/projects/demo/resume`, { method: "POST" });
    expect(resumed.status).toBe(200);
    expect(readState(project.ctx().paths).paused).toBe(false);
  });
});
