import { clearLine, cursorTo, moveCursor } from "node:readline";
import pc from "picocolors";
import type { ProposalProgressEvent, ProposalProgressReporter } from "../proposals/generate";
import type { ProposalLens } from "../proposals/proposals";

export type ProposalProgressStream = NodeJS.WritableStream & { isTTY?: boolean };

const LENS_NAMES: Record<ProposalLens, string> = {
  balanced: "balanced",
  minimal_path: "minimal",
  architecture_first: "architecture",
  risk_first: "risk",
};

type TtyStatus =
  | { kind: "pending" }
  | { kind: "running" }
  | { kind: "completed"; elapsedMs: number; candidateCount: number }
  | { kind: "failed"; elapsedMs: number; reason: string };

export interface ProposalProgressRenderOptions {
  isTty?: boolean;
  stream?: ProposalProgressStream;
}

export function formatProposalProgressSeconds(elapsedMs: number): string {
  return (Math.max(0, elapsedMs) / 1000).toFixed(1);
}

function candidateLabel(count: number): string {
  return `${count} candidate${count === 1 ? "" : "s"}`;
}

function shortReason(reason: string): string {
  const compact = reason.replace(/\s+/g, " ").trim();
  return compact.length <= 96 ? compact : `${compact.slice(0, 93)}...`;
}

function plainProgress(event: ProposalProgressEvent): void {
  switch (event.kind) {
    case "start":
      console.log(`proposal pass ${event.lens} started`);
      return;
    case "finish":
      console.log(
        `proposal pass ${event.lens} completed in ${formatProposalProgressSeconds(
          event.elapsedMs,
        )}s (${candidateLabel(event.candidateCount)})`,
      );
      return;
    case "failure":
      console.log(
        `proposal pass ${event.lens} failed in ${formatProposalProgressSeconds(
          event.elapsedMs,
        )}s: ${shortReason(event.reason)}`,
      );
      return;
  }
}

class TtyProposalProgress {
  private renderedLines = 0;
  /** Insertion-ordered: passes register on their first event (all start together). */
  private readonly statuses = new Map<ProposalLens, TtyStatus>();

  constructor(private readonly stream: ProposalProgressStream) {}

  handle(event: ProposalProgressEvent): void {
    this.statuses.set(event.lens, this.statusFor(event));
    this.render();
  }

  private statusFor(event: ProposalProgressEvent): TtyStatus {
    switch (event.kind) {
      case "start":
        return { kind: "running" };
      case "finish":
        return {
          kind: "completed",
          elapsedMs: event.elapsedMs,
          candidateCount: event.candidateCount,
        };
      case "failure":
        return { kind: "failed", elapsedMs: event.elapsedMs, reason: event.reason };
    }
  }

  private render(): void {
    if (this.renderedLines > 0) {
      moveCursor(this.stream, 0, -this.renderedLines);
    }
    for (const lens of this.statuses.keys()) {
      clearLine(this.stream, 0);
      cursorTo(this.stream, 0);
      this.stream.write(`${this.lineFor(lens)}\n`);
    }
    this.renderedLines = this.statuses.size;
  }

  private lineFor(lens: ProposalLens): string {
    const name = LENS_NAMES[lens].padEnd(12);
    const status = this.statuses.get(lens) ?? { kind: "pending" };
    switch (status.kind) {
      case "pending":
        return `proposal ${name} ${pc.dim("pending")}`;
      case "running":
        return `proposal ${name} ${pc.cyan("running")}`;
      case "completed":
        return `proposal ${name} ${pc.green("completed")} ${formatProposalProgressSeconds(
          status.elapsedMs,
        )}s (${candidateLabel(status.candidateCount)})`;
      case "failed":
        return `proposal ${name} ${pc.red("failed")} ${formatProposalProgressSeconds(
          status.elapsedMs,
        )}s: ${shortReason(status.reason)}`;
    }
  }
}

export function createProposalProgressReporter(
  options: ProposalProgressRenderOptions = {},
): ProposalProgressReporter {
  const stream = options.stream ?? process.stdout;
  if (options.isTty ?? stream.isTTY === true) {
    const progress = new TtyProposalProgress(stream);
    return (event) => progress.handle(event);
  }
  return plainProgress;
}
