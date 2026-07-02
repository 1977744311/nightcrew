import { resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { version } from "../../package.json";
import { loadProject } from "../config/load";
import { OPERATIONS, type Operation } from "../core/types";
import { runIteration } from "../loop/runner";
import { findPlan, listPlans } from "../plans/plans";
import { buildProvider } from "../providers/factory";
import { buildReviewer } from "../review/factory";
import { initProject } from "./init";
import { printStatus } from "./status";

function rootOf(options: { root?: string }): string {
  return resolve(options.root ?? process.cwd());
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
        const reviewer = buildReviewer(ctx.config, provider);
        const record = await runIteration(
          ctx,
          { provider, reviewer },
          { operation: options.operation as Operation | undefined, planId: options.plan },
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
    .command("status")
    .description("project state: plans, streaks, recent iterations")
    .option("--root <dir>", "project root (default: cwd)")
    .action(async (options: { root?: string }) => {
      await printStatus(loadProject(rootOf(options)));
    });

  const plan = program.command("plan").description("inspect plans");
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
