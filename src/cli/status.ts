import pc from "picocolors";
import type { ProjectContext } from "../config/load";
import { listWorktrees } from "../git/worktree";
import { listPlans } from "../plans/plans";
import { readHistory } from "../state/history";
import { readState } from "../state/state";

export async function printStatus(ctx: ProjectContext): Promise<void> {
  const state = readState(ctx.paths);
  const active = listPlans(ctx.paths, "active");
  const completed = listPlans(ctx.paths, "completed");
  const history = readHistory(ctx.paths, 5);

  console.log(pc.bold(`\n${ctx.config.project.name}`) + pc.dim(`  ${ctx.root}`));

  const flags: string[] = [];
  if (state.paused)
    flags.push(pc.yellow(`paused${state.pausedReason ? `: ${state.pausedReason}` : ""}`));
  if (state.resumeAt) flags.push(pc.yellow(`quota resume at ${state.resumeAt}`));
  if (state.stop) flags.push(pc.red(`stopped: ${state.stop.reason} — ${state.stop.detail ?? ""}`));
  if (state.pendingRepair) {
    flags.push(
      pc.magenta(`pending repair: ${state.pendingRepair.reason} (${state.pendingRepair.planId})`),
    );
  }
  if (flags.length > 0) console.log(flags.map((f) => `  ${f}`).join("\n"));

  console.log(
    `  streaks: failure=${state.streaks.failure} noCommit=${state.streaks.noCommit} controlOnly=${state.streaks.controlOnly}` +
      pc.dim(`  sinceGarden=${state.iterationsSinceGarden}`),
  );

  console.log(
    pc.bold(`\n  plans`) + pc.dim(`  active ${active.length} / completed ${completed.length}`),
  );
  for (const plan of active) {
    const marker = plan.id === state.activePlanId ? pc.green("▶") : " ";
    console.log(
      `  ${marker} ${plan.id}${plan.parallel ? pc.dim(" [parallel]") : ""}  ${plan.title}`,
    );
  }
  if (active.length === 0)
    console.log(pc.dim("    (none — next iteration authors one from the BACKLOG)"));

  const worktrees = (await listWorktrees(ctx.root)).filter((wt) =>
    wt.branch?.startsWith("nightcrew/"),
  );
  if (worktrees.length > 0) {
    console.log(pc.bold("\n  worktrees"));
    for (const wt of worktrees) console.log(`    ${wt.branch}  ${pc.dim(wt.path)}`);
  }

  if (history.length > 0) {
    console.log(pc.bold("\n  recent iterations"));
    for (const record of history) {
      const status =
        record.status === "success"
          ? pc.green(record.status)
          : record.status === "failed"
            ? pc.red(`${record.status}:${record.failure?.kind}`)
            : pc.yellow(record.status);
      console.log(
        `    ${pc.dim(record.startedAt.slice(5, 16))} ${record.operation.padEnd(7)} ${status}` +
          `${record.planId ? ` ${pc.dim(record.planId)}` : ""}` +
          ` ${pc.dim(`${record.commits.length} commits${record.merged ? ", merged" : ""}`)}`,
      );
    }
  }
  console.log();
}
