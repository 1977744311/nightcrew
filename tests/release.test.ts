import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};

type WorkflowJob = {
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
};

type PackageJson = {
  publishConfig?: {
    provenance?: boolean;
  };
};

const secretExpression = (name: string) => ["$", "{{ secrets.", name, " }}"].join("");

describe("release automation contract", () => {
  it("uses changesets to create version PRs and publish with npm provenance", () => {
    const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8")) as Workflow;
    const release = workflow.jobs?.release;
    const steps = release?.steps ?? [];
    const changesets = steps.find((step) => step.uses === "changesets/action@v1");

    expect(release?.permissions).toMatchObject({
      contents: "write",
      "id-token": "write",
      "pull-requests": "write",
    });
    expect(steps).toContainEqual(expect.objectContaining({ run: "npm run check" }));
    expect(changesets?.with?.publish).toBe("npm publish --provenance");
    expect(changesets?.env).toMatchObject({
      GITHUB_TOKEN: secretExpression("GITHUB_TOKEN"),
      NPM_TOKEN: secretExpression("NPM_TOKEN"),
      NODE_AUTH_TOKEN: secretExpression("NPM_TOKEN"),
    });
  });

  it("enables package provenance metadata", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

    expect(packageJson.publishConfig?.provenance).toBe(true);
  });

  it("documents automated release setup and the manual fallback", () => {
    const contributing = readFileSync("CONTRIBUTING.md", "utf8");
    const changelogUnreleased = readFileSync("CHANGELOG.md", "utf8").split("## 1.3.0")[0] ?? "";

    expect(contributing).toContain("NPM_TOKEN");
    expect(contributing).toContain("changesets/action");
    expect(contributing).toContain("npm publish --provenance");
    expect(contributing).toContain("npm version <patch|minor|major>");
    expect(contributing).toContain("git push origin main --follow-tags");
    expect(changelogUnreleased).toContain("npm publish --provenance");
    expect(changelogUnreleased).toContain("publishConfig.provenance");
  });
});
