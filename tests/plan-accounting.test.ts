import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IterationRecord, TokenUsage } from "../src/core/types";
import { aggregatePlanHistory } from "../src/plans/accounting";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject | undefined;

function usage(inputTokens: number, outputTokens = 0, reasoningOutputTokens = 0): TokenUsage {
  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningOutputTokens,
  };
}

function record(startedAt: string, options: Partial<IterationRecord> = {}): IterationRecord {
  return {
    id: `iteration-${startedAt}`,
    projectName: "demo",
    startedAt,
    endedAt: startedAt,
    durationMs: 1,
    operation: "execute",
    planId: null,
    status: "success",
    commits: [],
    controlOnly: false,
    usage: null,
    merged: false,
    ...options,
  };
}

afterEach(() => {
  project?.cleanup();
  project = undefined;
});

describe("plan history accounting", () => {
  it("aggregates iterations, token totals, duration, title, and landed status by plan", async () => {
    project = await makeTempProject();
    writeFileSync(
      join(project.root, ".nightcrew/plans/completed/2026-07-02-ship.md"),
      planFileContents("2026-07-02-ship", "Ship the feature"),
    );
    writeFileSync(
      join(project.root, ".nightcrew/plans/active/2026-07-02-polish.md"),
      planFileContents("2026-07-02-polish", "Polish the feature"),
    );

    const metrics = aggregatePlanHistory(project.ctx(), [
      record("2026-07-02T10:00:00.000Z", {
        planId: "2026-07-02-ship",
        durationMs: 1_200,
        usage: usage(100, 10, 5),
      }),
      record("2026-07-02T10:15:00.000Z", {
        planId: "2026-07-02-ship",
        durationMs: 1_800,
        merged: true,
        usage: usage(20),
      }),
      record("2026-07-02T11:00:00.000Z", {
        planId: "2026-07-02-polish",
        durationMs: 60_000,
        usage: null,
      }),
      record("2026-07-02T11:30:00.000Z", {
        operation: "garden",
        durationMs: 999,
        usage: usage(500),
      }),
    ]);

    expect(metrics).toEqual([
      {
        planId: "2026-07-02-ship",
        title: "Ship the feature",
        iterations: 2,
        usage: usage(120, 10, 5),
        totalTokens: 135,
        durationMs: 3_000,
        status: "landed",
        landed: true,
      },
      {
        planId: "2026-07-02-polish",
        title: "Polish the feature",
        iterations: 1,
        usage: null,
        totalTokens: 0,
        durationMs: 60_000,
        status: "pending",
        landed: false,
      },
    ]);
  });

  it("falls back to the plan id when no plan file title is available", async () => {
    project = await makeTempProject();

    expect(
      aggregatePlanHistory(project.ctx(), [
        record("2026-07-02T12:00:00.000Z", {
          planId: "2026-07-02-missing",
          durationMs: 42,
        }),
      ]),
    ).toMatchObject([{ planId: "2026-07-02-missing", title: "2026-07-02-missing" }]);
  });
});
