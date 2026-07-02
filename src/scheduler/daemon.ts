import { loadProject } from "../config/load";
import { readRegistry } from "../config/registry";
import type { IterationRecord } from "../core/types";
import { buildProvider } from "../providers/factory";
import { buildReviewer } from "../review/factory";
import { log } from "../utils/log";
import { runProjectScheduler } from "./scheduler";

export interface DaemonOptions {
  /** Project names to drive; defaults to every registered project. */
  projects?: string[];
  signal?: AbortSignal;
  pollMs?: number;
  ignoreWindows?: boolean;
  onRecord?: (record: IterationRecord) => void;
}

export interface DaemonResult {
  projects: Array<{ name: string; root: string; iterations: number; error?: string }>;
}

/** The crew daemon: N projects in parallel, one scheduler each. */
export async function runCrewDaemon(options: DaemonOptions = {}): Promise<DaemonResult> {
  const registry = readRegistry();
  const targets = registry.projects.filter(
    (project) => !options.projects || options.projects.includes(project.name),
  );

  if (targets.length === 0) {
    log.warn(
      options.projects
        ? `no registered projects match: ${options.projects.join(", ")}`
        : "no projects registered; run `nightcrew init` in a repo first",
    );
    return { projects: [] };
  }

  log.info(
    `crew daemon driving ${targets.length} project(s): ${targets.map((t) => t.name).join(", ")}`,
  );

  const results = await Promise.all(
    targets.map(async (target) => {
      try {
        const ctx = loadProject(target.root);
        const provider = buildProvider(ctx.config, ctx.root);
        const reviewer = buildReviewer(ctx.config, provider, ctx.root);
        const result = await runProjectScheduler(
          ctx,
          { provider, reviewer },
          {
            signal: options.signal,
            pollMs: options.pollMs,
            ignoreWindows: options.ignoreWindows,
            onRecord: options.onRecord,
          },
        );
        return { name: target.name, root: target.root, iterations: result.iterations };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`${target.name}: ${message}`);
        return { name: target.name, root: target.root, iterations: 0, error: message };
      }
    }),
  );

  return { projects: results };
}
