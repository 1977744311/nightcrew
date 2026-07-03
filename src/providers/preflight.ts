import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NightcrewConfig } from "../config/schema";

export type ProviderPreflightStatus = "pass" | "fail" | "skip";

export interface ProviderPreflightResult {
  name: "provider auth";
  ok: boolean;
  status: ProviderPreflightStatus;
  detail: string;
  provider: NightcrewConfig["provider"]["default"];
}

export interface ProviderPreflightOptions {
  codexHome?: string;
  homeDir?: string;
  env?: { CODEX_HOME?: string };
  readAuthFile?: (path: string) => string;
}

export class ProviderPreflightError extends Error {
  readonly code = "provider_preflight_failed";

  constructor(readonly result: ProviderPreflightResult) {
    super(result.detail);
    this.name = "ProviderPreflightError";
  }
}

function authFilePath(options: ProviderPreflightOptions): string {
  const env = options.env ?? process.env;
  const envCodexHome = env.CODEX_HOME?.trim();
  const codexHome =
    options.codexHome ??
    (envCodexHome ? envCodexHome : join(options.homeDir ?? homedir(), ".codex"));
  return join(codexHome, "auth.json");
}

function readDefaultAuthFile(path: string): string {
  return readFileSync(path, "utf8");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function preflightProvider(
  config: NightcrewConfig,
  options: ProviderPreflightOptions = {},
): ProviderPreflightResult {
  if (config.provider.default === "fake") {
    return {
      name: "provider auth",
      ok: true,
      status: "skip",
      detail: "fake provider does not require Codex auth",
      provider: "fake",
    };
  }

  const authFile = authFilePath(options);
  const readAuthFile = options.readAuthFile ?? readDefaultAuthFile;
  try {
    const raw = readAuthFile(authFile);
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        name: "provider auth",
        ok: false,
        status: "fail",
        detail: `Codex auth file is invalid at ${authFile}; run \`codex login\`.`,
        provider: "codex",
      };
    }
    return {
      name: "provider auth",
      ok: true,
      status: "pass",
      detail: `Codex auth readable at ${authFile}`,
      provider: "codex",
    };
  } catch (error) {
    const reason = error instanceof Error ? oneLine(error.message) : String(error);
    return {
      name: "provider auth",
      ok: false,
      status: "fail",
      detail: `Codex auth not available at ${authFile}; run \`codex login\`. ${reason}`,
      provider: "codex",
    };
  }
}

export function assertProviderPreflight(
  config: NightcrewConfig,
  options: ProviderPreflightOptions = {},
): ProviderPreflightResult {
  const result = preflightProvider(config, options);
  if (!result.ok) throw new ProviderPreflightError(result);
  return result;
}
