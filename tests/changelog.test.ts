import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CHANGELOG", () => {
  it("documents Codex web-search support under Unreleased", () => {
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    const unreleased = changelog.split("## 1.2.0")[0] ?? "";

    expect(unreleased).toContain("provider.codex.webSearch");
    expect(unreleased).toContain("webSearchOverrides");
    expect(unreleased).toContain("proposal research prompts");
  });
});
