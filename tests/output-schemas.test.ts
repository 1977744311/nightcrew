import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INIT_ASSIST_OUTPUT_SCHEMA } from "../src/cli/init";
import { PROPOSAL_OUTPUT_SCHEMA } from "../src/proposals/generate";
import { FakeProvider } from "../src/providers/fake";
import { structuredOutputSchemaViolations } from "../src/providers/output-schema";
import { VERDICT_SCHEMA } from "../src/review/agent";

/**
 * Every schema handed to a provider as `outputSchema` must satisfy OpenAI
 * structured-output constraints, or the first real call fails with
 * `invalid_json_schema` (as `init --assist` once did in production while every
 * fake-provider test stayed green). New outputSchema constants belong in this
 * table; the FakeProvider also rejects violations at run time.
 */
const OUTPUT_SCHEMAS: Array<[string, unknown]> = [
  ["PROPOSAL_OUTPUT_SCHEMA", PROPOSAL_OUTPUT_SCHEMA],
  ["VERDICT_SCHEMA", VERDICT_SCHEMA],
  ["INIT_ASSIST_OUTPUT_SCHEMA", INIT_ASSIST_OUTPUT_SCHEMA],
];

describe("structured-output schema invariants", () => {
  it.each(OUTPUT_SCHEMAS)("%s satisfies structured-output constraints", (_name, schema) => {
    expect(structuredOutputSchemaViolations(schema)).toEqual([]);
  });

  it("flags an object whose required array misses a property (the init --assist regression)", () => {
    const violations = structuredOutputSchemaViolations({
      type: "object",
      properties: {
        name: { type: "string" },
        run: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["name", "run"],
      additionalProperties: false,
    });
    expect(violations).toEqual([
      '$: required must include every property key; missing "timeoutMs"',
    ]);
  });

  it("flags missing additionalProperties, unknown required keys, and nested nodes", () => {
    const violations = structuredOutputSchemaViolations({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title", "ghost"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
    });
    expect(violations).toEqual([
      "$: object must set additionalProperties: false",
      '$.items[]: required lists unknown property "ghost"',
    ]);
  });

  it("flags an object that omits the required array entirely", () => {
    const violations = structuredOutputSchemaViolations({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    });
    expect(violations).toEqual(["$: object must supply a required array"]);
  });

  it("makes the fake provider reject violating schemas like the real API would", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightcrew-schema-"));
    try {
      const scriptFile = join(dir, "script.json");
      writeFileSync(scriptFile, JSON.stringify([{ finalMessage: "should not matter" }]));
      const provider = new FakeProvider(scriptFile);

      const result = await provider.run({
        prompt: "any",
        workingDirectory: dir,
        sessionId: null,
        timeoutMs: 5_000,
        idleTimeoutMs: 5_000,
        outputSchema: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          required: ["a"],
          additionalProperties: false,
        },
      });

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain("invalid_json_schema");
      expect(result.errorMessage).toContain('missing "b"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
