import { existsSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import type { ProjectPaths } from "../core/paths";
import type { PlanDoc, PlanStatus } from "../core/types";
import { ensureDir, readTextIfExists } from "../utils/fs";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedPlanFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parsePlanFile(raw: string): ParsedPlanFile {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw };
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parse(match[1] ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed frontmatter: treat the whole file as body. Plan review /
    // validation reports it; parsing must never throw mid-loop.
  }
  return { frontmatter, body: raw.slice(match[0].length) };
}

function firstHeading(body: string): string | null {
  for (const line of body.split("\n")) {
    const match = line.match(/^#+\s+(.*)$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function readPlan(file: string, status: PlanStatus): PlanDoc | null {
  const raw = readTextIfExists(file);
  if (raw === null) return null;
  const { frontmatter, body } = parsePlanFile(raw);
  const fileId = basename(file).replace(/\.md$/, "");
  const id =
    typeof frontmatter.id === "string" && frontmatter.id.trim() ? frontmatter.id.trim() : fileId;
  const title =
    typeof frontmatter.title === "string" && frontmatter.title.trim()
      ? frontmatter.title.trim()
      : (firstHeading(body) ?? fileId);
  return {
    id,
    title,
    file,
    status,
    parallel: frontmatter.parallel === true,
    maxIterations:
      typeof frontmatter.max_iterations === "number" ? frontmatter.max_iterations : undefined,
    createdAt: typeof frontmatter.created === "string" ? frontmatter.created : undefined,
    body,
    frontmatter,
  };
}

function statusDir(paths: ProjectPaths, status: PlanStatus): string {
  if (status === "active") return paths.activePlansDir;
  if (status === "completed") return paths.completedPlansDir;
  return paths.pausedPlansDir;
}

export function listPlans(paths: ProjectPaths, status: PlanStatus): PlanDoc[] {
  const dir = statusDir(paths, status);
  if (!existsSync(dir)) return [];
  const plans: PlanDoc[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".md")) continue;
    const plan = readPlan(join(dir, entry), status);
    if (plan) plans.push(plan);
  }
  return plans;
}

export function findPlan(paths: ProjectPaths, planId: string): PlanDoc | null {
  for (const status of ["active", "paused", "completed"] as const) {
    const match = listPlans(paths, status).find((plan) => plan.id === planId);
    if (match) return match;
  }
  return null;
}

/**
 * Deterministic selection: lexicographic by filename (date-prefixed ids sort
 * chronologically). Plans marked `parallel: true` can be picked alongside an
 * already-running plan; serial plans queue.
 */
export function selectNextPlan(paths: ProjectPaths, excludeIds: string[] = []): PlanDoc | null {
  const active = listPlans(paths, "active").filter((plan) => !excludeIds.includes(plan.id));
  return active[0] ?? null;
}

export function movePlan(paths: ProjectPaths, plan: PlanDoc, to: PlanStatus): string {
  const targetDir = statusDir(paths, to);
  ensureDir(targetDir);
  const target = join(targetDir, basename(plan.file));
  renameSync(plan.file, target);
  return target;
}

/** Basic structural validation used by plan review and `nightcrew plan lint`. */
export function validatePlan(plan: PlanDoc): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(plan.id)) {
    problems.push(`plan id "${plan.id}" should be kebab-case (got file ${basename(plan.file)})`);
  }
  if (!plan.body.trim()) problems.push("plan body is empty");
  if (plan.body.length > 20_000) problems.push("plan body exceeds 20k chars; scope it down");
  return problems;
}
