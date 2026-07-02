import type { ProjectPaths } from "../core/paths";
import type { IterationRecord } from "../core/types";
import { appendLine, readTextIfExists } from "../utils/fs";

export function appendHistory(paths: ProjectPaths, record: IterationRecord): void {
  appendLine(paths.historyFile, JSON.stringify(record));
}

export function readHistory(paths: ProjectPaths, limit?: number): IterationRecord[] {
  const raw = readTextIfExists(paths.historyFile);
  if (raw === null) return [];
  const records: IterationRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as IterationRecord);
    } catch {
      // skip torn/corrupt lines; the ledger is append-only and best-effort
    }
  }
  return limit ? records.slice(-limit) : records;
}
