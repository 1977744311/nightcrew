import { describe, expect, it } from "vitest";
// @ts-expect-error scripts/canary.mjs ships untyped on purpose (plain node script).
import { CANARY_COMMAND_COVERAGE } from "../scripts/canary.mjs";
import { buildProgram } from "../src/cli/program";

/**
 * Self-enforcing canary coverage: every registered CLI command must carry an
 * entry in scripts/canary.mjs. A new user-visible command that skips the
 * canary fails here — coverage is a build gate, not a memory exercise.
 */
function registeredCommandPaths(): string[] {
  const paths: string[] = [];
  for (const command of buildProgram().commands) {
    if (command.commands.length > 0) {
      for (const sub of command.commands) {
        paths.push(`${command.name()} ${sub.name()}`);
      }
    } else {
      paths.push(command.name());
    }
  }
  return paths.sort();
}

describe("canary command manifest", () => {
  it("covers every registered CLI command, with no stale entries", () => {
    const manifest = Object.keys(CANARY_COMMAND_COVERAGE as Record<string, string>).sort();
    expect(manifest).toEqual(registeredCommandPaths());
  });

  it("describes each covered command", () => {
    for (const [command, description] of Object.entries(
      CANARY_COMMAND_COVERAGE as Record<string, string>,
    )) {
      expect(description.length, `manifest entry for "${command}"`).toBeGreaterThan(10);
    }
  });
});
