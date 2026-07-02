import { join } from "node:path";

export const NIGHTCREW_DIR = ".nightcrew";

export interface ProjectPaths {
  root: string;
  dir: string;
  configFile: string;
  crewFile: string;
  questionsFile: string;
  qaFile: string;
  plansDir: string;
  activePlansDir: string;
  completedPlansDir: string;
  pausedPlansDir: string;
  runtimeDir: string;
  stateFile: string;
  historyFile: string;
  eventsFile: string;
  logsDir: string;
  lockFile: string;
  worktreesDir: string;
}

export function projectPaths(root: string): ProjectPaths {
  const dir = join(root, NIGHTCREW_DIR);
  const plansDir = join(dir, "plans");
  const runtimeDir = join(dir, "runtime");
  return {
    root,
    dir,
    configFile: join(dir, "config.yaml"),
    crewFile: join(dir, "crew.md"),
    questionsFile: join(dir, "questions.md"),
    qaFile: join(dir, "qa.md"),
    plansDir,
    activePlansDir: join(plansDir, "active"),
    completedPlansDir: join(plansDir, "completed"),
    pausedPlansDir: join(plansDir, "paused"),
    runtimeDir,
    stateFile: join(runtimeDir, "state.json"),
    historyFile: join(runtimeDir, "history.jsonl"),
    eventsFile: join(runtimeDir, "events.jsonl"),
    logsDir: join(runtimeDir, "logs"),
    lockFile: join(runtimeDir, "daemon.lock"),
    worktreesDir: join(dir, "worktrees"),
  };
}

/** Repo-relative control-surface prefix, used for write-scope decisions. */
export function isControlPath(relPath: string): boolean {
  return relPath === NIGHTCREW_DIR || relPath.startsWith(`${NIGHTCREW_DIR}/`);
}
