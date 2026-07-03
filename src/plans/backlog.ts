import type { ProjectPaths } from "../core/paths";
import { readTextIfExists, writeTextAtomic } from "../utils/fs";

const BACKLOG_HEADER_RE = /^##\s+BACKLOG\s*$/;
const NEXT_SECTION_RE = /^##\s+\S/;
const BACKLOG_ITEM_RE = /^(\s*)- \[([ xX])\] (.*)$/;

interface BacklogLine {
  index: number;
  checked: boolean;
  text: string;
}

export interface BacklogCheckoffResult {
  changed: boolean;
  note?: string;
}

function splitLines(markdown: string): { lines: string[]; eol: string } {
  return {
    lines: markdown.split(/\r?\n/),
    eol: markdown.includes("\r\n") ? "\r\n" : "\n",
  };
}

function backlogLines(markdown: string): BacklogLine[] {
  const { lines } = splitLines(markdown);
  const items: BacklogLine[] = [];
  let inBacklog = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!inBacklog) {
      inBacklog = BACKLOG_HEADER_RE.test(line);
      continue;
    }
    if (NEXT_SECTION_RE.test(line)) break;

    const match = line.match(BACKLOG_ITEM_RE);
    if (!match) continue;
    const marker = match[2] ?? " ";
    items.push({
      index,
      checked: marker.toLowerCase() === "x",
      text: (match[3] ?? "").trimEnd(),
    });
  }

  return items;
}

export function uncheckedBacklogMatchCount(crewMarkdown: string, backlogText: string): number {
  return backlogLines(crewMarkdown).filter(
    (item) => !item.checked && item.text === backlogText.trim(),
  ).length;
}

export function checkOffBacklogItem(
  paths: ProjectPaths,
  backlogText: string | undefined,
): BacklogCheckoffResult {
  const text = backlogText?.trim();
  if (!text) return { changed: false };

  const raw = readTextIfExists(paths.crewFile);
  if (raw === null) {
    return {
      changed: false,
      note: `BACKLOG checkoff skipped: .nightcrew/crew.md is missing for "${text}"`,
    };
  }

  const matches = backlogLines(raw).filter((item) => !item.checked && item.text === text);
  if (matches.length === 0) {
    return {
      changed: false,
      note: `BACKLOG checkoff skipped: no unchecked match for "${text}"`,
    };
  }
  if (matches.length > 1) {
    return {
      changed: false,
      note: `BACKLOG checkoff skipped: ${matches.length} unchecked matches for "${text}"`,
    };
  }

  const { lines, eol } = splitLines(raw);
  const target = matches[0] as BacklogLine;
  lines[target.index] = (lines[target.index] ?? "").replace(/^(\s*)- \[ \] /, "$1- [x] ");
  writeTextAtomic(paths.crewFile, lines.join(eol));
  return { changed: true, note: `checked off BACKLOG item: "${text}"` };
}
