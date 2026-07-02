import { isControlPath } from "../core/paths";
import { revertPaths, statusEntries } from "./git";

export interface ScopeViolation {
  path: string;
  reason: "protected" | "outside_control_scope";
}

function matchesProtected(path: string, protectedPaths: string[]): boolean {
  if (path === ".git" || path.startsWith(".git/")) return true;
  return protectedPaths.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Snapshot of dirty paths before a provider run, so the guard only judges
 * paths the agent itself touched (operator dirt is not the agent's fault).
 */
export async function snapshotDirtyPaths(cwd: string): Promise<Set<string>> {
  return new Set((await statusEntries(cwd)).map((entry) => entry.path));
}

export interface ScopeCheckResult {
  violations: ScopeViolation[];
  reverted: string[];
}

/**
 * Enforce the write scope after a provider run, before anything is committed.
 *
 * - `code` scope (execute/repair in a worktree): anything goes except
 *   protected paths.
 * - `control` scope (plan/garden on the main checkout): only `.nightcrew/`
 *   paths may change, and protected paths still may not.
 *
 * Violations are reverted immediately; the caller decides whether the
 * iteration fails (it should) — but the working tree is always left clean of
 * out-of-scope edits so nothing leaks into commits.
 */
export async function enforceWriteScope(options: {
  cwd: string;
  scope: "code" | "control";
  protectedPaths: string[];
  before: Set<string>;
}): Promise<ScopeCheckResult> {
  const after = await statusEntries(options.cwd);
  const touched = after.map((entry) => entry.path).filter((path) => !options.before.has(path));

  const violations: ScopeViolation[] = [];
  for (const path of touched) {
    if (matchesProtected(path, options.protectedPaths)) {
      violations.push({ path, reason: "protected" });
    } else if (options.scope === "control" && !isControlPath(path)) {
      violations.push({ path, reason: "outside_control_scope" });
    }
  }

  const revertList = violations.map((violation) => violation.path);
  await revertPaths(options.cwd, revertList);
  return { violations, reverted: revertList };
}
