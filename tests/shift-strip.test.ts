import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/program";
import { buildReport, renderReport } from "../src/cli/report";
import {
  renderShift,
  type ShiftEntry,
  type ShiftInput,
  shiftHeadline,
  toShiftEntries,
} from "../src/cli/shift-strip";
import type { IterationRecord, TokenUsage } from "../src/core/types";
import { appendHistory } from "../src/state/history";
import { makeTempProject, type TestProject } from "./helpers";

const T0 = Date.parse("2026-07-02T23:00:00.000Z");
/** `columns` that yield the 10-cell minimum strip: 14 gutter + 4 margin + 10 cells. */
const TEN_CELLS = 28;

let project: TestProject | undefined;

afterEach(() => {
  project?.cleanup();
  project = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function at(minutes: number): string {
  return new Date(T0 + minutes * 60_000).toISOString();
}

function usage(total: number): TokenUsage {
  return {
    inputTokens: total,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function entry(
  startMinute: number,
  endMinute: number,
  options: Partial<ShiftEntry> = {},
): ShiftEntry {
  return {
    startedAt: at(startMinute),
    endedAt: at(endMinute),
    status: "success",
    merged: false,
    tokens: 0,
    ...options,
  };
}

function record(
  startMinute: number,
  endMinute: number,
  options: Partial<IterationRecord> = {},
): IterationRecord {
  return {
    id: `iteration-${startMinute}`,
    projectName: "demo",
    startedAt: at(startMinute),
    endedAt: at(endMinute),
    durationMs: (endMinute - startMinute) * 60_000,
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

function counts(overrides: Partial<ShiftInput["iterations"]> = {}): ShiftInput["iterations"] {
  return { total: 0, success: 0, failed: 0, idle: 0, quota: 0, ...overrides };
}

/** Input whose verdict counts agree with the timeline, like a real report's. */
function input(timeline: ShiftEntry[]): ShiftInput {
  return {
    iterations: counts({
      total: timeline.length,
      success: timeline.filter((item) => item.status === "success").length,
      failed: timeline.filter((item) => item.status === "failed").length,
      idle: timeline.filter((item) => item.status === "idle").length,
      quota: timeline.filter((item) => item.status === "quota").length,
    }),
    landed: timeline.filter((item) => item.merged).length,
    timeline,
  };
}

/** The glyph run of one strip row, e.g. `row(lines, "shift")` -> "●●·◆". */
function row(lines: string[], label: "tokens" | "shift"): string {
  const match = lines
    .map((line) => new RegExp(`^\\s*${label}\\s+(\\S+)$`).exec(line))
    .find(Boolean);
  if (!match?.[1]) throw new Error(`no ${label} row in:\n${lines.join("\n")}`);
  return match[1];
}

function marksFor(timeline: ShiftEntry[], columns = TEN_CELLS): string {
  return row(renderShift(input(timeline), { columns }), "shift");
}

async function captureConsole(action: () => Promise<void>): Promise<string> {
  const stdout: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.join(" "));
  });
  try {
    await action();
  } finally {
    log.mockRestore();
  }
  return stdout.join("\n");
}

describe("shift strip entries", () => {
  it("reduces ledger records to entries, oldest start first, skipping unreadable times", () => {
    const entries = toShiftEntries([
      record(30, 40, { usage: usage(500), merged: true }),
      record(0, 10, {
        status: "failed",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 99,
          outputTokens: 5,
          reasoningOutputTokens: 1,
        },
      }),
      record(50, 45), // ended before it started: a zero-length point, not a negative span
      { ...record(60, 70), startedAt: "not a date" },
      { ...record(80, 90), endedAt: "garbage" },
    ]);

    expect(entries).toEqual([
      { startedAt: at(0), endedAt: at(10), status: "failed", merged: false, tokens: 16 },
      { startedAt: at(30), endedAt: at(40), status: "success", merged: true, tokens: 500 },
      { startedAt: at(50), endedAt: at(50), status: "success", merged: false, tokens: 0 },
      { startedAt: at(80), endedAt: at(80), status: "success", merged: false, tokens: 0 },
    ]);
  });
});

describe("shift verdict", () => {
  it.each([
    ["no iterations at all", counts(), 0, "calm", "The crew never clocked in."],
    [
      "landings and nothing broke",
      counts({ total: 4, success: 4 }),
      3,
      "good",
      "Clean shift — 3 plans landed, nothing broke.",
    ],
    [
      "a single landing is singular",
      counts({ total: 2, success: 2 }),
      1,
      "good",
      "Clean shift — 1 plan landed, nothing broke.",
    ],
    [
      "landings despite failures",
      counts({ total: 5, success: 3, failed: 1 }),
      2,
      "warn",
      "Busy shift — 2 plans landed, 1 failure along the way.",
    ],
    [
      "failures and nothing landed",
      counts({ total: 3, success: 1, failed: 2 }),
      0,
      "bad",
      "Rough shift — nothing landed, 2 failures to look at.",
    ],
    [
      "progress without a landing yet",
      counts({ total: 3, success: 3 }),
      0,
      "calm",
      "Steady shift — 3 iterations of progress, nothing landed yet.",
    ],
    [
      "only quota walls and idle passes",
      counts({ total: 2, idle: 1, quota: 1 }),
      0,
      "warn",
      "Stalled shift — the crew hit its quota ceiling.",
    ],
    [
      "only idle passes (nothing queued)",
      counts({ total: 2, idle: 2 }),
      0,
      "calm",
      "Quiet shift — nothing queued, so the crew stood by.",
    ],
  ])("%s", (_name, iterations, landed, tone, text) => {
    expect(shiftHeadline({ iterations, landed })).toEqual({ tone, text });
  });
});

describe("shift strip rendering", () => {
  it("lays cells out by wall-clock time, so quiet gaps look like gaps", () => {
    // 60 minutes over 10 cells = 6 minutes per cell.
    expect(marksFor([entry(0, 10), entry(50, 60)])).toBe("●●······●●");
  });

  it("does not paint the next cell when an iteration ends exactly on a cell edge", () => {
    // 6 minutes per cell; the first iteration ends on the edge between cells 1 and 2.
    expect(marksFor([entry(0, 12, { merged: true }), entry(54, 60)])).toBe("●◆·······●");
  });

  it("keeps a landing visible when the next iteration starts in the same cell", () => {
    // 4 minutes per cell; the landing ends in cell 4, where a concurrent lane's failure begins.
    const marks = marksFor([entry(0, 18, { merged: true }), entry(19, 40, { status: "failed" })]);

    expect(marks).toBe("●●●●◆✗✗✗✗✗");
    expect(marks.split("◆")).toHaveLength(2);
  });

  it("surfaces trouble over routine work when marks collide: failed, quota, ok, idle", () => {
    const lane = (status: ShiftEntry["status"]): ShiftEntry => entry(0, 0, { status });

    expect(marksFor([lane("idle"), lane("success"), lane("quota"), lane("failed")])).toBe("✗");
    expect(marksFor([lane("idle"), lane("success"), lane("quota")])).toBe("◐");
    expect(marksFor([lane("idle"), lane("success")])).toBe("●");
    expect(marksFor([lane("idle")])).toBe("○");
  });

  it("spreads each iteration's tokens over the time it ran and scales to the busiest cell", () => {
    // 3 minutes per cell. 100 tokens over 10 minutes; 800 tokens over the last 10 minutes.
    const lines = renderShift(
      input([entry(0, 10, { tokens: 100 }), entry(20, 30, { tokens: 800 })]),
      { columns: TEN_CELLS },
    );

    expect(row(lines, "tokens")).toBe("▁▁▁▁··▃███");
    expect(row(lines, "shift")).toBe("●●●●··●●●●");
  });

  it("fits the terminal: never more than 60 cells, never fewer than 10, fewer for short shifts", () => {
    const day = [entry(0, 10), entry(24 * 60 - 10, 24 * 60)];

    expect(marksFor(day, 200)).toHaveLength(60);
    expect(marksFor(day, 40)).toHaveLength(22);
    expect(marksFor(day, 5)).toHaveLength(10);
    expect(marksFor(day, Number.NaN)).toHaveLength(60); // unknown width: assume an 80-column terminal
    expect(marksFor([entry(0, 4)], 200)).toHaveLength(4); // minute-sized cells at the finest
  });

  it("never draws a line wider than the terminal, even with every glyph in the legend", () => {
    const timeline = [
      entry(0, 20, { merged: true }),
      entry(30, 60, { status: "failed" }),
      entry(70, 90, { status: "quota" }),
      entry(600, 605, { status: "idle" }),
      entry(900, 960),
    ];

    for (const columns of [70, 80, 100, 160]) {
      const widest = Math.max(
        ...renderShift(input(timeline), { columns }).map((line) => [...line].length),
      );
      expect(widest).toBeLessThanOrEqual(columns);
    }
  });

  it("draws a single cell for an instant", () => {
    const lines = renderShift(input([entry(0, 0, { merged: true, tokens: 42 })]));

    expect(row(lines, "shift")).toBe("◆");
    expect(row(lines, "tokens")).toBe("█");
    expect(lines.join("\n")).toContain("07-02 23:00");
  });

  it("skips entries it cannot place instead of throwing", () => {
    const unplaceable = { ...entry(0, 5), startedAt: "nope" };

    expect(renderShift({ ...input([entry(0, 5)]), timeline: [unplaceable] })).toHaveLength(1);
  });

  it("labels the span in UTC with total crew time, counting concurrent lanes once each", () => {
    const text = renderShift(input([entry(0, 60), entry(0, 60), entry(120, 180)])).join("\n");

    expect(text).toContain("07-02 23:00");
    expect(text).toContain("07-03 02:00");
    expect(text).toContain("3h 0m crew time");
    expect(text).toContain("UTC");
  });

  it("explains only the glyphs on the strip", () => {
    const legendOf = (timeline: ShiftEntry[]): string =>
      renderShift(input(timeline), { columns: TEN_CELLS }).at(-1) ?? "";

    expect(legendOf([entry(0, 5), entry(50, 55)]).trim()).toBe("● ok  · off");

    const busy = legendOf([
      entry(0, 5, { merged: true }),
      entry(5, 10, { status: "failed" }),
      entry(10, 15, { status: "quota" }),
      entry(15, 20, { status: "idle" }),
    ]).trim();
    expect(busy).toBe("◆ landed  ✗ failed  ◐ quota  ● ok  ○ idle");
  });

  it("is just the verdict when the window had no iterations", () => {
    expect(renderShift({ iterations: counts(), landed: 0, timeline: [] })).toEqual([
      "  The crew never clocked in.",
    ]);
  });

  it("does not conjure a strip from ledger entries the iteration tally does not count", () => {
    // e.g. triage/propose spend appended to the ledger outside any loop iteration
    expect(renderShift({ iterations: counts(), landed: 0, timeline: [entry(0, 5)] })).toEqual([
      "  The crew never clocked in.",
    ]);
  });
});

describe("shift strip in the morning report", () => {
  it("opens the report with the verdict and strip, and ships the timeline in --json", async () => {
    project = await makeTempProject();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at(8 * 60)));
    const { paths } = project.ctx();
    appendHistory(paths, record(0, 20, { planId: "ship", usage: usage(1000), merged: true }));
    appendHistory(
      paths,
      record(25, 40, {
        planId: "polish",
        status: "failed",
        failure: { kind: "provider_error", message: "blip" },
        usage: usage(400),
      }),
    );

    const report = buildReport(project.ctx(), 24 * 3_600_000);
    expect(report.timeline).toEqual([
      { startedAt: at(0), endedAt: at(20), status: "success", merged: true, tokens: 1000 },
      { startedAt: at(25), endedAt: at(40), status: "failed", merged: false, tokens: 400 },
    ]);

    const text = renderReport(report);
    expect(text).toContain("Busy shift — 1 plan landed, 1 failure along the way.");
    expect(text).toContain("◆ landed");
    expect(text).toContain("35m crew time");
    // The verdict leads: it sits above the stat rows it summarizes.
    expect(text.indexOf("Busy shift")).toBeLessThan(text.indexOf("iterations  2"));

    const json = await captureConsole(() =>
      runCli(["report", "--root", project?.root ?? "", "--hours", "24", "--json"]),
    );
    const parsed = JSON.parse(json) as ReturnType<typeof buildReport>;
    expect(parsed.timeline).toEqual(report.timeline);
  });

  it("greets an empty window with the verdict alone", async () => {
    project = await makeTempProject();

    const text = renderReport(buildReport(project.ctx(), 3_600_000));

    expect(text).toContain("The crew never clocked in.");
    expect(text).not.toContain("crew time");
  });
});
