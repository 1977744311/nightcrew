import { createHash } from "node:crypto";
import type { ProjectContext } from "../config/load";
import { generateProposal, QA_TRIAGE_GOAL, qaDefectBullets } from "../proposals/generate";
import { listPendingProposals } from "../proposals/proposals";
import type { Provider } from "../providers/types";
import { emitEvent } from "../state/events";
import { readState, updateState } from "../state/state";
import { readTextIfExists } from "../utils/fs";
import { isoNow } from "../utils/id";
import { log } from "../utils/log";

export type QaTriageOutcome = "skipped" | "proposed" | "failed";

/**
 * The qa.md closure loop: when the operator has recorded new defect bullets,
 * draft them into a pending proposal (read-only pass) so the morning console
 * shows fix candidates to approve. Guarded to at most one attempt per qa.md
 * content state, and deferred while a qa-sourced proposal already awaits
 * review. Never throws — a failed triage must not take the loop down.
 */
export async function maybeTriageQa(
  ctx: ProjectContext,
  provider: Provider,
): Promise<QaTriageOutcome> {
  const { paths, config } = ctx;

  const bullets = qaDefectBullets(readTextIfExists(paths.qaFile));
  if (!bullets) return "skipped";

  const hash = createHash("sha256").update(bullets).digest("hex");
  if (readState(paths).qaTriage?.hash === hash) return "skipped";
  if (listPendingProposals(paths).some(({ proposal }) => proposal.source === "qa")) {
    return "skipped";
  }

  // Attempt-based guard: a failing triage retries only after qa.md changes.
  updateState(paths, (state) => {
    state.qaTriage = { hash, at: isoNow() };
  });

  try {
    const artifact = await generateProposal({
      goal: QA_TRIAGE_GOAL,
      root: ctx.root,
      paths,
      config,
      provider,
      fromQa: true,
    });
    emitEvent(paths, config.project.name, "qa.triage_proposed", {
      proposalId: artifact.proposal.id,
      items: artifact.proposal.items.length,
    });
    log.info(
      `${config.project.name}: qa triage drafted ${artifact.proposal.items.length} candidate(s) → ${artifact.proposal.id}`,
    );
    return "proposed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitEvent(paths, config.project.name, "qa.triage_failed", { message });
    log.warn(`${config.project.name}: qa triage failed: ${message}`);
    return "failed";
  }
}
