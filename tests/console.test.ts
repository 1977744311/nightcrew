import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConsoleHandler } from "../src/console/server";
import { appendItemsToBacklog, writeProposalArtifact } from "../src/proposals/proposals";
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
    expect(page).toContain("pending proposals");
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
