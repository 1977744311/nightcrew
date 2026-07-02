import pc from "picocolors";
import { loadProject } from "../config/load";
import { readRegistry } from "../config/registry";
import { buildReport, type ReportData } from "./report";

export type CrewReportProject =
  | {
      name: string;
      root: string;
      ok: true;
      landedPlans: number;
      failedIterations: number;
      totalTokens: number;
      report: ReportData;
    }
  | {
      name: string;
      root: string;
      ok: false;
      landedPlans: 0;
      failedIterations: 0;
      totalTokens: 0;
      error: string;
    };

export interface CrewReportData {
  since: string;
  until: string;
  projects: CrewReportProject[];
  totals: {
    projects: number;
    readableProjects: number;
    unreadableProjects: number;
    landedPlans: number;
    failedIterations: number;
    totalTokens: number;
  };
}

function reportProject(name: string, root: string, sinceMs: number): CrewReportProject {
  try {
    const report = buildReport(loadProject(root), sinceMs);
    return {
      name,
      root,
      ok: true,
      landedPlans: report.landed.length,
      failedIterations: report.iterations.failed,
      totalTokens: report.totalTokens,
      report,
    };
  } catch (error) {
    return {
      name,
      root,
      ok: false,
      landedPlans: 0,
      failedIterations: 0,
      totalTokens: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildCrewReport(sinceMs: number): CrewReportData {
  const now = Date.now();
  const projects = readRegistry().projects.map((project) =>
    reportProject(project.name, project.root, sinceMs),
  );
  const readableProjects = projects.filter((project) => project.ok).length;

  return {
    since: new Date(now - sinceMs).toISOString(),
    until: new Date(now).toISOString(),
    projects,
    totals: {
      projects: projects.length,
      readableProjects,
      unreadableProjects: projects.length - readableProjects,
      landedPlans: projects.reduce((sum, project) => sum + project.landedPlans, 0),
      failedIterations: projects.reduce((sum, project) => sum + project.failedIterations, 0),
      totalTokens: projects.reduce((sum, project) => sum + project.totalTokens, 0),
    },
  };
}

export function renderCrewReport(report: CrewReportData): string {
  const lines: string[] = [];
  const hours = Math.round((Date.parse(report.until) - Date.parse(report.since)) / 3_600_000);
  lines.push("");
  lines.push(
    pc.bold("☾ crew report") +
      pc.dim(`  last ${hours}h  (${report.since.slice(5, 16)} → ${report.until.slice(5, 16)})`),
  );
  lines.push("");

  const totals = report.totals;
  lines.push(
    `  projects   ${pc.bold(String(totals.projects))}  ` +
      [
        pc.green(`${totals.readableProjects} readable`),
        totals.unreadableProjects > 0
          ? pc.red(`${totals.unreadableProjects} unreadable`)
          : pc.dim("0 unreadable"),
      ].join(pc.dim(" · ")),
  );
  lines.push(
    `  landed     ${pc.bold(String(totals.landedPlans))}    ` +
      `failed  ${pc.bold(String(totals.failedIterations))}    ` +
      `tokens  ${pc.bold(totals.totalTokens.toLocaleString())}`,
  );

  lines.push("");
  lines.push(pc.bold("  projects"));
  if (report.projects.length === 0) {
    lines.push(pc.dim("    no projects registered — run `nightcrew init` in a repo"));
  }
  const nameWidth = Math.max(
    "project".length,
    ...report.projects.map((project) => project.name.length),
  );
  for (const project of report.projects) {
    const name = project.name.padEnd(nameWidth);
    if (!project.ok) {
      lines.push(`    ${pc.bold(name)}  ${pc.red(`error: ${project.error}`)}`);
      continue;
    }
    lines.push(
      `    ${pc.bold(name)}  landed ${pc.green(String(project.landedPlans)).padStart(1)}  ` +
        `failed ${project.failedIterations > 0 ? pc.red(String(project.failedIterations)) : pc.dim("0")}  ` +
        `tokens ${pc.bold(project.totalTokens.toLocaleString())}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
