import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { readTextIfExists, writeTextAtomic } from "../utils/fs";

/**
 * Global registry (~/.nightcrew/registry.yaml): how the crew daemon and the
 * console discover projects. NIGHTCREW_HOME overrides the location for tests.
 */

const registrySchema = z.object({
  version: z.literal(1).default(1),
  projects: z
    .array(
      z.object({
        name: z.string().min(1),
        root: z.string().min(1),
      }),
    )
    .default([]),
});

export type Registry = z.infer<typeof registrySchema>;

export function nightcrewHome(): string {
  return process.env.NIGHTCREW_HOME ?? join(homedir(), ".nightcrew");
}

export function registryFile(): string {
  return join(nightcrewHome(), "registry.yaml");
}

export function readRegistry(): Registry {
  const raw = readTextIfExists(registryFile());
  if (raw === null) return { version: 1, projects: [] };
  const parsed = registrySchema.safeParse(parse(raw) ?? {});
  if (!parsed.success) {
    throw new Error(
      `Global registry is invalid (${registryFile()}): ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function writeRegistry(registry: Registry): void {
  writeTextAtomic(registryFile(), stringify(registry));
}

export function registerProject(name: string, root: string): Registry {
  const registry = readRegistry();
  const absRoot = resolve(root);
  const existing = registry.projects.find((p) => resolve(p.root) === absRoot);
  if (existing) {
    existing.name = name;
  } else {
    registry.projects.push({ name, root: absRoot });
  }
  writeRegistry(registry);
  return registry;
}
