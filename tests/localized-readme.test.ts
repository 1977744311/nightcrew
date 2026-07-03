import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hanScript = /\p{Script=Han}/u;
const hanAllowedFiles = new Set(["README.zh-CN.md"]);

type PackageJson = {
  files?: string[];
};

type PackFile = {
  path: string;
};

type PackResult = {
  files?: PackFile[];
};

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function isBinary(contents: Buffer): boolean {
  return contents.includes(0);
}

describe("localized README guardrails", () => {
  it("keeps Han script limited to the localized README", () => {
    const offenders = trackedFiles().filter((file) => {
      if (hanAllowedFiles.has(file)) {
        return false;
      }

      const contents = readFileSync(resolve(repoRoot, file));
      return !isBinary(contents) && hanScript.test(contents.toString("utf8"));
    });

    expect(offenders).toEqual([]);
    expect(hanScript.test(readFileSync(resolve(repoRoot, "README.zh-CN.md"), "utf8"))).toBe(true);
  });

  it("ships the localized README in the npm package", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    ) as PackageJson;
    const npmCache = mkdtempSync(join(tmpdir(), "nightcrew-npm-cache-"));
    let pack: PackResult[];

    try {
      const packOutput = execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, npm_config_cache: npmCache },
      });
      pack = JSON.parse(packOutput) as PackResult[];
    } finally {
      rmSync(npmCache, { recursive: true, force: true });
    }

    const packagedFiles = new Set(pack[0]?.files?.map((file) => file.path) ?? []);

    expect(packageJson.files).toContain("README.zh-CN.md");
    expect(packagedFiles).toContain("README.zh-CN.md");
  });
});
