import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/program";
import { listPlans, validatePlan } from "../src/plans/plans";
import { makeTempProject, type TestProject } from "./helpers";

let project: TestProject | undefined;

async function captureConsole(
  action: () => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
  try {
    await action();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

afterEach(() => {
  project?.cleanup();
  project = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("nightcrew plan add", () => {
  it("creates a schema-valid active plan scaffold and prints the created path", async () => {
    project = await makeTempProject();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));

    const output = await captureConsole(() =>
      runCli(["plan", "add", "Ship", "payments: fast!", "--root", project?.root ?? ""]),
    );

    const id = "2026-07-02-ship-payments-fast";
    const relPath = `.nightcrew/plans/active/${id}.md`;
    const file = join(project.root, relPath);
    const plans = listPlans(project.ctx().paths, "active");
    const plan = plans[0];
    if (!plan) throw new Error("expected created plan");

    expect(output.stdout).toContain(`created ${relPath}`);
    expect(output.stderr).toBe("");
    expect(plans).toHaveLength(1);
    expect(plan).toMatchObject({
      id,
      title: "Ship payments: fast!",
      status: "active",
      parallel: false,
      createdAt: "2026-07-02",
    });
    expect(validatePlan(plan)).toEqual([]);

    const contents = readFileSync(file, "utf8");
    expect(contents).toContain("## Goal\nShip payments: fast!");
    expect(contents).toContain("## Acceptance\n- [ ] Define the acceptance criteria.");
    expect(contents).toContain("## Steps\n1. Define the implementation steps.");
  });

  it("rejects duplicate generated ids without overwriting the existing plan", async () => {
    project = await makeTempProject();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));

    await captureConsole(() =>
      runCli(["plan", "add", "Ship payments", "--root", project?.root ?? ""]),
    );
    process.exitCode = undefined;

    const file = join(project.root, ".nightcrew/plans/active/2026-07-02-ship-payments.md");
    const before = readFileSync(file, "utf8");
    const output = await captureConsole(() =>
      runCli(["plan", "add", "Ship payments", "--root", project?.root ?? ""]),
    );
    const after = readFileSync(file, "utf8");

    expect(process.exitCode).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain('plan "2026-07-02-ship-payments" already exists');
    expect(after).toBe(before);
    expect(listPlans(project.ctx().paths, "active")).toHaveLength(1);
  });
});
