import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { parse } from "yaml";
import { z } from "zod";
import { type Registry, readRegistry } from "../config/registry";
import { configSchema, type NightcrewConfig } from "../config/schema";
import { type ProjectPaths, projectPaths } from "../core/paths";
import { type GitResult, git } from "../git/git";
import { gh } from "../git/pull-request";
import {
  type ProviderPreflightOptions,
  type ProviderPreflightStatus,
  preflightProvider,
} from "../providers/preflight";

const MIN_NODE_MAJOR = 20;

export interface DoctorCheckResult {
  name: string;
  ok: boolean;
  status?: ProviderPreflightStatus;
  detail: string;
}

export interface DoctorReport {
  root: string;
  ok: boolean;
  checks: DoctorCheckResult[];
}

export interface DoctorCheckOptions {
  nodeVersion?: string;
  git?: (args: string[], cwd: string) => Promise<GitResult>;
  gh?: (args: string[], cwd: string) => Promise<GitResult>;
  registry?: Registry | (() => Registry);
  isProcessAlive?: (pid: number) => boolean;
  providerPreflight?: ProviderPreflightOptions;
}

function check(
  name: string,
  ok: boolean,
  detail: string,
  status?: ProviderPreflightStatus,
): DoctorCheckResult {
  return { name, ok, detail, status };
}

function pass(name: string, detail: string): DoctorCheckResult {
  return check(name, true, detail, "pass");
}

function fail(name: string, detail: string): DoctorCheckResult {
  return check(name, false, detail, "fail");
}

function skip(name: string, detail: string): DoctorCheckResult {
  return check(name, true, detail, "skip");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function oneLine(text: string, max = 240): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function gitDetail(result: GitResult): string {
  return oneLine(result.stderr || result.stdout || `exit ${result.code}`);
}

function nodeMajor(version: string): number | null {
  const match = /^v?(\d+)(?:\.|$)/.exec(version.trim());
  return match ? Number(match[1]) : null;
}

function nodeVersionText(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandRunFailures(
  name: "bootstrap command" | "verify command",
  path: string,
  value: unknown,
): DoctorCheckResult[] {
  if (!isRecord(value)) return [fail(name, `${path} must be an object`)];
  if (typeof value.run !== "string") return [fail(name, `${path}.run must be a string`)];
  if (value.run.trim().length === 0) return [fail(name, `${path}.run must not be empty`)];
  return [];
}

function bootstrapCommandChecks(input: unknown): DoctorCheckResult[] {
  if (!isRecord(input)) return [fail("bootstrap commands", "config must be an object")];
  const steps = input.bootstrap;
  if (!Array.isArray(steps)) {
    return [fail("bootstrap commands", "bootstrap must be a non-empty list")];
  }
  if (steps.length === 0) return [fail("bootstrap commands", "no bootstrap commands configured")];

  const failures = steps.flatMap((step, index) =>
    commandRunFailures("bootstrap command", `bootstrap[${index}]`, step),
  );
  return failures.length > 0
    ? failures
    : [pass("bootstrap commands", `${plural(steps.length, "command")} configured`)];
}

function profilePath(profileName: string): string {
  return `verify.profiles.${profileName}.steps`;
}

function verifyCommandChecks(input: unknown, config: NightcrewConfig | null): DoctorCheckResult[] {
  if (!isRecord(input)) return [fail("verify commands", "config must be an object")];

  const verify = input.verify === undefined ? config?.verify : input.verify;
  if (!isRecord(verify)) return [fail("verify commands", "verify must be an object")];

  const failures: DoctorCheckResult[] = [];
  const rawProfile = verify.profile;
  const selectedProfile =
    typeof rawProfile === "string" && rawProfile.trim().length > 0
      ? rawProfile
      : (config?.verify.profile ?? "default");
  if (rawProfile !== undefined && (typeof rawProfile !== "string" || rawProfile.trim() === "")) {
    failures.push(fail("verify commands", "verify.profile must be a non-empty string"));
  }

  const profiles = verify.profiles === undefined ? config?.verify.profiles : verify.profiles;
  if (!isRecord(profiles)) {
    failures.push(fail("verify commands", "verify.profiles must be an object"));
    return failures;
  }

  let selectedStepCount: number | null = null;
  for (const [profileName, profile] of Object.entries(profiles)) {
    if (!isRecord(profile)) {
      failures.push(fail("verify commands", `verify.profiles.${profileName} must be an object`));
      continue;
    }
    const steps = profile.steps;
    if (!Array.isArray(steps)) {
      failures.push(fail("verify commands", `${profilePath(profileName)} must be a list`));
      continue;
    }
    if (profileName === selectedProfile) selectedStepCount = steps.length;
    failures.push(
      ...steps.flatMap((step, index) =>
        commandRunFailures("verify command", `${profilePath(profileName)}[${index}]`, step),
      ),
    );
  }

  if (!Object.hasOwn(profiles, selectedProfile)) {
    failures.push(fail("verify commands", `verify profile "${selectedProfile}" is not defined`));
  } else if (selectedStepCount === 0) {
    failures.push(
      fail("verify commands", `verify profile "${selectedProfile}" has no commands configured`),
    );
  }

  return failures.length > 0
    ? failures
    : [
        pass(
          "verify commands",
          `${plural(selectedStepCount ?? 0, "command")} in ${selectedProfile}`,
        ),
      ];
}

async function baseBranchCheck(
  root: string,
  config: NightcrewConfig | null,
  repoOk: boolean,
  runGit: (args: string[], cwd: string) => Promise<GitResult>,
): Promise<DoctorCheckResult> {
  if (!config) return fail("base branch", "config did not load");
  if (!repoOk) return fail("base branch", "git repository check failed");

  let branch = config.project.baseBranch;
  if (!branch) {
    const current = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], root);
    if (!current.ok)
      return fail("base branch", `cannot resolve current branch: ${gitDetail(current)}`);
    branch = current.stdout.trim();
  }

  const exists = await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], root);
  return exists.ok
    ? pass("base branch", `${branch} exists`)
    : fail("base branch", `${branch} does not exist locally`);
}

