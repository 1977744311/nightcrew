import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_SCHEMA_COMMENT, initProject } from "../src/cli/init";
import { gitSync } from "./helpers";

let tempRoot: string | undefined;
const originalNightcrewHome = process.env.NIGHTCREW_HOME;

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
  if (originalNightcrewHome === undefined) {
    delete process.env.NIGHTCREW_HOME;
  } else {
    process.env.NIGHTCREW_HOME = originalNightcrewHome;
  }
});

function makeGitRepo(): string {
  tempRoot = mkdtempSync(join(tmpdir(), "nightcrew-init-"));
  const root = join(tempRoot, "repo");
  mkdirSync(root);
  process.env.NIGHTCREW_HOME = join(tempRoot, "home");
  gitSync(root, "init", "-b", "main");
  writeFileSync(join(root, "README.md"), "# demo\n");
  gitSync(root, "add", "README.md");
  gitSync(root, "commit", "-m", "initial product commit");
  return root;
}

describe("nightcrew init", () => {
  it("scaffolds config.yaml with a raw GitHub JSON Schema comment first", async () => {
    const root = makeGitRepo();

    await initProject(root, { name: "demo" });

    const config = readFileSync(join(root, ".nightcrew", "config.yaml"), "utf8");
    expect(CONFIG_SCHEMA_COMMENT).toBe(
      "# yaml-language-server: $schema=https://raw.githubusercontent.com/1977744311/nightcrew/main/schema/config.schema.json",
    );
    expect(config.startsWith(`${CONFIG_SCHEMA_COMMENT}\n`)).toBe(true);
  });
});
