import { execFile } from "node:child_process";

export interface GitResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export async function git(args: string[], cwd: string): Promise<GitResult> {
  return await new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024, env: process.env },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? ((error as unknown as { code: number }).code ?? 1)
            : error
              ? 1
              : 0;
        resolve({ ok: !error, code, stdout: stdout.toString(), stderr: stderr.toString() });
      },
    );
  });
}

export async function gitOrThrow(args: string[], cwd: string): Promise<string> {
  const result = await git(args, cwd);
  if (!result.ok) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await git(["rev-parse", "--git-dir"], cwd)).ok;
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await gitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
}

export async function headSha(cwd: string): Promise<string> {
  return (await gitOrThrow(["rev-parse", "HEAD"], cwd)).trim();
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd)).ok;
}

export interface StatusEntry {
  /** Two-char porcelain code, e.g. " M", "??", "A ". */
  code: string;
  path: string;
}

export async function statusEntries(cwd: string): Promise<StatusEntry[]> {
  const out = await gitOrThrow(["status", "--porcelain"], cwd);
  const entries: StatusEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    let path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    entries.push({ code, path });
  }
  return entries;
}

export async function isDirty(cwd: string): Promise<boolean> {
  return (await statusEntries(cwd)).length > 0;
}

/** Shas in `${from}..HEAD`, oldest first. */
export async function commitsSince(cwd: string, from: string): Promise<string[]> {
  const result = await git(["rev-list", "--reverse", `${from}..HEAD`], cwd);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function changedPathsBetween(
  cwd: string,
  from: string,
  to: string,
): Promise<string[]> {
  const result = await git(["diff", "--name-only", `${from}..${to}`], cwd);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function diffBetween(
  cwd: string,
  from: string,
  to: string,
  maxChars = 60_000,
): Promise<string> {
  const result = await git(["diff", "--stat", "--patch", `${from}..${to}`], cwd);
  const text = result.stdout;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [diff truncated at ${maxChars} chars]`;
}

export const FALLBACK_IDENTITY = [
  "-c",
  "user.name=nightcrew",
  "-c",
  "user.email=agent@nightcrew.local",
];

/** True when git refused to commit because no author identity is configured. */
export function missingIdentity(result: GitResult): boolean {
  return /tell me who you are|user\.name|user\.email/i.test(result.stderr);
}

/** Stage everything and commit. Returns the new sha, or null when nothing to commit. */
export async function addAllAndCommit(cwd: string, message: string): Promise<string | null> {
  await gitOrThrow(["add", "-A"], cwd);
  const staged = await git(["diff", "--cached", "--quiet"], cwd);
  if (staged.ok) return null; // nothing staged
  let commit = await git(["commit", "-m", message], cwd);
  if (!commit.ok && missingIdentity(commit)) {
    commit = await git([...FALLBACK_IDENTITY, "commit", "-m", message], cwd);
  }
  if (!commit.ok) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }
  return await headSha(cwd);
}

/** Stage and commit specific paths only. Returns the new sha, or null when clean. */
export async function commitPaths(
  cwd: string,
  paths: string[],
  message: string,
): Promise<string | null> {
  if (paths.length === 0) return null;
  await gitOrThrow(["add", "--", ...paths], cwd);
  const staged = await git(["diff", "--cached", "--quiet"], cwd);
  if (staged.ok) return null;
  let commit = await git(["commit", "-m", message, "--", ...paths], cwd);
  if (!commit.ok && missingIdentity(commit)) {
    commit = await git([...FALLBACK_IDENTITY, "commit", "-m", message, "--", ...paths], cwd);
  }
  if (!commit.ok) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }
  return await headSha(cwd);
}

/** Restore specific paths to HEAD state, deleting untracked ones. */
export async function revertPaths(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  // Tracked files: restore content and index. Untracked: clean.
  await git(["checkout", "HEAD", "--", ...paths], cwd);
  await git(["clean", "-fd", "--", ...paths], cwd);
}
