import { createHash } from "node:crypto";

/**
 * The operator decision inbox, parsed from `.nightcrew/questions.md`.
 *
 * The file stays plain markdown (agents append entries mid-iteration with
 * ordinary file edits), but entries follow a light convention this module
 * can parse, answer, and annotate:
 *
 * ```md
 * - [ ] (2026-07-03T22:10) how should the migration treat empty legacy fields?
 *       - A: backfill defaults silently (recommended)
 *       - B: skip and log => backlog: add skip-and-log handling to the migration
 *       answer: A            <- written when the operator decides
 *       feedback: ...        <- written when no option fits; crew redrafts options
 * ```
 */

export interface QuestionOption {
  label: string;
  /** Display text with `(recommended)` / `=> backlog` markers stripped. */
  text: string;
  recommended: boolean;
  /** True when answering with this option should schedule work. */
  schedules: boolean;
  /** Explicit backlog item text after `=> backlog:`, if the author gave one. */
  backlogText: string | null;
}

export interface QuestionEntry {
  /** Stable content-derived key (sha256 prefix of the question text). */
  key: string;
  checked: boolean;
  /** Question line text after the checkbox (timestamp prefix included). */
  text: string;
  options: QuestionOption[];
  answer: string | null;
  feedback: string | null;
  /** [start, end) line range of the entry block in the source file. */
  lines: [number, number];
}

export interface AnswerQuestionResult {
  markdown: string;
  entry: QuestionEntry;
  /** Ready-to-append `- [ ] ...` BACKLOG line when the chosen option schedules work. */
  scheduledBacklogItem: string | null;
}

export interface QuestionFeedbackResult {
  markdown: string;
  entry: QuestionEntry;
}

const ENTRY_RE = /^- \[( |x|X)\] (.*\S)\s*$/;
const OPTION_RE = /^\s+- ([A-Z])[.:)]\s+(.*\S)\s*$/;
const ANSWER_RE = /^\s+answer:\s*(.*\S)\s*$/;
const FEEDBACK_RE = /^\s+feedback:\s*(.*\S)\s*$/;
const BACKLOG_MARKER_RE = /\s*=>\s*backlog(?::\s*(.*))?\s*$/i;
const RECOMMENDED_RE = /\s*\(recommended\)\s*/i;
const TIMESTAMP_PREFIX_RE = /^\(\d{4}-\d{2}-\d{2}[^)]*\)\s*/;

const DEFAULT_INDENT = "      ";

function parseOption(label: string, raw: string): QuestionOption {
  let text = raw.trim();
  let schedules = false;
  let backlogText: string | null = null;

  const backlogMatch = text.match(BACKLOG_MARKER_RE);
  if (backlogMatch) {
    schedules = true;
    backlogText = backlogMatch[1]?.trim() || null;
    text = text.slice(0, backlogMatch.index ?? text.length).trim();
  }

  const recommended = RECOMMENDED_RE.test(text);
  text = text
    .replace(RECOMMENDED_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { label, text, recommended, schedules, backlogText };
}

function questionKey(text: string, taken: Set<string>): string {
  const base = createHash("sha256").update(text).digest("hex").slice(0, 12);
  let key = base;
  let suffix = 2;
  while (taken.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  taken.add(key);
  return key;
}

export function parseQuestions(markdown: string): QuestionEntry[] {
  const lines = markdown.split("\n");
  const entries: QuestionEntry[] = [];
  const taken = new Set<string>();

  let index = 0;
  while (index < lines.length) {
    const match = lines[index]?.match(ENTRY_RE);
    if (!match) {
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (line.trim() === "" || /^\s/.test(line)) {
        index += 1;
        continue;
      }
      break;
    }

    const text = (match[2] ?? "").trim();
    const options: QuestionOption[] = [];
    let answer: string | null = null;
    let feedback: string | null = null;
    for (let i = start + 1; i < index; i += 1) {
      const line = lines[i] ?? "";
      const option = line.match(OPTION_RE);
      if (option) {
        options.push(parseOption(option[1] ?? "", option[2] ?? ""));
        continue;
      }
      const answerMatch = line.match(ANSWER_RE);
      if (answerMatch) {
        answer = (answerMatch[1] ?? "").trim();
        continue;
      }
      const feedbackMatch = line.match(FEEDBACK_RE);
      if (feedbackMatch) feedback = (feedbackMatch[1] ?? "").trim();
    }

    entries.push({
      key: questionKey(text, taken),
      checked: match[1] !== " ",
      text,
      options,
      answer,
      feedback,
      lines: [start, index],
    });
  }

  return entries;
}

function requireOpenEntry(markdown: string, key: string): QuestionEntry {
  const entry = parseQuestions(markdown).find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`question not found: ${key}`);
  if (entry.checked || entry.answer) throw new Error(`question already answered: ${key}`);
  return entry;
}

function entryIndent(lines: string[], entry: QuestionEntry): string {
  for (let i = entry.lines[0] + 1; i < entry.lines[1]; i += 1) {
    const match = lines[i]?.match(/^(\s+)\S/);
    if (match?.[1]) return match[1];
  }
  return DEFAULT_INDENT;
}

function stripTimestamp(text: string): string {
  return text.replace(TIMESTAMP_PREFIX_RE, "").trim();
}

/**
 * Drop existing `feedback:` lines from the entry block, then append one
 * annotation line after the last non-blank block line. Returns new lines.
 */
function annotateEntry(markdown: string, entry: QuestionEntry, annotation: string): string[] {
  const lines = markdown.split("\n");
  const indent = entryIndent(lines, entry);

  let end = entry.lines[1];
  for (let i = end - 1; i > entry.lines[0]; i -= 1) {
    if (FEEDBACK_RE.test(lines[i] ?? "")) {
      lines.splice(i, 1);
      end -= 1;
    }
  }

  let insertAt = entry.lines[0] + 1;
  for (let i = end - 1; i > entry.lines[0]; i -= 1) {
    if ((lines[i] ?? "").trim() !== "") {
      insertAt = i + 1;
      break;
    }
  }
  lines.splice(insertAt, 0, `${indent}${annotation}`);
  return lines;
}

export function answerQuestion(
  markdown: string,
  input: { key: string; answer: string },
): AnswerQuestionResult {
  const answer = input.answer.replace(/\s+/g, " ").trim();
  if (!answer) throw new Error("answer must not be empty");

  const entry = requireOpenEntry(markdown, input.key);
  const lines = annotateEntry(markdown, entry, `answer: ${answer}`);
  const entryLine = lines[entry.lines[0]] ?? "";
  lines[entry.lines[0]] = entryLine.replace(/^- \[ \]/, "- [x]");

  const chosen = entry.options.find(
    (option) => option.label.toLowerCase() === answer.toLowerCase(),
  );
  const scheduledBacklogItem = chosen?.schedules
    ? `- [ ] ${chosen.backlogText ?? `${stripTimestamp(entry.text)} — ${chosen.text}`}`
    : null;

  return { markdown: lines.join("\n"), entry, scheduledBacklogItem };
}

export function addQuestionFeedback(
  markdown: string,
  input: { key: string; feedback: string },
): QuestionFeedbackResult {
  const feedback = input.feedback.replace(/\s+/g, " ").trim();
  if (!feedback) throw new Error("feedback must not be empty");

  const entry = requireOpenEntry(markdown, input.key);
  const lines = annotateEntry(markdown, entry, `feedback: ${feedback}`);
  return { markdown: lines.join("\n"), entry };
}