async function ghExecutableCheck(
  root: string,
  config: NightcrewConfig | null,
  runGh: (args: string[], cwd: string) => Promise<GitResult>,
): Promise<DoctorCheckResult | null> {
  if (config?.git.mergeMode !== "pr") return null;
  const version = await runGh(["--version"], root);
  return version.ok
    ? pass("gh executable", oneLine(version.stdout))
    : fail("gh executable", gitDetail(version));
}

function registryCheck(root: string, options: DoctorCheckOptions): DoctorCheckResult {
  let registry: Registry;
  try {
    registry =
      typeof options.registry === "function"
        ? options.registry()
        : (options.registry ?? readRegistry());
  } catch (error) {
    return fail("registry", oneLine(error instanceof Error ? error.message : String(error)));
  }

  const normalizedRoot = resolve(root);
  const entry = registry.projects.find((project) => resolve(project.root) === normalizedRoot);
  return entry
    ? pass("registry", `registered as ${entry.name}`)
    : fail("registry", "project root is not registered globally");
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function daemonLockCheck(paths: ProjectPaths, options: DoctorCheckOptions): DoctorCheckResult {
  if (!existsSync(paths.lockFile)) return pass("daemon lock", "no daemon lock present");

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(paths.lockFile, "utf8"));
  } catch {
    return fail("daemon lock", "daemon lock is unreadable; remove .nightcrew/runtime/daemon.lock");
  }

  if (!isRecord(raw) || typeof raw.pid !== "number" || !Number.isInteger(raw.pid)) {
    return fail("daemon lock", "daemon lock is malformed; remove .nightcrew/runtime/daemon.lock");
  }

  const role = typeof raw.role === "string" ? raw.role : "unknown";
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : "unknown start";
  const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  return isAlive(raw.pid)
    ? fail("daemon lock", `active lock held by pid ${raw.pid} (${role}, ${startedAt})`)
    : fail(
        "daemon lock",
        `stale lock for dead pid ${raw.pid}; remove .nightcrew/runtime/daemon.lock`,
      );
}

