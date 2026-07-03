import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConsoleHandler } from "../src/console/server";
import type { IterationRecord, TokenUsage } from "../src/core/types";
import { appendItemsToBacklog, writeProposalArtifact } from "../src/proposals/proposals";
import { appendHistory } from "../src/state/history";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject;
let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;

afterEach(() => {
  handler = null;
  project?.cleanup();
});

function listen(actions = false): void {
  handler = createConsoleHandler({ actions });
}

async function request(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; text: string; json: <T>() => T }> {
  if (!handler) throw new Error("console test handler is not initialized");
  const body =
    options.body === undefined
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  const bodyBuffer = body ? Buffer.from(body) : null;
  const req = {
    method: options.method ?? "GET",
    url: path,
    async *[Symbol.asyncIterator]() {
      if (bodyBuffer) yield bodyBuffer;
    },
  } as unknown as IncomingMessage;
  let status = 200;
  const chunks: Buffer[] = [];
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return this;
    },
    on() {
      return this;
    },
  } as unknown as ServerResponse;

  await handler(req, res);
  const text = Buffer.concat(chunks).toString("utf8");
  return {
    status,
    text,
    json: <T>() => JSON.parse(text) as T,
  };
}

function candidate(title: string, lens: string) {
  return {
    title,
    body: [
      `- [ ] ${title}: approve the ${lens} proposal.`,
      "      Keep the backlog text unchanged.",
      "      Tests included.",
    ].join("\n"),
    rationale: `${lens} rationale`,
  };
}

function usage(inputTokens: number, outputTokens = 0, reasoningOutputTokens = 0): TokenUsage {
  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningOutputTokens,
  };
}

