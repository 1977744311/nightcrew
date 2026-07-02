import type { NightcrewConfig } from "../config/schema";
import type { Provider } from "../providers/types";
import { NullReviewer, type Reviewer } from "./types";

export function buildReviewer(_config: NightcrewConfig, _provider: Provider): Reviewer {
  // Phase 2 wires the provider-backed review agent; the pipeline seam is live now.
  return new NullReviewer();
}
