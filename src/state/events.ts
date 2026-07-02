import type { ProjectPaths } from "../core/paths";
import { appendLine } from "../utils/fs";
import { isoNow } from "../utils/id";

/**
 * Cross-process event feed (runtime/events.jsonl). The loop appends; the
 * console tails. Files instead of sockets so a standalone console can watch
 * a daemon it did not spawn.
 */
export interface CrewEvent {
  at: string;
  project: string;
  kind: string;
  data?: Record<string, unknown>;
}

export function emitEvent(
  paths: ProjectPaths,
  project: string,
  kind: string,
  data?: Record<string, unknown>,
): CrewEvent {
  const event: CrewEvent = { at: isoNow(), project, kind, data };
  appendLine(paths.eventsFile, JSON.stringify(event));
  return event;
}
