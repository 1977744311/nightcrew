import { currentBranch, FALLBACK_IDENTITY, git, missingIdentity, statusEntries } from "./git";

export type MergeOutcome =
  | { result: "merged"; sha: string }
  | { result: "conflict"; detail: string }
  | { result: "blocked"; detail: string }
  | { result: "nothing" };

/**
 * Land a plan branch onto the base branch in the main checkout. Conservative
 * by design: it refuses (rather than stashes) when the operator's checkout is
 * not in a mergeable state — the branch survives either way.
 */
export async function mergeBranch(
  root: string,
  baseBranch: string,
  branch: string,
  message: string,
): Promise<MergeOutcome> {
  const checkedOut = await currentBranch(root);
  if (checkedOut !== baseBranch) {
    return {
      result: "blocked",
      detail: `main checkout is on "${checkedOut}", expected base "${baseBranch}"`,
    };
  }

  const dirtyTracked = (await statusEntries(root)).filter((entry) => entry.code !== "??");
  if (dirtyTracked.length > 0) {
    return {
      result: "blocked",
      detail: `main checkout has uncommitted tracked changes (${dirtyTracked.length} paths)`,
    };
  }

  const ahead = await git(["rev-list", "--count", `${baseBranch}..${branch}`], root);
  if (ahead.ok && ahead.stdout.trim() === "0") {
    return { result: "nothing" };
  }

  let merge = await git(["merge", "--no-ff", branch, "-m", message], root);
  if (!merge.ok && missingIdentity(merge)) {
    // The merge commit needs an author (CI runners often have none configured).
    await git(["merge", "--abort"], root);
    merge = await git([...FALLBACK_IDENTITY, "merge", "--no-ff", branch, "-m", message], root);
  }
  if (!merge.ok) {
    await git(["merge", "--abort"], root);
    return { result: "conflict", detail: merge.stderr || merge.stdout };
  }
  const sha = (await git(["rev-parse", "HEAD"], root)).stdout.trim();
  return { result: "merged", sha };
}

/**
 * Bring the base branch into the plan worktree (used by repair after a
 * merge_conflict failure, so the agent can resolve conflicts in isolation).
 */
export async function mergeBaseIntoWorktree(
  worktreePath: string,
  baseBranch: string,
): Promise<{ ok: boolean; conflicted: boolean; detail: string }> {
  const message = `nightcrew: merge ${baseBranch} into plan branch`;
  let merge = await git(["merge", baseBranch, "-m", message], worktreePath);
  if (!merge.ok && missingIdentity(merge)) {
    await git(["merge", "--abort"], worktreePath);
    merge = await git([...FALLBACK_IDENTITY, "merge", baseBranch, "-m", message], worktreePath);
  }
  if (merge.ok) return { ok: true, conflicted: false, detail: merge.stdout };
  const conflicted = /conflict/i.test(merge.stdout + merge.stderr);
  if (!conflicted) await git(["merge", "--abort"], worktreePath);
  return { ok: false, conflicted, detail: merge.stderr || merge.stdout };
}
