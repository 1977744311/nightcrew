import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { initProject } from "../src/cli/init";
import { loadProject, type ProjectContext } from "../src/config/load";
import type { IterationRecord, Operation } from "../src/core/types";
import { type LoopOptions, type LoopResult, runLoop } from "../src/loop/loop";
import { runIteration } from "../src/loop/runner";
import { buildProvider } from "../src/providers/factory";
import type { FakeScriptEntry } from "../src/providers/fake";
import { buildReviewer } from "../src/review/factory";
import type { Reviewer } from "../src/review/types";
import { ensureDir } from "../src/utils/fs";

export function sh(cwd: string, command: string, args: string[]): string {
  return execFileSync(command, args, { cwd, encoding: "utf8" });
}

export function gitSync(cwd: string, ...args: string[]): string {
  return sh(cwd, "git", ["-c", "user.name=test", "-c", "user.email=test@nightcrew.local", ...args]);
}

export interface TestProject {
  root: string;
  home: string;
  scriptFile: string;
  cleanup: () => void;
  setScript: (entries: FakeScriptEntry[]) => void;
  setConfig: (overrides: Record<string, unknown>) => void;
  setCrew: (backlog: string[]) => void;
  run: (options?: {
    operation?: Operation;
    planId?: string;
    reviewer?: Reviewer;
  }) => Promise<IterationRecord>;
  loop: (options?: LoopOptions) => Promise<LoopResult>;
  ctx: () => ProjectContext;
}

export async function makeTempProject(
  configOverrides: Record<string, unknown> = {},
): Promise<TestProject> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "nightcrew-e2e-")));
  const root = join(base, "repo");
  const home = join(base, "home");
  ensureDir(root);
  ensureDir(home);
  process.env.NIGHTCREW_HOME = home;

  gitSync(root, "init", "-b", "main");
  writeFileSync(join(root, "README.md"), "# demo product\n");
  gitSync(root, "add", "-A");
  gitSync(root, "commit", "-m", "initial product commit");

  await initProject(root, { name: "demo" });

  const scriptFile = join(base, "fake-script.json");
  writeFileSync(scriptFile, "[]");

  const setConfig = (overrides: Record<string, unknown>): void => {
    const config = {
      version: 1,
      project: { name: "demo", baseBranch: "main" },
      provider: { default: "fake", fake: { script: scriptFile } },
      review: { mode: "off" },
      ...overrides,
    };
    writeFileSync(join(root, ".nightcrew", "config.yaml"), stringify(config));
  };
  setConfig(configOverrides);

  // Control surfaces are part of the repo timeline, like a real adoption.
  gitSync(root, "add", "-A");
  gitSync(root, "commit", "-m", "adopt nightcrew");

  const project: TestProject = {
    root,
    home,
    scriptFile,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
    setScript: (entries) => {
      writeFileSync(scriptFile, JSON.stringify(entries, null, 2));
      rmSync(`${scriptFile}.cursor.json`, { force: true });
    },
    setConfig: (overrides) => setConfig({ ...configOverrides, ...overrides }),
    setCrew: (backlog) => {
      const items = backlog.map((item) => `- [ ] ${item}`).join("\n");
      writeFileSync(
        join(root, ".nightcrew", "crew.md"),
        `# Crew Directives\n\n## Rules\n\n- keep it honest\n\n## BACKLOG\n\n${items}\n`,
      );
      gitSync(root, "add", ".nightcrew/crew.md");
      gitSync(root, "commit", "-m", "update backlog");
    },
    run: async (options = {}) => {
      const ctx = loadProject(root);
      const provider = buildProvider(ctx.config, ctx.root);
      const reviewer = options.reviewer ?? buildReviewer(ctx.config, provider, ctx.root);
      return await runIteration(ctx, { provider, reviewer }, options);
    },
    loop: async (options = {}) => {
      const ctx = loadProject(root);
      const provider = buildProvider(ctx.config, ctx.root);
      const reviewer = buildReviewer(ctx.config, provider, ctx.root);
      return await runLoop(ctx, { provider, reviewer }, { pollMs: 50, ...options });
    },
    ctx: () => loadProject(root),
  };
  return project;
}

/** A plan file body the fake provider can drop into plans/active/. */
export function planFileContents(
  id: string,
  title: string,
  options: { parallel?: boolean; backlog?: string } = {},
): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    `created: ${id.slice(0, 10)}`,
    `parallel: ${options.parallel ?? false}`,
    ...(options.backlog ? [`backlog: ${JSON.stringify(options.backlog)}`] : []),
    "---",
    "",
    "## Goal",
    `Deliver ${title}.`,
    "",
    "## Acceptance",
    "- [ ] feature file exists",
    "",
    "## Steps",
    "1. Write the feature file.",
    "",
  ].join("\n");
}
