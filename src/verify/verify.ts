import type { NightcrewConfig } from "../config/schema";
import type { VerifyStepResult, VerifySummary } from "../core/types";
import { runShell, tail } from "../utils/process";

/**
 * Deterministic gates. No provider, no judgment — just commands and exit
 * codes. Steps run in order and stop at the first failure (later steps would
 * only add noise to the repair prompt).
 */
export async function runVerify(
  config: NightcrewConfig,
  cwd: string,
  profileName = config.verify.profile,
): Promise<VerifySummary> {
  const profile = config.verify.profiles[profileName];
  if (!profile) {
    return {
      profile: profileName,
      passed: false,
      steps: [
        {
          name: "profile",
          ok: false,
          exitCode: null,
          durationMs: 0,
          outputTail: `verify profile "${profileName}" is not defined in config.yaml`,
        },
      ],
    };
  }

  const steps: VerifyStepResult[] = [];
  for (const step of profile.steps) {
    const result = await runShell(step.run, { cwd, timeoutMs: step.timeoutMs });
    const ok = !result.timedOut && result.exitCode === 0;
    steps.push({
      name: step.name,
      ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      outputTail: tail(result.timedOut ? `${result.output}\n[timed out]` : result.output),
    });
    if (!ok) break;
  }

  return { profile: profileName, passed: steps.every((step) => step.ok), steps };
}
