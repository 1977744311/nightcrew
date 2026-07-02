import type { ProjectPaths } from "../core/paths";
import { defaultRuntimeState, type RuntimeState } from "../core/types";
import { readTextIfExists, writeTextAtomic } from "../utils/fs";
import { isoNow } from "../utils/id";

export function readState(paths: ProjectPaths): RuntimeState {
  const raw = readTextIfExists(paths.stateFile);
  if (raw === null) return defaultRuntimeState();
  try {
    const parsed = JSON.parse(raw) as RuntimeState;
    if (parsed.version !== 1) return defaultRuntimeState();
    return parsed;
  } catch {
    // Corrupt runtime state is disposable by contract: start fresh.
    return defaultRuntimeState();
  }
}

export function writeState(paths: ProjectPaths, state: RuntimeState): RuntimeState {
  const next = { ...state, updatedAt: isoNow() };
  writeTextAtomic(paths.stateFile, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function updateState(
  paths: ProjectPaths,
  mutate: (state: RuntimeState) => void,
): RuntimeState {
  const state = readState(paths);
  mutate(state);
  return writeState(paths, state);
}
