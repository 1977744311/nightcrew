import pc from "picocolors";
import type { IterationRecord } from "../core/types";
import { totalTokens } from "../core/types";

/**
 * The shift strip: the shape of a night in a handful of terminal lines. A
 * one-line verdict, then a token-burn sparkline over one outcome mark per time
 * cell — so "when did it land, when did it stall" is visible before any table
 * is read. Cells are proportional to wall-clock time, not to iteration count,
 * so quiet gaps look like gaps.
 *
 * Pure data in, strings out: the report reduces the ledger to `ShiftEntry`s
 * (they ship in `report --json` as `timeline`), this module owns the glyphs.
 * Times are UTC, like every other time the CLI prints.
 */

/** One ledger record, reduced to what the strip draws. */
export interface ShiftEntry {
  startedAt: string;
  endedAt: string;
  status: IterationRecord["status"];
  merged: boolean;
  tokens: number;
}

export interface ShiftInput {
  iterations: { total: number; success: number; failed: number; idle: number; quota: number };
  /** Plans merged in the window. */
  landed: number;
  timeline: ShiftEntry[];
}

export interface ShiftOptions {
  /** Terminal width in columns; the strip shrinks to fit (default 80). */
  columns?: number;
}

type Mark = "idle" | "ok" | "landed" | "quota" | "failed";
type Tone = "good" | "warn" | "bad" | "calm";

/**
 * Ascending precedence when marks collide in one cell. A landing is a point in
 * time and the next iteration usually starts minutes later, in the same cell —
 * so events outrank states, or the strip would contradict "N plans landed".
 * A failure is an interval that spans several cells and survives losing one.
 */
const MARK_ORDER: readonly Mark[] = ["idle", "ok", "quota", "failed", "landed"];
const LEGEND_ORDER: readonly Mark[] = ["landed", "failed", "quota", "ok", "idle"];

const STYLE: Record<Mark, { glyph: string; label: string; paint: (text: string) => string }> = {
  landed: { glyph: "◆", label: "landed", paint: (text) => pc.bold(pc.green(text)) },
  failed: { glyph: "✗", label: "failed", paint: (text) => pc.red(text) },
  quota: { glyph: "◐", label: "quota", paint: (text) => pc.yellow(text) },
  ok: { glyph: "●", label: "ok", paint: (text) => pc.green(text) },
  idle: { glyph: "○", label: "idle", paint: (text) => pc.dim(text) },
};

const TONE: Record<Tone, (text: string) => string> = {
  good: (text) => pc.green(text),
  warn: (text) => pc.yellow(text),
  bad: (text) => pc.red(text),
  calm: (text) => text,
};

const SPARK = "▁▂▃▄▅▆▇█";
const OFF = "·";
const MIN_CELLS = 10;
const MAX_CELLS = 60;
/** No cell is finer than a minute: short shifts get fewer cells, not stretched ones. */
const MIN_CELL_MS = 60_000;
/** Same label column as the report's stat rows ("iterations" is 10 wide). */
const LABEL_WIDTH = 10;
/** Indent + label column + gap: where the strip starts. */
const GUTTER = 2 + LABEL_WIDTH + 2;
/** Room for the ruler's trailing " UTC", so the line never wraps when the strip fills the row. */
const EDGE_MARGIN = 4;

interface Cell {
  tokens: number;
  mark: Mark | null;
}

