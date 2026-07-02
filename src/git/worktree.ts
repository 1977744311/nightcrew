import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectPaths } from "../core/paths";
import { ensureDir } from "../utils/fs";
import { branchExists, git, gitOrThrow, isGitRepo } from "./git";

export const BRANCH_PREFIX = "nightcrew/";

export function planBranch(planId: string): string {
  return `${BRANCH_PREFIX}${planId}`;
}

export function worktreePathFor(paths: ProjectPaths, planId: string): string {
  return join(paths.worktreesDir, planId);
}

export interface Worktree {
  path: string;
  branch: string;
  created: boolean;
}

/**
 * Ensure the plan worktree exists. Reuses a live worktree (crash/resume) or
 * re-attaches to an existing plan branch, so iteration N+1 continues exactly
 * where N stopped.
 */
export async function ensureWorktree(
  paths: ProjectPaths,
  planId: string,
  baseBranch: string,
): Promise<Worktree> {
  const branch = planBranch(planId);
  const path = worktreePathFor(paths, planId);

  if (existsSync(path) && (await isGitRepo(path))) {
    return { path, branch, created: false };
  }

  ensureDir(paths.worktreesDir);
  await git(["worktree", "prune"], paths.root);

  if (await branchExists(paths.root, branch)) {
    await gitOrThrow(["worktree", "add", path, branch], paths.root);
    return { path, branch, created: false };
  }

  await gitOrThrow(["worktree", "add", "-b", branch, path, baseBranch], paths.root);
  return { path, branch, created: true };
}

/** Remove the worktree; optionally delete its branch (after merge or discard). */
export async function removeWorktree(
  paths: ProjectPaths,
  planId: string,
  options: { deleteBranch: "merged" | "force" | "keep" },
): Promise<void> {
  const path = worktreePathFor(paths, planId);
  const branch = planBranch(planId);
  if (existsSync(path)) {
    await git(["worktree", "remove", "--force", path], paths.root);
  }
  await git(["worktree", "prune"], paths.root);
  if (options.deleteBranch === "merged") {
    await git(["branch", "-d", branch], paths.root);
  } else if (options.deleteBranch === "force") {
    await git(["branch", "-D", branch], paths.root);
  }
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
}

export async function listWorktrees(root: string): Promise<WorktreeInfo[]> {
  const result = await git(["worktree", "list", "--porcelain"], root);
  if (!result.ok) return [];
  const infos: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path)
        infos.push({
          path: current.path,
          branch: current.branch ?? null,
          head: current.head ?? null,
        });
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  if (current.path)
    infos.push({ path: current.path, branch: current.branch ?? null, head: current.head ?? null });
  return infos;
}