function providerAuthCheck(
  config: NightcrewConfig | null,
  options: DoctorCheckOptions,
): DoctorCheckResult {
  if (!config) return fail("provider auth", "config did not load");

  const result = preflightProvider(config, options.providerPreflight);
  if (result.status === "skip") return skip(result.name, result.detail);
  return result.ok ? pass(result.name, result.detail) : fail(result.name, result.detail);
}

export async function runDoctorChecks(
  root: string,
  options: DoctorCheckOptions = {},
): Promise<DoctorReport> {
  const normalizedRoot = resolve(root);
  const paths = projectPaths(normalizedRoot);
  const runGit = options.git ?? git;
  const runGh = options.gh ?? gh;
  const checks: DoctorCheckResult[] = [];

  const version = options.nodeVersion ?? process.versions.node;
  const major = nodeMajor(version);
  checks.push(
    major !== null && major >= MIN_NODE_MAJOR
      ? pass("node", `${nodeVersionText(version)} >= ${MIN_NODE_MAJOR}`)
      : fail("node", `${nodeVersionText(version)} is below ${MIN_NODE_MAJOR}`),
  );

  const gitVersion = await runGit(["--version"], normalizedRoot);
  const gitAvailable = gitVersion.ok;
  checks.push(
    gitAvailable
      ? pass("git executable", oneLine(gitVersion.stdout))
      : fail("git executable", gitDetail(gitVersion)),
  );

  const repo = gitAvailable
    ? await runGit(["rev-parse", "--is-inside-work-tree"], normalizedRoot)
    : null;
  const repoOk = repo?.ok === true && repo.stdout.trim() === "true";
  checks.push(
    repoOk
      ? pass("git repository", "inside a git work tree")
      : fail("git repository", repo ? gitDetail(repo) : "git executable check failed"),
  );

  let configInput: unknown = null;
  let config: NightcrewConfig | null = null;
  if (!existsSync(paths.configFile)) {
    checks.push(fail("config", "missing .nightcrew/config.yaml"));
  } else {
    try {
      configInput = parse(readFileSync(paths.configFile, "utf8")) ?? {};
      const parsed = configSchema.safeParse(configInput);
      if (parsed.success) {
        config = parsed.data;
        checks.push(pass("config", "schema valid"));
      } else {
        checks.push(fail("config", oneLine(z.prettifyError(parsed.error))));
      }
    } catch (error) {
      checks.push(
        fail("config", `config.yaml is not valid YAML: ${oneLine((error as Error).message)}`),
      );
    }
  }

  checks.push(...bootstrapCommandChecks(configInput));
  checks.push(...verifyCommandChecks(configInput, config));
  checks.push(providerAuthCheck(config, options));
  const ghCheck = await ghExecutableCheck(normalizedRoot, config, runGh);
  if (ghCheck) checks.push(ghCheck);
  checks.push(await baseBranchCheck(normalizedRoot, config, repoOk, runGit));
  checks.push(registryCheck(normalizedRoot, options));
  checks.push(daemonLockCheck(paths, options));

  return {
    root: normalizedRoot,
    ok: checks.every((result) => result.ok),
    checks,
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const nameWidth = Math.max("Check".length, ...report.checks.map((result) => result.name.length));
  const lines = [
    `${pc.bold("nightcrew doctor")} ${report.ok ? pc.green("passed") : pc.red("failed")}`,
    pc.dim(report.root),
    "",
    `${pc.bold("Check".padEnd(nameWidth))}  ${pc.bold("Result")}  ${pc.bold("Detail")}`,
  ];

  for (const result of report.checks) {
    const status =
      result.status === "skip" ? pc.yellow("SKIP") : result.ok ? pc.green("PASS") : pc.red("FAIL");
    lines.push(`${result.name.padEnd(nameWidth)}  ${status.padEnd(6)}  ${result.detail}`);
  }

  return lines.join("\n");
}