interface Strip {
  cells: Cell[];
  startMs: number;
  endMs: number;
  /** Summed iteration time: concurrent lanes count once each, like crew-hours. */
  crewMs: number;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Reduce ledger records to strip entries, oldest start first. Unreadable timestamps are skipped. */
export function toShiftEntries(history: IterationRecord[]): ShiftEntry[] {
  const entries: ShiftEntry[] = [];
  for (const record of history) {
    const start = Date.parse(record.startedAt);
    if (!Number.isFinite(start)) continue;
    const parsedEnd = Date.parse(record.endedAt);
    const end = Number.isFinite(parsedEnd) && parsedEnd >= start ? parsedEnd : start;
    entries.push({
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(end).toISOString(),
      status: record.status,
      merged: record.merged,
      tokens: totalTokens(record.usage),
    });
  }
  return entries.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** The one-line verdict on the night, with the tone the renderer colors it by. */
export function shiftHeadline(input: Pick<ShiftInput, "iterations" | "landed">): {
  tone: Tone;
  text: string;
} {
  const { iterations, landed } = input;
  if (iterations.total === 0) return { tone: "calm", text: "The crew never clocked in." };
  if (landed > 0 && iterations.failed === 0) {
    return {
      tone: "good",
      text: `Clean shift — ${plural(landed, "plan")} landed, nothing broke.`,
    };
  }
  if (landed > 0) {
    return {
      tone: "warn",
      text: `Busy shift — ${plural(landed, "plan")} landed, ${plural(iterations.failed, "failure")} along the way.`,
    };
  }
  if (iterations.failed > 0) {
    return {
      tone: "bad",
      text: `Rough shift — nothing landed, ${plural(iterations.failed, "failure")} to look at.`,
    };
  }
  if (iterations.success > 0) {
    return {
      tone: "calm",
      text: `Steady shift — ${plural(iterations.success, "iteration")} of progress, nothing landed yet.`,
    };
  }
  if (iterations.quota > 0) {
    return { tone: "warn", text: "Stalled shift — the crew hit its quota ceiling." };
  }
  return {
    tone: "calm",
    text: "Quiet shift — nothing queued, so the crew stood by.",
  };
}

function markOf(status: ShiftEntry["status"]): Mark {
  if (status === "failed") return "failed";
  if (status === "quota") return "quota";
  if (status === "idle") return "idle";
  return "ok";
}

function raise(cell: Cell, mark: Mark): void {
  if (cell.mark === null || MARK_ORDER.indexOf(mark) > MARK_ORDER.indexOf(cell.mark)) {
    cell.mark = mark;
  }
}

function layout(timeline: ShiftEntry[], width: number): Strip | null {
  const spans: Array<{ entry: ShiftEntry; from: number; to: number }> = [];
  for (const entry of timeline) {
    const from = Date.parse(entry.startedAt);
    const to = Date.parse(entry.endedAt);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    spans.push({ entry, from, to: Math.max(from, to) });
  }
  if (spans.length === 0) return null;

  const startMs = spans.reduce((min, span) => Math.min(min, span.from), Number.POSITIVE_INFINITY);
  const endMs = spans.reduce((max, span) => Math.max(max, span.to), Number.NEGATIVE_INFINITY);
  const count = Math.min(width, Math.max(1, Math.ceil((endMs - startMs) / MIN_CELL_MS)));
  const cellMs = Math.max(endMs - startMs, 1) / count;
  const cellOf = (ms: number): number =>
    Math.min(count - 1, Math.max(0, Math.floor((ms - startMs) / cellMs)));
  const cells = Array.from({ length: count }, (): Cell => ({ tokens: 0, mark: null }));

  let crewMs = 0;
  for (const { entry, from, to } of spans) {
    const length = to - from;
    crewMs += length;
    // Half-open [from, to): an iteration ending exactly on a cell edge stays in its own cell.
    const first = cellOf(from);
    const last = cellOf(length > 0 ? to - 1 : from);
    const mark = markOf(entry.status);
    for (let index = first; index <= last; index += 1) {
      const cell = cells[index];
      if (!cell) continue;
      raise(cell, mark);
      if (length === 0) {
        cell.tokens += entry.tokens;
      } else {
        // Spread the iteration's tokens over the time it actually ran.
        const cellStart = startMs + index * cellMs;
        const overlap = Math.min(to, cellStart + cellMs) - Math.max(from, cellStart);
        cell.tokens += (entry.tokens * Math.max(0, overlap)) / length;
      }
    }
    // The merge happens when the iteration ends, so the diamond sits in its last cell.
    const landedCell = cells[last];
    if (entry.merged && landedCell) raise(landedCell, "landed");
  }
  return { cells, startMs, endMs, crewMs };
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace("T", " ");
}

/** `start ── 9h 12m crew time ── end`, stretched to the strip's width when it fits. */
function ruler(strip: Strip): string {
  const left = stamp(strip.startMs);
  const right = stamp(strip.endMs);
  const middle = `${formatDuration(strip.crewMs)} crew time`;
  if (left === right) return `${left}  ${middle}`;
  const room = strip.cells.length - left.length - right.length - middle.length - 4;
  if (room < 2) return `${left} → ${right}  ${middle}`;
  const before = Math.floor(room / 2);
  return `${left} ${"─".repeat(before)} ${middle} ${"─".repeat(room - before)} ${right}`;
}

function legend(strip: Strip): string {
  const parts = LEGEND_ORDER.filter((mark) => strip.cells.some((cell) => cell.mark === mark)).map(
    (mark) => `${STYLE[mark].paint(STYLE[mark].glyph)} ${pc.dim(STYLE[mark].label)}`,
  );
  if (strip.cells.some((cell) => cell.mark === null)) parts.push(`${pc.dim(OFF)} ${pc.dim("off")}`);
  return parts.join("  ");
}

/**
 * The report's opening block, as already-indented lines (no surrounding blank
 * lines). Without activity in the window it is the verdict alone.
 */
export function renderShift(input: ShiftInput, options: ShiftOptions = {}): string[] {
  const { tone, text } = shiftHeadline(input);
  const lines = [`  ${pc.bold(TONE[tone](text))}`];
  const columns = Number.isFinite(options.columns) ? Number(options.columns) : 80;
  const width = Math.max(
    MIN_CELLS,
    Math.min(MAX_CELLS, Math.floor(columns - GUTTER - EDGE_MARGIN)),
  );
  const strip = input.iterations.total > 0 ? layout(input.timeline, width) : null;
  if (!strip) return lines;

  const peak = strip.cells.reduce((max, cell) => Math.max(max, cell.tokens), 0);
  const burn = strip.cells.map((cell) => {
    if (!cell.mark) return pc.dim(OFF);
    const level =
      peak > 0 && cell.tokens > 0 ? Math.max(1, Math.ceil((cell.tokens / peak) * 8)) : 1;
    return STYLE[cell.mark].paint(SPARK.charAt(level - 1));
  });
  const marks = strip.cells.map((cell) =>
    cell.mark ? STYLE[cell.mark].paint(STYLE[cell.mark].glyph) : pc.dim(OFF),
  );

  const label = (name: string): string => `  ${pc.dim(name.padEnd(LABEL_WIDTH))}  `;
  const gutter = " ".repeat(GUTTER);
  lines.push("");
  lines.push(`${label("tokens")}${burn.join("")}`);
  lines.push(`${label("shift")}${marks.join("")}`);
  lines.push(`${gutter}${pc.dim(`${ruler(strip)} UTC`)}`);
  lines.push(`${gutter}${legend(strip)}`);
  return lines;
}
