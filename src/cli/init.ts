import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { stringify } from "yaml";
import { z } from "zod";
import { registerProject } from "../config/registry";
import { type CommandStep, commandStepSchema } from "../config/schema";
import { projectPaths } from "../core/paths";
import { isGitRepo } from "../git/git";
import { CodexProvider } from "../providers/codex";
import type { Provider, ProviderRunResult } from "../providers/types";
import { ensureDir, readTextIfExists } from "../utils/fs";
import { log } from "../utils/log";

export const CONFIG_SCHEMA_URL =
  "https://raw.githubusercontent.com/1977744311/nightcrew/main/schema/config.schema.json";
export const CONFIG_SCHEMA_COMMENT = `# yaml-language-server: $schema=${CONFIG_SCHEMA_URL}`;

const assistedInitDraftSchema = z.strictObject({
  baseBranch: z.string().min(1),
  bootstrap: z.array(commandStepSchema).min(1).max(3),
  verifyProfileSteps: z.array(commandStepSchema).min(1).max(5),
  crewRules: z.array(z.string().min(1)).min(2).max(3),
});
export type AssistedInitDraft = z.infer<typeof assistedInitDraftSchema>;

// OpenAI structured outputs demand `required` to list every property key, so
// timeoutMs is required here and the prompt asks for an explicit value.
const COMMAND_STEP_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    run: { type: "string" },
    timeoutMs: { type: "number" },
  },
  required: ["name", "run", "timeoutMs"],
  additionalProperties: false,
} as const;

export const INIT_ASSIST_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    baseBranch: { type: "string" },
    bootstrap: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: COMMAND_STEP_OUTPUT_SCHEMA,
    },
    verifyProfileSteps: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: COMMAND_STEP_OUTPUT_SCHEMA,
    },
    crewRules: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "string" },
    },
  },
  required: ["baseBranch", "bootstrap", "verifyProfileSteps", "crewRules"],
  additionalProperties: false,
} as const;

export interface InitProjectOptions {
  name?: string;
  assist?: boolean;
  provider?: Provider;
  isTty?: boolean;
  confirm?: (draft: AssistedInitDraft) => boolean | Promise<boolean>;
  print?: (message: string) => void;
}

