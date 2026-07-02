import type { NightcrewConfig } from "../config/schema";
import type { Provider } from "../providers/types";
import { AgentReviewer } from "./agent";
import { NullReviewer, type Reviewer } from "./types";

export function buildReviewer(
  config: NightcrewConfig,
  provider: Provider,
  projectRoot: string,
): Reviewer {
  if (config.review.mode === "off") return new NullReviewer();
  return new AgentReviewer(provider, config, projectRoot);
}
