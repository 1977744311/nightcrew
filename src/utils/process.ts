import { spawn } from "node:child_process";

export interface ShellResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

const OUTPUT_CAP = 200_000;

/**
 * Run a shell command in its own process group so timeouts can kill the whole
 * tree (dev servers, watchers) instead of leaving orphans behind.
 */
export async function runShell(
  command: string,
  options: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<ShellResult> {
  const startedAt = Date.now();
  return await new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;
    let settled = false;

    const append = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > OUTPUT_CAP) output = output.slice(-OUTPUT_CAP);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, output, timedOut, durationMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, options.timeoutMs);

    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

/** SIGTERM the process group, then SIGKILL shortly after as a sweep. */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // process group already gone
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already exited
    }
  }, 2_000).unref();
}

export function tail(text: string, chars = 4_000): string {
  return text.length > chars ? text.slice(-chars) : text;
}
