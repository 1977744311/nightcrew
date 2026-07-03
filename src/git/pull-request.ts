import { execFile } from "node:child_process";
import { type GitResult, git } from "./git";

export type PullRequestOutcome =
  | { result: "created"; url: string }
  | { result: "push_failed"; detail: string }
  | { result: "create_failed"; detail: string };

export type CommandRunner = (args: string[], cwd: string) => Promise<GitResult>;

export async function gh(args: string[], cwd: string): Promise<GitResult> {
  return await new Promise((resolve) => {
    execFile(
      "gh",
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

function detail(result: GitResult): string {
  return (result.stderr || result.stdout || `exit ${result.code}`).replace(/\s+/g, " ").trim();
}

function extractUrl(text: string): string {
  const match = /https?:\/\/\S+/.exec(text);
  return match ? match[0] : text.trim();
}

export async function publishPullRequest(
  root: string,
  baseBranch: string,
  branch: string,
  title: string,
  body: string,
  options: { runGit?: CommandRunner; runGh?: CommandRunner } = {},
): Promise<PullRequestOutcome> {
  const runGit = options.runGit ?? git;
  const runGh = options.runGh ?? gh;

  const push = await runGit(["push", "-u", "origin", branch], root);
  if (!push.ok) return { result: "push_failed", detail: detail(push) };

  const created = await runGh(
    ["pr", "create", "--base", baseBranch, "--head", branch, "--title", title, "--body", body],
    root,
  );
  if (!created.ok) return { result: "create_failed", detail: detail(created) };

  return { result: "created", url: extractUrl(created.stdout || created.stderr) };
}