function configTemplate(name: string, draft?: AssistedInitDraft): string {
  if (draft) {
    return `${CONFIG_SCHEMA_COMMENT}\n${stringify({
      version: 1,
      project: {
        name,
        baseBranch: draft.baseBranch,
      },
      bootstrap: draft.bootstrap,
      verify: {
        profile: "default",
        profiles: {
          default: {
            steps: draft.verifyProfileSteps,
          },
        },
      },
    })}`;
  }

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

# canary:                   # scheduled real-world smoke, run outside the agent sandbox
#   profile: canary         # verify profile to run before loop work; unset disables
#   everyHours: 20          # at most one attempt per window; failures land in qa.md

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

# git:
#   mergeMode: merge        # merge: local merge | pr: push branch and open a GitHub PR

# merge:
#   policy: auto            # auto: land green plans onto base | branch: leave for manual merge

# notify:
#   webhook: https://example.com/nightcrew
#   events: [loop_stopped, open_question, proposal_landed]

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

function normalizeCrewRule(rule: string): string {
  return rule
    .replace(/^\s*[-*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function crewTemplate(draft?: AssistedInitDraft): string {
  if (!draft) return CREW_TEMPLATE;

  const rules = draft.crewRules.map(normalizeCrewRule).filter(Boolean);
  return `# Crew Directives

Operator surface. The crew reads this every iteration; only you edit it.
Keep it small and pointed — long prose rots.

## Rules

${rules.map((rule) => `- ${rule}`).join("\n")}

## BACKLOG

Authorized work, most valuable first. The crew plans ONLY from this list —
an empty backlog means the crew idles instead of inventing work.

- [ ] (example) Describe the first seam you want closed overnight.
`;
}

const QUESTIONS_TEMPLATE = `# Open Questions

Decisions waiting for the operator. The crew appends entries with lettered
options; answer from the console (or edit here), then garden prunes.
`;

const QA_TEMPLATE = `# QA

Defects observed by you or the crew — one \`- \` bullet per defect.
The loop triages new bullets into proposal candidates for your approval.
`;

const IGNORE_ENTRIES = [".nightcrew/runtime/", ".nightcrew/worktrees/"];

function parseJsonObject(text: string): unknown {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim()) as unknown;
    } catch {
      // Keep trying less-clean provider output.
    }
  }
  throw new Error("init assist returned invalid JSON");
}

function parseAssistedInitDraft(result: ProviderRunResult): AssistedInitDraft {
  if (result.status !== "ok") {
    throw new Error(
      `init assist failed (${result.status}): ${result.errorMessage ?? "provider returned no detail"}`,
    );
  }

  const parsed = parseJsonObject(result.finalMessage);
  const draft = assistedInitDraftSchema.parse(parsed);
  const crewRules = draft.crewRules.map(normalizeCrewRule).filter(Boolean);
  if (crewRules.length < 2 || crewRules.length > 3) {
    throw new Error("init assist must return 2-3 non-empty crew rules");
  }
  return {
    ...draft,
    baseBranch: draft.baseBranch.trim(),
    crewRules,
  };
}

function initAssistPrompt(input: { projectName: string }): string {
  return [
    `You are helping initialize nightcrew for the repository "${input.projectName}".`,
    "This is a read-only init-assist pass. Inspect the repository, but do not modify files.",
    "",
    "Draft the first `.nightcrew/config.yaml` and `.nightcrew/crew.md` guidance:",
    "",
    "- Choose `baseBranch`, usually the stable branch the operator should merge into.",
    "- Draft 1-3 `bootstrap` command steps that prepare a fresh worktree for agent work.",
    "- Draft the default verify profile steps that prove changes before landing.",
    "- Draft 2-3 concise initial crew rules that reflect this repository's stack and conventions.",
    "",
    "Prefer deterministic local commands already implied by package managers, lockfiles, scripts, CI, or docs.",
    "Keep commands non-interactive. Every step must carry an explicit timeoutMs; use 600000 unless the step clearly needs more.",
    "If the repository has no clear install command, choose the smallest harmless bootstrap command that validates the checkout.",
    "",
    "Respond with ONLY this JSON object shape:",
    "",
    "```json",
    JSON.stringify({
      baseBranch: "main",
      bootstrap: [{ name: "install", run: "npm ci", timeoutMs: 600000 }],
      verifyProfileSteps: [{ name: "test", run: "npm test", timeoutMs: 600000 }],
      crewRules: [
        "Follow the existing code style and test conventions of this repo.",
        "Keep behavior changes covered by focused tests.",
      ],
    }),
    "```",
  ].join("\n");
}

function defaultInitAssistProvider(): Provider {
  return new CodexProvider({
    sandbox: "read-only",
    networkAccess: false,
    webSearchMode: "cached",
  });
}

async function draftAssistedInit(input: {
  root: string;
  projectName: string;
  provider?: Provider;
}): Promise<AssistedInitDraft> {
  const provider = input.provider ?? defaultInitAssistProvider();
  const result = await provider.run({
    prompt: initAssistPrompt({ projectName: input.projectName }),
    workingDirectory: input.root,
    timeoutMs: 600_000,
    idleTimeoutMs: 120_000,
    readOnly: true,
    outputSchema: INIT_ASSIST_OUTPUT_SCHEMA,
  });
  return parseAssistedInitDraft(result);
}

function renderStep(step: CommandStep): string {
  return `  - ${step.name}: ${step.run} (${step.timeoutMs}ms)`;
}

export function renderAssistedInitDraft(input: {
  projectName: string;
  draft: AssistedInitDraft;
}): string {
  return [
    "Assisted init draft",
    "",
    `Project: ${input.projectName}`,
    `Base branch: ${input.draft.baseBranch}`,
    "",
    "Bootstrap",
    ...input.draft.bootstrap.map(renderStep),
    "",
    "Verify profile: default",
    ...input.draft.verifyProfileSteps.map(renderStep),
    "",
    "Initial crew rules",
    ...input.draft.crewRules.map((rule) => `  - ${rule}`),
  ].join("\n");
}

async function confirmAssistedDraft(): Promise<boolean> {
  const answer = await confirm({
    message: "Write this assisted draft to .nightcrew/?",
    initialValue: false,
  });
  return !isCancel(answer) && answer === true;
}

function writeProjectScaffold(root: string, name: string, draft?: AssistedInitDraft): void {
  const paths = projectPaths(root);
  const created: string[] = [];

  ensureDir(paths.activePlansDir);
  ensureDir(paths.completedPlansDir);
  ensureDir(paths.pausedPlansDir);
  for (const dir of [paths.activePlansDir, paths.completedPlansDir, paths.pausedPlansDir]) {
    const keep = join(dir, ".gitkeep");
    if (!existsSync(keep)) writeFileSync(keep, "");
  }

  const files: Array<[string, string]> = [
    [paths.configFile, configTemplate(name, draft)],
    [paths.crewFile, crewTemplate(draft)],
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

export async function initProject(root: string, options: InitProjectOptions): Promise<void> {
  if (!(await isGitRepo(root))) {
    throw new Error(
      `${root} is not a git repository. nightcrew requires git; run \`git init\` first.`,
    );
  }

  const name = options.name ?? basename(root);

  if (options.assist) {
    const draft = await draftAssistedInit({
      root,
      projectName: name,
      provider: options.provider,
    });
    const print = options.print ?? console.log;
    print(renderAssistedInitDraft({ projectName: name, draft }));

    const isTty = options.isTty ?? process.stdout.isTTY === true;
    if (!isTty) return;

    const approved = await (options.confirm ?? confirmAssistedDraft)(draft);
    if (!approved) {
      print(pc.dim("assist draft discarded; no files written"));
      return;
    }

    writeProjectScaffold(root, name, draft);
    return;
  }

  writeProjectScaffold(root, name);
}
