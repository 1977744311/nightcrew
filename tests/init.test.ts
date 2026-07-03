import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_SCHEMA_COMMENT, initProject } from "../src/cli/init";
import { FakeProvider, type FakeScriptEntry } from "../src/providers/fake";
import type { Provider } from "../src/providers/types";
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

function scriptFile(entries: FakeScriptEntry[]): string {
  if (!tempRoot) throw new Error("temp root was not initialized");
  const file = join(tempRoot, "fake-script.json");
  writeFileSync(file, JSON.stringify(entries, null, 2));
  return file;
}

function assistedDraftEntry(): FakeScriptEntry {
  return {
    match: "read-only init-assist pass",
    structuredOutput: {
      baseBranch: "main",
      bootstrap: [{ name: "install", run: "npm ci", timeoutMs: 600000 }],
      verifyProfileSteps: [
        { name: "typecheck", run: "npm run typecheck", timeoutMs: 600000 },
        { name: "test", run: "npm test", timeoutMs: 600000 },
      ],
      crewRules: [
        "Follow the existing TypeScript style.",
        "Cover behavior changes with focused tests.",
        "Keep generated artifacts out of commits.",
      ],
    },
    requireOutputSchema: true,
    expectReadOnly: true,
  };
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

  it("prints an assisted draft before writing confirmed scaffolding", async () => {
    const root = makeGitRepo();
    const provider = new FakeProvider(scriptFile([assistedDraftEntry()]));
    const output: string[] = [];
    const events: string[] = [];

    await initProject(root, {
      name: "demo",
      assist: true,
      provider,
      isTty: true,
      print: (message) => {
        events.push("print");
        expect(existsSync(join(root, ".nightcrew", "config.yaml"))).toBe(false);
        output.push(message);
      },
      confirm: () => {
        events.push("confirm");
        expect(existsSync(join(root, ".nightcrew", "config.yaml"))).toBe(false);
        expect(output.join("\n")).toContain("Assisted init draft");
        return true;
      },
    });

    expect(events).toEqual(["print", "confirm"]);
    const config = readFileSync(join(root, ".nightcrew", "config.yaml"), "utf8");
    expect(config).toContain("baseBranch: main");
    expect(config).toContain("run: npm ci");
    expect(config).toContain("run: npm run typecheck");
    expect(config.startsWith(`${CONFIG_SCHEMA_COMMENT}\n`)).toBe(true);

    const crew = readFileSync(join(root, ".nightcrew", "crew.md"), "utf8");
    expect(crew).toContain("- Follow the existing TypeScript style.");
    expect(crew).toContain("- Cover behavior changes with focused tests.");
    expect(crew).toContain("- Keep generated artifacts out of commits.");
  });

  it("prints the assisted draft without writing in non-TTY usage", async () => {
    const root = makeGitRepo();
    const provider = new FakeProvider(scriptFile([assistedDraftEntry()]));
    const output: string[] = [];

    await initProject(root, {
      name: "demo",
      assist: true,
      provider,
      isTty: false,
      print: (message) => output.push(message),
      confirm: () => {
        throw new Error("non-TTY init assist must not ask for confirmation");
      },
    });

    expect(output.join("\n")).toContain("Assisted init draft");
    expect(output.join("\n")).toContain("Bootstrap");
    expect(existsSync(join(root, ".nightcrew", "config.yaml"))).toBe(false);
    expect(existsSync(join(root, ".nightcrew", "crew.md"))).toBe(false);
  });

  it("does not write the assisted draft when TTY confirmation is declined", async () => {
    const root = makeGitRepo();
    const provider = new FakeProvider(scriptFile([assistedDraftEntry()]));
    const output: string[] = [];

    await initProject(root, {
      name: "demo",
      assist: true,
      provider,
      isTty: true,
      print: (message) => output.push(message),
      confirm: () => false,
    });

    expect(output.join("\n")).toContain("Assisted init draft");
    expect(output.join("\n")).toContain("no files written");
    expect(existsSync(join(root, ".nightcrew", "config.yaml"))).toBe(false);
    expect(existsSync(join(root, ".nightcrew", "crew.md"))).toBe(false);
  });

  it("keeps bare init offline and on the existing template path", async () => {
    const root = makeGitRepo();
    const provider: Provider = {
      name: "must-not-run",
      run: async () => {
        throw new Error("bare init must not call a provider");
      },
    };

    await initProject(root, { name: "demo", provider });

    const config = readFileSync(join(root, ".nightcrew", "config.yaml"), "utf8");
    expect(config).toContain("# baseBranch: main");
    expect(config).toContain("bootstrap: []");
    expect(config).toContain("steps: []");
  });
});
