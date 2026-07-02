import { existsSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { type ProjectPaths, projectPaths } from "../core/paths";
import { readTextIfExists } from "../utils/fs";
import { configSchema, type NightcrewConfig } from "./schema";

export class ConfigError extends Error {}

export interface ProjectContext {
  root: string;
  paths: ProjectPaths;
  config: NightcrewConfig;
}

export function loadConfig(root: string): NightcrewConfig {
  const paths = projectPaths(root);
  const raw = readTextIfExists(paths.configFile);
  if (raw === null) {
    throw new ConfigError(
      `No .nightcrew/config.yaml found in ${root}. Run \`nightcrew init\` first.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    throw new ConfigError(`config.yaml is not valid YAML: ${(error as Error).message}`);
  }
  const result = configSchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw new ConfigError(`config.yaml is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadProject(root: string): ProjectContext {
  if (!existsSync(root)) {
    throw new ConfigError(`Project root does not exist: ${root}`);
  }
  return { root, paths: projectPaths(root), config: loadConfig(root) };
}
