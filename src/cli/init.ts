import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { registerProject } from "../config/registry";
import { projectPaths } from "../core/paths";
import { isGitRepo } from "../git/git";
import { ensureDir, readTextIfExists } from "../utils/fs";
import { log } from "../utils/log";

export const CONFIG_SCHEMA_URL =
  "https://raw.githubusercontent.com/1977744311/nightcrew/main/schema/config.schema.json";
export const CONFIG_SCHEMA_COMMENT = `# yaml-language-server: $schema=${CONFIG_SCHEMA_URL}`;

function configTemplate(name: string): string {
  return `${CONFIG_SCHEMA_COMMENT}
version: 1

project:
  name: ${name}
  # baseBranch: main        # defaults to the branch checked out when the loop starts

# provider:
#   default: codex          # codex (default) | fake (tests)
#   codex:
#     sandbox: workspace-write
#     networkAccess: false
#     webSearch: cached       # disabled | cached | live
#     webSearchOverrides:
#       propose: live
#     tiers:
#       light: gpt-5.1-codex-mini   # plan / garden / review
#       heavy: gpt-5.1-codex        # execute / repair

# Run once when a plan worktree is created.
bootstrap: []
#  - name: install
#    run: npm ci
#    timeoutMs: 600000

verify:
  profile: default
  profiles:
    default:
      steps: []
      #  - name: test
      #    run: npm test
      #    timeoutMs: 600000

# loop:
#   maxIterations: 20
#   maxFailureStreak: 3
#   maxNoCommitStreak: 3
#   maxControlOnlyStreak: 3
#   gardenEvery: 8
#   iterationTimeoutMs: 3600000
#   idleTimeoutMs: 600000

# review:
#   mode: advisory          # off | advisory | gate
#   maxReviewRounds: 2

# merge:
#   policy: auto            # auto: land green plans onto base | branch: leave for manual merge

# schedule:
#   windows: ["23:00-07:00"]  # crew daemon runs only inside these local-time windows
`;
}

const CREW_TEMPLATE = `# Crew Directives

Operator surface. The crew reads this every iteration; only you edit it.
Keep it small and pointed — long prose rots.

## Rules

- Follow the existing code style and test conventions of this repo.
- Never commit secrets, credentials, or generated junk.

## BACKLOG

Authorized work, most valuable first. The crew plans ONLY from this list —
an empty backlog means the crew idles instead of inventing work.

- [ ] (example) Describe the first seam you want closed overnight.
`;

const QUESTIONS_TEMPLATE = `# Open Questions

Decisions waiting for the operator. The crew appends entries with lettered
options; answer from the console (or edit here), then garden prunes.
`;

const QA_TEMPLATE = `# QA

Defects observed by you or the crew — one \`- \` bullet per defect.
The loop triages new bullets into proposal candidates for your approval.
`;

const IGNORE_ENTRIES = [".nightcrew/runtime/", ".nightcrew/worktrees/"];

export async function initProject(root: string, options: { name?: string }): Promise<void> {
  if (!(await isGitRepo(root))) {
    throw new Error(
      `${root} is not a git repository. nightcrew requires git; run \`git init\` first.`,
    );
  }

  const paths = projectPaths(root);
  const name = options.name ?? basename(root);
  const created: string[] = [];

  ensureDir(paths.activePlansDir);
  ensureDir(paths.completedPlansDir);
  ensureDir(paths.pausedPlansDir);
  for (const dir of [paths.activePlansDir, paths.completedPlansDir, paths.pausedPlansDir]) {
    const keep = join(dir, ".gitkeep");
    if (!existsSync(keep)) writeFileSync(keep, "");
  }

  const files: Array<[string, string]> = [
    [paths.configFile, configTemplate(name)],
    [paths.crewFile, CREW_TEMPLATE],
    [paths.questionsFile, QUESTIONS_TEMPLATE],
    [paths.qaFile, QA_TEMPLATE],
  ];
  for (const [file, contents] of files) {
    if (existsSync(file)) continue;
    writeFileSync(file, contents, "utf8");
    created.push(file);
  }

  const gitignore = join(root, ".gitignore");
  const existing = readTextIfExists(gitignore) ?? "";
  const missing = IGNORE_ENTRIES.filter((entry) => !existing.split("\n").includes(entry));
  if (missing.length > 0) {
    const next = `${existing.replace(/\n*$/, existing ? "\n" : "")}${missing.join("\n")}\n`;
    writeFileSync(gitignore, next, "utf8");
    created.push(gitignore);
  }

  registerProject(name, root);

  if (created.length > 0) {
    log.info(`initialized .nightcrew/ for "${name}" (${created.length} files)`);
  } else {
    log.info(`.nightcrew/ already present for "${name}"; registered in global registry`);
  }
  log.info("next: edit .nightcrew/crew.md BACKLOG, then `nightcrew run`");
}
