import { isAbsolute, resolve } from "node:path";
import type { NightcrewConfig } from "../config/schema";
import type { ModelTier, Operation } from "../core/types";
import { CodexProvider } from "./codex";
import { FakeProvider } from "./fake";
import type { Provider } from "./types";

export function buildProvider(config: NightcrewConfig, projectRoot: string): Provider {
  if (config.provider.default === "fake") {
    const script = config.provider.fake?.script;
    if (!script) {
      throw new Error("provider.default is 'fake' but provider.fake.script is not set");
    }
    return new FakeProvider(isAbsolute(script) ? script : resolve(projectRoot, script));
  }
  return new CodexProvider({
    sandbox: config.provider.codex.sandbox,
    networkAccess: config.provider.codex.networkAccess,
  });
}

export function tierFor(config: NightcrewConfig, operation: Operation): ModelTier {
  switch (operation) {
    case "plan":
      return config.routing.plan;
    case "execute":
      return config.routing.execute;
    case "repair":
      return config.routing.repair;
    case "garden":
      return config.routing.garden;
    case "verify":
      return "light";
  }
}

export function modelFor(config: NightcrewConfig, tier: ModelTier): string | undefined {
  return config.provider.codex.tiers[tier];
}

export function modelForOperation(
  config: NightcrewConfig,
  operation: Operation,
): string | undefined {
  return modelFor(config, tierFor(config, operation));
}

export function reviewModel(config: NightcrewConfig): string | undefined {
  return modelFor(config, config.routing.review);
}