function record(startedAt: string, options: Partial<IterationRecord> = {}): IterationRecord {
  return {
    id: `iteration-${startedAt}`,
    projectName: "demo",
    startedAt,
    endedAt: startedAt,
    durationMs: 1,
    operation: "execute",
    planId: null,
    status: "success",
    commits: [],
    controlOnly: false,
    usage: null,
    merged: false,
    ...options,
  };
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

    listen();

    const page = (await request("/")).text;
    expect(page).toContain("nightcrew console");

    const projects = (await request("/api/projects")).json<
      Array<{
        name: string;
        ok: boolean;
        activePlans: number;
      }>
    >();
    const demo = projects.find((p) => p.name === "demo");
    expect(demo?.ok).toBe(true);
    expect(demo?.activePlans).toBe(1);

    const detail = (await request("/api/projects/demo")).json<{
      name: string;
      plans: { active: Array<{ id: string }> };
      history: unknown[];
      budget: { iterations: number };
    }>();
    expect(detail.name).toBe("demo");
    expect(detail.plans.active[0]?.id).toBe("2026-07-02-one");
    expect(detail.history.length).toBe(1);
    expect(detail.budget.iterations).toBe(1);

    const missing = await request("/api/projects/nope");
    expect(missing.status).toBe(404);
  });

  it("exposes stable per-plan metrics on project detail", async () => {
    project = await makeTempProject();
    writeFileSync(
      join(project.root, ".nightcrew/plans/completed/2026-07-02-ship.md"),
      planFileContents("2026-07-02-ship", "Ship the feature"),
    );
    writeFileSync(
      join(project.root, ".nightcrew/plans/active/2026-07-02-polish.md"),
      planFileContents("2026-07-02-polish", "Polish the feature"),
    );

    appendHistory(
      project.ctx().paths,
      record("2026-07-02T10:00:00.000Z", {
        planId: "2026-07-02-ship",
        durationMs: 2_000,
        usage: usage(200, 20, 5),
      }),
    );
    appendHistory(
      project.ctx().paths,
      record("2026-07-02T10:30:00.000Z", {
        planId: "2026-07-02-ship",
        durationMs: 4_000,
        merged: true,
        usage: usage(40),
      }),
    );
    appendHistory(
      project.ctx().paths,
      record("2026-07-02T11:00:00.000Z", {
        planId: "2026-07-02-polish",
        durationMs: 90_000,
        status: "failed",
        failure: { kind: "provider_error", message: "provider failed" },
        usage: usage(10),
      }),
    );
    appendHistory(
      project.ctx().paths,
      record("2026-07-02T11:30:00.000Z", {
        operation: "garden",
        durationMs: 9_000,
        usage: usage(1_000),
      }),
    );

    listen();
    const detail = (await request("/api/projects/demo")).json<{
      planMetrics: Array<{
        planId: string;
        title: string;
        iterations: number;
        totalTokens: number;
        durationMs: number;
        status: string;
        landed: boolean;
        usage: TokenUsage | null;
      }>;
      history: unknown[];
      budget: { iterations: number; totalTokens: number };
    }>();

    expect(detail.planMetrics).toEqual([
      {
        planId: "2026-07-02-ship",
        title: "Ship the feature",
        iterations: 2,
        totalTokens: 265,
        durationMs: 6_000,
        status: "landed",
        landed: true,
        usage: usage(240, 20, 5),
      },
      {
        planId: "2026-07-02-polish",
        title: "Polish the feature",
        iterations: 1,
        totalTokens: 10,
        durationMs: 90_000,
        status: "pending",
        landed: false,
        usage: usage(10),
      },
    ]);
    expect(detail.history.length).toBe(4);
    expect(detail.budget).toMatchObject({ iterations: 4, totalTokens: 1_275 });
  });

  it("serves pending proposal items on project detail for page rendering", async () => {
    project = await makeTempProject();
    const first = candidate("Console approval", "minimal");
    const second = candidate("Console archive", "risk");
    const { proposal } = writeProposalArtifact(project.ctx().paths, {
      goal: "Review proposals in the console",
      routingTier: "light",
      passes: [],
      now: new Date("2026-07-03T12:00:00.000Z"),
      items: [
        { ...first, lens: "minimal_path" },
        { ...second, lens: "risk_first" },
      ],
    });

    listen(false);
    const page = (await request("/")).text;
    expect(page).toContain("function renderProposals");
    expect(page).toContain("function renderPlanMetrics");
    expect(page).toContain("renderPlanMetrics(d)");
    expect(page).toContain("plan accounting");
    expect(page).toContain("duration");
    expect(page).toContain("pending proposals");
    expect(page).toContain("token curve");
    expect(page).toContain("iterations");
    expect(page).toContain('inputAttrs.disabled = "disabled"');

    const detail = (await request("/api/projects/demo")).json<{
      proposals: Array<{
        id: string;
        goal: string;
        items: Array<{ id: string; title: string; body: string; lens: string }>;
      }>;
    }>();
    expect(detail.proposals).toHaveLength(1);
    expect(detail.proposals[0]).toMatchObject({
      id: proposal.id,
      goal: "Review proposals in the console",
      items: [
        { id: "1", title: first.title, body: first.body, lens: "minimal_path" },
        { id: "2", title: second.title, body: second.body, lens: "risk_first" },
      ],
    });
  });

  it("rejects actions unless enabled, honors them when enabled", async () => {
    project = await makeTempProject();
    listen(false);
    const denied = await request("/api/projects/demo/pause", { method: "POST" });
    expect(denied.status).toBe(404);

    listen(true);
    const paused = await request("/api/projects/demo/pause", {
      method: "POST",
      body: { reason: "coffee break" },
    });
    expect(paused.status).toBe(200);
    const { readState } = await import("../src/state/state");
    expect(readState(project.ctx().paths).paused).toBe(true);
    expect(readState(project.ctx().paths).pausedReason).toBe("coffee break");

    const resumed = await request("/api/projects/demo/resume", { method: "POST" });
    expect(resumed.status).toBe(200);
    expect(readState(project.ctx().paths).paused).toBe(false);

    const gc = await request("/api/projects/demo/gc", { method: "POST" });
    expect(gc.status).toBe(200);
    const gcBody = gc.json<{ ok: boolean; removedWorktrees: string[] }>();
    expect(gcBody.ok).toBe(true);

    // Action buttons only render when actions are enabled.
    const page = (await request("/")).text;
    expect(page).toContain("var ACTIONS = true");
  });

  it("approves selected proposal items with actions enabled through the shared append/archive path", async () => {
    project = await makeTempProject();
    project.setCrew(["Keep existing backlog item"]);
    const first = candidate("Selected first", "first");
    const second = candidate("Skipped second", "second");
    const third = candidate("Selected third", "third");
    const { file, proposal } = writeProposalArtifact(project.ctx().paths, {
      goal: "Approve from console",
      routingTier: "light",
      passes: [],
      now: new Date("2026-07-03T13:00:00.000Z"),
      items: [
        { ...first, lens: "minimal_path" },
        { ...second, lens: "architecture_first" },
        { ...third, lens: "risk_first" },
      ],
    });
    const beforeCrew = readFileSync(project.ctx().paths.crewFile, "utf8");

    listen(true);
    const approved = await request("/api/projects/demo/proposals/approve", {
      method: "POST",
      body: { proposalId: proposal.id, ids: ["1", "3"] },
    });

    expect(approved.status).toBe(200);
    expect(approved.json()).toMatchObject({
      ok: true,
      proposalId: proposal.id,
      selectedItemIds: ["1", "3"],
      archivedFile: `.nightcrew/proposals/archive/${proposal.id}.json`,
    });
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(
      appendItemsToBacklog(beforeCrew, [first.body, third.body]),
    );
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).not.toContain(second.body);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(project.ctx().paths.archivedProposalsDir, `${proposal.id}.json`))).toBe(
      true,
    );

    const detail = (await request("/api/projects/demo")).json<{
      proposals: unknown[];
    }>();
    expect(detail.proposals).toEqual([]);
  });

  it("returns 404 for proposal approval when console actions are disabled", async () => {
    project = await makeTempProject();
    project.setCrew(["Keep existing backlog item"]);
    const first = candidate("Read only proposal", "readonly");
    const { file, proposal } = writeProposalArtifact(project.ctx().paths, {
      goal: "Do not approve without actions",
      routingTier: "light",
      passes: [],
      now: new Date("2026-07-03T14:00:00.000Z"),
      items: [{ ...first, lens: "minimal_path" }],
    });
    const beforeCrew = readFileSync(project.ctx().paths.crewFile, "utf8");

    listen(false);
    const denied = await request("/api/projects/demo/proposals/approve", {
      method: "POST",
      body: { proposalId: proposal.id, ids: ["1"] },
    });

    expect(denied.status).toBe(404);
    expect(readFileSync(project.ctx().paths.crewFile, "utf8")).toBe(beforeCrew);
    expect(existsSync(file)).toBe(true);
  });
});
