import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { relative } from "node:path";
import { loadProject } from "../config/load";
import { projectPaths } from "../core/paths";
import { notifyWebhook } from "../notify/webhook";
import {
  appendItemsToBacklog,
  parseProposalIds,
  selectProposalItems,
} from "../proposals/proposals";
import { addQuestionFeedback, answerQuestion } from "../questions/questions";
import { log } from "../utils/log";
import { detail, registeredProjects, summarize } from "./data";
import { consoleHtml } from "./page";
import { JsonlTailer } from "./tail";

export interface ConsoleOptions {
  port: number;
  host?: string;
  /** Enable POST actions (pause/resume/gc). Console v1 (Phase 3). */
  actions?: boolean;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function findRoot(name: string): string | null {
  const project = registeredProjects().find((candidate) => candidate.name === name);
  return project?.root ?? null;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody<T>(body: string): T {
  return (body ? JSON.parse(body) : {}) as T;
}

function startSse(res: ServerResponse, file: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");

  const tailer = new JsonlTailer(file, (line) => {
    res.write(`data: ${line}\n\n`);
  });
  tailer.start(true);

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);
  heartbeat.unref();

  res.on("close", () => {
    clearInterval(heartbeat);
    tailer.stop();
  });
}

export function createConsoleHandler(
  options: Pick<ConsoleOptions, "actions"> = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(consoleHtml(options.actions ?? false));
        return;
      }

      if (req.method === "GET" && path === "/api/projects") {
        sendJson(res, 200, registeredProjects().map(summarize));
        return;
      }

      const projectMatch = path.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
      if (projectMatch) {
        const name = decodeURIComponent(projectMatch[1] ?? "");
        const rest = projectMatch[2] ?? "";
        const root = findRoot(name);
        if (!root) {
          sendJson(res, 404, { error: `project "${name}" not registered` });
          return;
        }

        if (req.method === "GET" && rest === "") {
          sendJson(res, 200, detail(root));
          return;
        }
        if (req.method === "GET" && rest === "/events") {
          startSse(res, projectPaths(root).eventsFile);
          return;
        }
        if (req.method === "POST" && options.actions) {
          const handled = await handleAction(root, rest, req, res);
          if (handled) return;
        }
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function createConsoleServer(options: ConsoleOptions): Server {
  const server = createServer(createConsoleHandler(options));

  server.listen(options.port, options.host ?? "127.0.0.1", () => {
    log.info(`console listening on http://${options.host ?? "127.0.0.1"}:${options.port}`);
  });
  return server;
}

/** POST actions (console v1). Wired in Phase 3; kept here so routes stay together. */
async function handleAction(
  root: string,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const { updateState } = await import("../state/state");
  const paths = projectPaths(root);

  if (rest === "/pause") {
    const body = await readBody(req);
    const reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
    updateState(paths, (state) => {
      state.paused = true;
      state.pausedReason = reason ?? "paused from console";
    });
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (rest === "/resume") {
    updateState(paths, (state) => {
      state.paused = false;
      state.pausedReason = undefined;
      state.stop = undefined;
    });
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (rest === "/gc") {
    const { gcProject } = await import("../cli/gc");
    const result = await gcProject(root);
    sendJson(res, 200, { ok: true, ...result });
    return true;
  }
  if (rest === "/proposals/approve") {
    const body = parseJsonBody<{ proposalId?: unknown; ids?: unknown }>(await readBody(req));
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
      sendJson(res, 400, { error: "ids must be a non-empty string array" });
      return true;
    }
    let ids: string[];
    try {
      ids = parseProposalIds(body.ids.join(","));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    const proposalIdOrFile =
      typeof body.proposalId === "string" && body.proposalId.trim() ? body.proposalId : undefined;
    const result = selectProposalItems(paths, { ids, proposalIdOrFile });
    try {
      await notifyWebhook(loadProject(root), {
        event: "proposal_landed",
        proposalId: result.proposal.id,
        selectedItems: result.selectedItems.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`notify webhook proposal_landed failed: ${message}`);
    }
    sendJson(res, 200, {
      ok: true,
      proposalId: result.proposal.id,
      selectedItemIds: result.selectedItems.map((item) => item.id),
      archivedFile: relative(root, result.archivedFile).replaceAll("\\", "/"),
    });
    return true;
  }
  if (rest === "/questions/answer" || rest === "/questions/feedback") {
    const body = parseJsonBody<{ key?: unknown; answer?: unknown; feedback?: unknown }>(
      await readBody(req),
    );
    const value = rest === "/questions/answer" ? body.answer : body.feedback;
    const field = rest === "/questions/answer" ? "answer" : "feedback";
    if (typeof body.key !== "string" || !body.key.trim()) {
      sendJson(res, 400, { error: "key must be a non-empty string" });
      return true;
    }
    if (typeof value !== "string" || !value.trim()) {
      sendJson(res, 400, { error: `${field} must be a non-empty string` });
      return true;
    }

    if (!existsSync(paths.questionsFile)) {
      sendJson(res, 404, { error: "questions.md not found" });
      return true;
    }
    const markdown = readFileSync(paths.questionsFile, "utf8");
    try {
      if (rest === "/questions/answer") {
        const result = answerQuestion(markdown, { key: body.key, answer: value });
        writeFileSync(paths.questionsFile, result.markdown, "utf8");
        if (result.scheduledBacklogItem) {
          const crew = readFileSync(paths.crewFile, "utf8");
          writeFileSync(
            paths.crewFile,
            appendItemsToBacklog(crew, [result.scheduledBacklogItem]),
            "utf8",
          );
        }
        sendJson(res, 200, { ok: true, scheduled: result.scheduledBacklogItem !== null });
      } else {
        const result = addQuestionFeedback(markdown, { key: body.key, feedback: value });
        writeFileSync(paths.questionsFile, result.markdown, "utf8");
        sendJson(res, 200, { ok: true });
      }
    } catch (error) {
      // Stale key or already-answered entry: the page needs a reload, not a 500.
      sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }
  return false;
}
