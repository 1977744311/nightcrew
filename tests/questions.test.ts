import { describe, expect, it } from "vitest";
import { addQuestionFeedback, answerQuestion, parseQuestions } from "../src/questions/questions";

const OPTIONED = [
  "# Open Questions",
  "",
  "- [ ] (2026-07-03T22:10) how should the migration treat empty legacy fields?",
  "      - A: backfill defaults silently (recommended)",
  "      - B: skip and log => backlog: add skip-and-log handling to the migration",
  "      - C: abort and require manual cleanup => backlog",
  "",
  "- [ ] plan review escalated for 2026-07-02-auth: scope unclear",
  "",
  "- [x] (2026-07-01T03:00) keep the old CLI alias?",
  "      answer: no",
  "",
].join("\n");

describe("questions.md parsing", () => {
  it("parses entries with lettered options, markers, and annotations", () => {
    const entries = parseQuestions(OPTIONED);
    expect(entries).toHaveLength(3);

    const [first, second, third] = entries;
    expect(first?.checked).toBe(false);
    expect(first?.text).toBe(
      "(2026-07-03T22:10) how should the migration treat empty legacy fields?",
    );
    expect(first?.options).toEqual([
      {
        label: "A",
        text: "backfill defaults silently",
        recommended: true,
        schedules: false,
        backlogText: null,
      },
      {
        label: "B",
        text: "skip and log",
        recommended: false,
        schedules: true,
        backlogText: "add skip-and-log handling to the migration",
      },
      {
        label: "C",
        text: "abort and require manual cleanup",
        recommended: false,
        schedules: true,
        backlogText: null,
      },
    ]);
    expect(first?.answer).toBeNull();
    expect(first?.feedback).toBeNull();

    // System-written escalations have no options yet.
    expect(second?.options).toEqual([]);
    expect(second?.checked).toBe(false);

    expect(third?.checked).toBe(true);
    expect(third?.answer).toBe("no");
  });

  it("derives stable unique keys from question text", () => {
    const twice = ["- [ ] same question", "- [ ] same question", ""].join("\n");
    const keys = parseQuestions(twice).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(2);
    expect(parseQuestions(twice).map((entry) => entry.key)).toEqual(keys);
  });

  it("reads feedback lines left by the operator", () => {
    const markdown = [
      "- [ ] (2026-07-03) pick a cache strategy",
      "      - A: in-memory",
      "      feedback: none of these — consider redis",
      "",
    ].join("\n");
    const [entry] = parseQuestions(markdown);
    expect(entry?.feedback).toBe("none of these — consider redis");
  });
});

describe("answerQuestion", () => {
  it("checks the entry, records the answer, and keeps the rest of the file intact", () => {
    const [entry] = parseQuestions(OPTIONED);
    const result = answerQuestion(OPTIONED, { key: entry?.key ?? "", answer: "A" });

    expect(result.scheduledBacklogItem).toBeNull();
    expect(result.markdown).toContain(
      "- [x] (2026-07-03T22:10) how should the migration treat empty legacy fields?",
    );
    expect(result.markdown).toContain("      answer: A");
    expect(result.markdown).toContain("- [ ] plan review escalated");
    expect(result.markdown).toContain("- [x] (2026-07-01T03:00) keep the old CLI alias?");

    const reparsed = parseQuestions(result.markdown);
    expect(reparsed[0]?.checked).toBe(true);
    expect(reparsed[0]?.answer).toBe("A");
  });

  it("returns the explicit backlog text when the chosen option schedules work", () => {
    const [entry] = parseQuestions(OPTIONED);
    const result = answerQuestion(OPTIONED, { key: entry?.key ?? "", answer: "B" });
    expect(result.scheduledBacklogItem).toBe("- [ ] add skip-and-log handling to the migration");
  });

  it("synthesizes a backlog line from question and option when the marker has no text", () => {
    const [entry] = parseQuestions(OPTIONED);
    const result = answerQuestion(OPTIONED, { key: entry?.key ?? "", answer: "c" });
    expect(result.scheduledBacklogItem).toBe(
      "- [ ] how should the migration treat empty legacy fields? — abort and require manual cleanup",
    );
  });

  it("drops a resolved feedback line when answering", () => {
    const markdown = [
      "- [ ] (2026-07-03) pick a cache strategy",
      "      - A: in-memory",
      "      feedback: stale objection",
      "",
    ].join("\n");
    const [entry] = parseQuestions(markdown);
    const result = answerQuestion(markdown, { key: entry?.key ?? "", answer: "A" });
    expect(result.markdown).not.toContain("feedback:");
    expect(result.markdown).toContain("answer: A");
  });

  it("rejects unknown keys, answered entries, and empty answers", () => {
    expect(() => answerQuestion(OPTIONED, { key: "nope", answer: "A" })).toThrow(
      /question not found/,
    );
    const answered = parseQuestions(OPTIONED)[2];
    expect(() => answerQuestion(OPTIONED, { key: answered?.key ?? "", answer: "A" })).toThrow(
      /already answered/,
    );
    const open = parseQuestions(OPTIONED)[0];
    expect(() => answerQuestion(OPTIONED, { key: open?.key ?? "", answer: "  " })).toThrow(
      /answer must not be empty/,
    );
  });
});

describe("addQuestionFeedback", () => {
  it("appends a feedback line the crew regenerates options from", () => {
    const entries = parseQuestions(OPTIONED);
    const result = addQuestionFeedback(OPTIONED, {
      key: entries[1]?.key ?? "",
      feedback: "split auth scope\ninto two plans",
    });
    expect(result.markdown).toContain(
      "- [ ] plan review escalated for 2026-07-02-auth: scope unclear",
    );
    expect(result.markdown).toContain("      feedback: split auth scope into two plans");
    const reparsed = parseQuestions(result.markdown);
    expect(reparsed[1]?.feedback).toBe("split auth scope into two plans");
    expect(reparsed[1]?.checked).toBe(false);
  });

  it("replaces earlier feedback instead of stacking lines", () => {
    const markdown = [
      "- [ ] (2026-07-03) pick a cache strategy",
      "      - A: in-memory",
      "      feedback: first thought",
      "",
    ].join("\n");
    const [entry] = parseQuestions(markdown);
    const result = addQuestionFeedback(markdown, {
      key: entry?.key ?? "",
      feedback: "second thought",
    });
    expect(result.markdown).not.toContain("first thought");
    expect(result.markdown.match(/feedback:/g)).toHaveLength(1);
    expect(parseQuestions(result.markdown)[0]?.feedback).toBe("second thought");
  });
});
