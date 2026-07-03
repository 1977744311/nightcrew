# Configuration reference

`.nightcrew/config.yaml`, validated by the strict zod schema in
`src/config/schema.ts` (the schema is the source of truth; this page mirrors
it). Unknown keys and type mismatches fail loudly at load time.

Only `project.name` is required. Everything else has a sensible default.

```yaml
version: 1                          # config format version (only 1 exists)

project:
  name: my-app                      # required; registry + console + report label
  baseBranch: main                  # default: the branch checked out at loop start

provider:
  default: codex                    # codex | fake (fake is the test adapter)
  codex:
    tiers:
      light: gpt-5-codex-mini      # model for plan/garden/review (unset = SDK default)
      heavy: gpt-5-codex            # model for execute/repair (unset = SDK default)
    sandbox: workspace-write        # read-only | workspace-write | danger-full-access
    networkAccess: false            # may the agent itself reach the network
  # fake: { script: path/to/script.json }   # deterministic scripted runs (tests)

routing:                            # operation/workflow -> model tier
  plan: light
  execute: heavy
  repair: heavy
  garden: light
  review: light
  propose: light

bootstrap:                          # run once when a plan worktree is created
  - { name: install, run: npm ci, timeoutMs: 600000 }

verify:
  profile: default                  # which profile gates landings
  profiles:
    default:
      steps:                        # exit code 0 = pass; output tail feeds repair
        - { name: test, run: npm test, timeoutMs: 600000 }
        - { name: typecheck, run: npx tsc --noEmit }

loop:
  maxIterations: 20                 # per `nightcrew loop` session
  maxFailureStreak: 3               # consecutive failures -> typed stop
  maxNoCommitStreak: 3              # consecutive commit-less code ops -> stop
  maxControlOnlyStreak: 3           # consecutive .nightcrew/-only iterations -> stop
  gardenEvery: 8                    # force a garden pass every N iterations
  backoffMs: [5000, 30000, 120000]  # failure backoff ladder (indexed by streak)
  iterationTimeoutMs: 3600000       # wall-clock cap per provider run
  idleTimeoutMs: 600000             # abort when no provider events for this long
  maxParallelPlans: 2               # concurrent worktree lanes (parallel: true plans)

review:
  mode: advisory                    # off | advisory (log, don't block) | gate (block)
  planReview: true                  # judge authorization + boundedness at authoring
  mergeReview: true                 # judge intent/scope/honesty on the diff at landing
  maxReviewRounds: 2                # maker<->checker rounds before escalating

budget:
  quotaWindowHours: 5               # quota_exhausted schedules resume on this cadence
  maxTokensPerIteration: 500000     # optional; over-budget iterations get flagged

merge:
  policy: auto                      # auto: merge when green | branch: leave for a PR

protectedPaths:                     # repo-relative; .git is always protected
  - .nightcrew/config.yaml
  - .nightcrew/crew.md

schedule:                           # used by `crew start` (and `--now` to ignore)
  windows: ["23:00-07:00"]          # HH:MM-HH:MM local; wraps midnight; empty = always
  days: [0, 1, 2, 3, 4, 5, 6]       # 0 = Sunday; unset = every day
  idleCooldownMs: 300000            # nap after an idle stop before re-checking BACKLOG
```

## Plan frontmatter

Per-plan overrides live in the plan file itself:

```markdown
---
id: 2026-07-02-dark-mode
title: Add dark mode toggle
created: 2026-07-02
parallel: true        # may run alongside other parallel plans
max_iterations: 6     # optional per-plan budget
---

## Goal
...

## Acceptance
- [ ] verifiable checkbox items — landing requires all checked or COMPLETE signal
```

## Environment variables

| Variable | Effect |
| --- | --- |
| `NIGHTCREW_HOME` | Override `~/.nightcrew` (global registry location) |
| `NIGHTCREW_SMOKE=1` | Enable the real-SDK smoke test in the test suite |
