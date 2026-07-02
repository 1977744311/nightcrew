import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { projectPaths } from "../core/paths";
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

export function createConsoleServer(options: ConsoleOptions): Server {
  const server = createServer(async (req, res) => {
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
  });

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
  return false;
}
