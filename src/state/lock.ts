import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProjectPaths } from "../core/paths";
import { ensureDir } from "../utils/fs";

interface LockInfo {
  pid: number;
  startedAt: string;
  role: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Lock files held by THIS process (a pid check cannot see in-process holders). */
const heldHere = new Set<string>();

/**
 * Cross-process project lock (runtime/daemon.lock). Guards against two loops
 * driving the same project — across processes via pidfile, within a process
 * via an in-memory registry. Stale locks (dead pid) are reclaimed silently.
 */
export function acquireProjectLock(paths: ProjectPaths, role: string): (() => void) | null {
  if (heldHere.has(paths.lockFile)) return null;
  ensureDir(dirname(paths.lockFile));
  if (existsSync(paths.lockFile)) {
    try {
      const info = JSON.parse(readFileSync(paths.lockFile, "utf8")) as LockInfo;
      if (info.pid !== process.pid && isAlive(info.pid)) return null;
    } catch {
      // unreadable lock: treat as stale
    }
  }
  const info: LockInfo = { pid: process.pid, startedAt: new Date().toISOString(), role };
  writeFileSync(paths.lockFile, JSON.stringify(info));
  heldHere.add(paths.lockFile);
  return () => {
    heldHere.delete(paths.lockFile);
    try {
      const current = JSON.parse(readFileSync(paths.lockFile, "utf8")) as LockInfo;
      if (current.pid === process.pid) rmSync(paths.lockFile, { force: true });
    } catch {
      // already gone
    }
  };
}

export function lockHolder(paths: ProjectPaths): LockInfo | null {
  if (!existsSync(paths.lockFile)) return null;
  try {
    const info = JSON.parse(readFileSync(paths.lockFile, "utf8")) as LockInfo;
    return isAlive(info.pid) ? info : null;
  } catch {
    return null;
  }
}
