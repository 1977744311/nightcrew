import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadProject } from "../config/load";
import { git } from "../git/git";
import { listWorktrees, removeWorktree } from "../git/worktree";
import { listPlans } from "../plans/plans";
import { readState, updateState } from "../state/state";

export interface GcResult {
  removedWorktrees: string[];
  prunedLogs: number;
  clearedSessions: string[];
}

/**
 * Housekeeping: drop worktrees whose plans are no longer active, prune stale
 * session ids, trim old iteration logs. Never touches product code.
 */
export async function gcProject(root: string): Promise<GcResult> {
  const ctx = loadProject(root);
  const { paths } = ctx;
  const activeIds = new Set(listPlans(paths, "active").map((plan) => plan.id));
  const result: GcResult = { removedWorktrees: [], prunedLogs: 0, clearedSessions: [] };

  if (existsSync(paths.worktreesDir)) {
    for (const entry of readdirSync(paths.worktreesDir)) {
      if (activeIds.has(entry)) continue;
      const full = join(paths.worktreesDir, entry);
      if (!statSync(full).isDirectory()) continue;
      await removeWorktree(paths, entry, { deleteBranch: "keep" });
      if (existsSync(full)) rmSync(full, { recursive: true, force: true });
      result.removedWorktrees.push(entry);
    }
  }
  await git(["worktree", "prune"], root);

  // Branches whose worktrees are gone stay (they may hold unmerged work) —
  // the operator deletes them explicitly; gc only reports disk-level leftovers.

  const state = readState(paths);
  const staleSessions = Object.keys(state.sessions).filter((planId) => !activeIds.has(planId));
  if (staleSessions.length > 0) {
    updateState(paths, (s) => {
      for (const planId of staleSessions) delete s.sessions[planId];
    });
    result.clearedSessions = staleSessions;
  }

  if (existsSync(paths.logsDir)) {
    const logs = readdirSync(paths.logsDir)
      .map((name) => ({ name, mtime: statSync(join(paths.logsDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const log of logs.slice(200)) {
      rmSync(join(paths.logsDir, log.name), { force: true });
      result.prunedLogs += 1;
    }
  }

  const orphaned = (await listWorktrees(root)).filter(
    (wt) =>
      wt.branch?.startsWith("nightcrew/") && !activeIds.has(wt.branch.slice("nightcrew/".length)),
  );
  for (const wt of orphaned) {
    const planId = wt.branch?.slice("nightcrew/".length);
    if (planId) {
      await removeWorktree(paths, planId, { deleteBranch: "keep" });
      result.removedWorktrees.push(planId);
    }
  }

  return result;
}
