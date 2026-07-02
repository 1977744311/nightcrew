import { relative, resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { version } from "../../package.json";
import { loadProject, type ProjectContext } from "../config/load";
import { readRegistry } from "../config/registry";
import { type IterationRecord, OPERATIONS, type Operation } from "../core/types";
import { runLoop } from "../loop/loop";
import { runIteration } from "../loop/runner";
import { createActivePlan, findPlan, listPlans } from "../plans/plans";
import { buildProvider } from "../providers/factory";
import { buildReviewer } from "../review/factory";
import { acquireProjectLock, lockHolder } from "../state/lock";
import { updateState } from "../state/state";
import { renderDoctorReport, runDoctorChecks } from "./doctor";
import { initProject } from "./init";
import { printStatus } from "./status";

function rootOf(options: { root?: string }): string {
  return resolve(options.root ?? process.cwd());
}

function formatRecord(record: IterationRecord): string {
  const status =
    record.status === "success"
      ? pc.green("success")
      : record.status === "failed"
        ? pc.red(`failed:${record.failure?.kind}`)
        : pc.yellow(record.status);
  return (
    `${pc.dim(record.startedAt.slice(11, 19))} ${record.operation.padEnd(7)} ${status}` +
    `${record.planId ? ` ${pc.dim(record.planId)}` : ""} ` +
    pc.dim(`${record.commits.length} commits${record.merged ? ", merged" : ""}`)
  );
}

function withProjectLock<T>(ctx: ProjectContext, role: string, fn: () => Promise<T>): Promise<T> {
  const release = acquireProjectLock(ctx.paths, role);
  if (!release) {
    const holder = lockHolder(ctx.paths);
    throw new Error(
      `another process is driving this project (pid ${holder?.pid}, ${holder?.role}); ` +
        "stop it first or wait for it to finish",
    );
  }
  return fn().finally(release);
}

function rootByName(name: string): string {
  const project = readRegistry().projects.find((candidate) => candidate.name === name);
  if (!project) throw new Error(`project "${name}" is not registered (see \`crew status\`)`);
  return project.root;
}

export function buildProgram(): Command {
  const program = new Command();
  program.name("nightcrew").description("Your coding agents on the night shift.").version(version);

  program
    .command("init")
    .description("scaffold .nightcrew/ in the current repo and register it")
    .option("--root <dir>", "project root (default: cwd)")
    .option("--name <name>", "project name (default: directory name)")
    .action(async (options: { root?: string; name?: string }) => {
      await initProject(rootOf(options), { name: options.name });
    });

  program
    .command("doctor")
    .description("preflight the local runtime, repository, config, registry, and daemon lock")
    .option("--root <dir>", "project root (default: cwd)")
    .action(async (options: { root?: string }) => {
      const report = await runDoctorChecks(rootOf(options));
      console.log(renderDoctorReport(report));
      process.exitCode = report.ok ? 0 : 1;
    });

  program
    .command("run")
    .description("run exactly one iteration (operation auto-resolves unless overridden)")
    .option("--root <dir>", "project root (default: cwd)")
    .option("-o, --operation <op>", `one of: ${OPERATIONS.join(", ")}`)
    .option("-p, --plan <id>", "target plan id (execute/repair)")
    .option("--json", "print the iteration record as JSON")
    .action(
      async (options: { root?: string; operation?: string; plan?: string; json?: boolean }) => {
        if (options.operation && !OPERATIONS.includes(options.operation as Operation)) {
          throw new Error(
            `unknown operation "${options.operation}"; use one of: ${OPERATIONS.join(", ")}`,
          );
        }
        const ctx = loadProject(rootOf(options));
        const provider = buildProvider(ctx.config, ctx.root);
        const reviewer = buildReviewer(ctx.config, provider, ctx.root);
        const record = await withProjectLock(ctx, "run", () =>
          runIteration(
            ctx,
            { provider, reviewer },
            { operation: options.operation as Operation | undefined, planId: options.plan },
          ),
        );
        if (options.json) {
          console.log(JSON.stringify(record, null, 2));
        } else {
          const status =
            record.status === "success"
              ? pc.green("success")
              : record.status === "failed"
                ? pc.red(
                    `failed (${record.failure?.kind}: ${record.failure?.message.slice(0, 200)})`,
                  )
                : pc.yellow(record.status);
          console.log(
            `${record.operation}${record.planId ? ` ${record.planId}` : ""}: ${status} — ` +
              `${record.commits.length} commits${record.merged ? ", merged" : ""} in ${Math.round(record.durationMs / 1000)}s`,
          );
          for (const note of record.notes ?? []) console.log(pc.dim(`  · ${note}`));
        }
        if (record.status === "failed") process.exitCode = 1;
      },
    );

  program
    .command("loop")
    .description("run iterations until a guard stops the loop")
    .option("--root <dir>", "project root (default: cwd)")
    .option("-n, --max-iterations <n>", "iteration budget for this loop run")
    .action(async (options: { root?: string; maxIterations?: string }) => {
      const ctx = loadProject(rootOf(options));
      const provider = buildProvider(ctx.config, ctx.root);
      const reviewer = buildReviewer(ctx.config, provider, ctx.root);
      const controller = new AbortController();
      process.on("SIGINT", () => controller.abort());
      const result = await withProjectLock(ctx, "loop", () =>
        runLoop(
          ctx,
          { provider, reviewer },
          {
            maxIterations: options.maxIterations ? Number(options.maxIterations) : undefined,
            signal: controller.signal,
            onRecord: (record) => console.log(formatRecord(record)),
          },
        ),
      );
      console.log(
        `loop finished after ${result.iterations} iterations` +
          (result.stop
            ? `: ${pc.bold(result.stop.reason)}${result.stop.detail ? ` — ${result.stop.detail}` : ""}`
            : ""),
      );
    });

  program
    .command("pause")
    .description("pause the loop (takes effect before the next iteration)")
    .option("--root <dir>", "project root (default: cwd)")
    .option("--reason <text>", "why (shown in status and console)")
    .action(async (options: { root?: string; reason?: string }) => {
      const ctx = loadProject(rootOf(options));
      updateState(ctx.paths, (state) => {
        state.paused = true;
        state.pausedReason = options.reason;
      });
      console.log("paused");
    });

  program
    .command("resume")
    .description("resume a paused loop and clear stop verdicts")
    .option("--root <dir>", "project root (default: cwd)")
    .action(async (options: { root?: string }) => {
      const ctx = loadProject(rootOf(options));
      updateState(ctx.paths, (state) => {
        state.paused = false;
        state.pausedReason = undefined;
        state.stop = undefined;
      });
      console.log("resumed");
    });

  program
    .command("status")
    .description("project state: plans, streaks, recent iterations")
    .option("--root <dir>", "project root (default: cwd)")
    .action(async (options: { root?: string }) => {
      await printStatus(loadProject(rootOf(options)));
    });

  program
    .command("report")
    .description("the morning digest: what landed overnight, what needs you")
    .option("--root <dir>", "project root (default: cwd)")
    .option("--hours <n>", "look-back window in hours", "24")
    .option("--json", "print the report as JSON")
    .action(async (options: { root?: string; hours: string; json?: boolean }) => {
      const { buildReport, renderReport } = await import("./report");
      const ctx = loadProject(rootOf(options));
      const report = buildReport(ctx, Number(options.hours) * 3_600_000);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(renderReport(report));
      }
    });

  program
    .command("console")
    .description("serve the local web console (read-only board + live events)")
    .option("--port <port>", "port", "4711")
    .option("--host <host>", "bind host", "127.0.0.1")
    .option("--actions", "enable pause/resume/gc actions from the console")
    .action(async (options: { port: string; host: string; actions?: boolean }) => {
      const { createConsoleServer } = await import("../console/server");
      createConsoleServer({
        port: Number(options.port),
        host: options.host,
        actions: options.actions ?? false,
      });
      await new Promise(() => {}); // serve until Ctrl-C
    });

  program
    .command("gc")
    .description("clean stale worktrees, sessions, and old iteration logs")
    .option("--root <dir>", "project root (default: cwd)")
    .action(async (options: { root?: string }) => {
      const { gcProject } = await import("./gc");
      const result = await gcProject(rootOf(options));
      console.log(
        `gc: removed ${result.removedWorktrees.length} worktrees, ` +
          `cleared ${result.clearedSessions.length} stale sessions, pruned ${result.prunedLogs} logs`,
      );
    });

  const plan = program.command("plan").description("inspect plans");
  plan
    .command("add <title...>")
    .description("create an active plan scaffold")
    .option("--root <dir>", "project root (default: cwd)")
    .action(async (titleParts: string[], options: { root?: string }) => {
      const ctx = loadProject(rootOf(options));
      const doc = createActivePlan(ctx.paths, titleParts.join(" "));
      const path = relative(ctx.root, doc.file).replaceAll("\\", "/");
      console.log(`${pc.green("created")} ${path}`);
    });
  plan
    .command("list")
    .description("list plans by status")
    .option("--root <dir>", "project root (default: cwd)")
    .action(async (options: { root?: string }) => {
      const ctx = loadProject(rootOf(options));
      for (const status of ["active", "paused", "completed"] as const) {
        const plans = listPlans(ctx.paths, status);
        if (plans.length === 0) continue;
        console.log(pc.bold(status));
        for (const doc of plans) {
          console.log(`  ${doc.id}${doc.parallel ? pc.dim(" [parallel]") : ""}  ${doc.title}`);
        }
      }
    });
  plan
    .command("show <id>")
    .description("print one plan file")
    .option("--root <dir>", "project root (default: cwd)")
    .action(async (id: string, options: { root?: string }) => {
      const ctx = loadProject(rootOf(options));
      const doc = findPlan(ctx.paths, id);
      if (!doc) throw new Error(`plan "${id}" not found`);
      console.log(pc.dim(`# ${doc.file} (${doc.status})`));
      console.log(doc.body);
    });

  const crew = program
    .command("crew")
    .description("multi-project daemon (also available as the `crew` bin)");

  crew
    .command("start")
    .description("drive all registered projects (schedule windows apply)")
    .option("--projects <names>", "comma-separated subset of registered projects")
    .option("--now", "ignore schedule windows and start immediately")
    .option("--poll <ms>", "scheduler poll interval", "15000")
    .option("--console", "also serve the web console (with actions enabled)")
    .option("--port <port>", "console port", "4711")
    .action(
      async (options: {
        projects?: string;
        now?: boolean;
        poll: string;
        console?: boolean;
        port: string;
      }) => {
        const { runCrewDaemon } = await import("../scheduler/daemon");
        const controller = new AbortController();
        process.on("SIGINT", () => controller.abort());
        process.on("SIGTERM", () => controller.abort());
        if (options.console) {
          const { createConsoleServer } = await import("../console/server");
          createConsoleServer({ port: Number(options.port), actions: true });
        }
        const result = await runCrewDaemon({
          projects: options.projects?.split(",").map((name) => name.trim()),
          signal: controller.signal,
          pollMs: Number(options.poll),
          ignoreWindows: options.now ?? false,
          onRecord: (record) =>
            console.log(`${pc.dim(`[${record.projectName}]`)} ${formatRecord(record)}`),
        });
        for (const project of result.projects) {
          console.log(
            `${project.name}: ${project.iterations} iterations${project.error ? pc.red(` (${project.error})`) : ""}`,
          );
        }
      },
    );

  crew
    .command("status")
    .description("one-line status for every registered project")
    .action(async () => {
      const { registeredProjects, summarize } = await import("../console/data");
      const projects = registeredProjects();
      if (projects.length === 0) {
        console.log("no projects registered — run `nightcrew init` in a repo");
        return;
      }
      for (const project of projects) {
        const summary = summarize(project);
        if (!summary.ok) {
          console.log(`${pc.bold(project.name.padEnd(20))} ${pc.red(`error: ${summary.error}`)}`);
          continue;
        }
        const state = summary.state;
        const flags: string[] = [];
        if (state?.paused) flags.push(pc.yellow("paused"));
        if (state?.resumeAt) flags.push(pc.yellow("quota-wait"));
        if (state?.stop) flags.push(pc.red(`stopped:${state.stop.reason}`));
        if (flags.length === 0) flags.push(pc.green("ready"));
        const last = summary.lastIteration;
        console.log(
          `${pc.bold(project.name.padEnd(20))} ${flags.join(" ")} ` +
            pc.dim(
              `plans ${summary.activePlans} active/${summary.completedPlans} done` +
                (last
                  ? `  last: ${last.operation} ${last.status} ${last.startedAt.slice(5, 16)}`
                  : ""),
            ),
        );
      }
    });

  crew
    .command("pause <name>")
    .description("pause a registered project by name")
    .option("--reason <text>", "why")
    .action(async (name: string, options: { reason?: string }) => {
      const ctx = loadProject(rootByName(name));
      updateState(ctx.paths, (state) => {
        state.paused = true;
        state.pausedReason = options.reason ?? "paused via crew";
      });
      console.log(`${name}: paused`);
    });

  crew
    .command("resume <name>")
    .description("resume a registered project by name")
    .action(async (name: string) => {
      const ctx = loadProject(rootByName(name));
      updateState(ctx.paths, (state) => {
        state.paused = false;
        state.pausedReason = undefined;
        state.stop = undefined;
      });
      console.log(`${name}: resumed`);
    });

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
