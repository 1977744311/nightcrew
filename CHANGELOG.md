# Changelog

## Unreleased

- Added `nightcrew init --assist`, an opt-in read-only Codex drafting path that
  prints suggested bootstrap, verify, base-branch, and crew-rule defaults before
  writing anything; non-TTY runs print only the draft.
- Added optional plan frontmatter `backlog` mappings, deterministic plan-review
  validation against unchecked BACKLOG items, and runner-owned post-merge
  BACKLOG checkoff with history notes for missing or ambiguous matches.
- Added a shared provider preflight for `nightcrew doctor`, `nightcrew loop`,
  and `crew start`; Codex projects now verify readable `auth.json` credentials
  with a `codex login` hint, while fake-provider projects report a skip.
- Added `notify.webhook` with optional event filtering for deterministic JSON
  webhook notifications when loops stop, open questions are appended, or pending
  proposals land.
- Added `git.mergeMode: pr` to publish green completed plans as GitHub pull
  requests through `git push` and `gh pr create`, with typed repair handling for
  push or PR creation failures and conditional `nightcrew doctor` checks for
  the GitHub CLI.

## 1.4.0

The polish release: propose runs three concurrent research passes with live
per-lens progress, a preview-pane picker, and language mirroring; config gets
editor autocomplete; releases get automation + provenance. Seven plans, one
unattended run (including one mid-iteration crash recovery), built by
nightcrew on itself.

- Added `README.zh-CN.md` as the maintained Simplified Chinese README and
  included it in the npm package file whitelist.
- Added a source-bound launch write-up draft at `docs/launch.md` covering
  unattended-loop failure modes, nightcrew's guard/review/worktree answers, and
  the 1.1-1.3 dogfood story.
- Added release automation with the official changesets action, npm provenance
  publishing through `npm publish --provenance`, `publishConfig.provenance`,
  and contributor documentation for the `NPM_TOKEN` setup and manual fallback.
- Added a generated JSON Schema for `.nightcrew/config.yaml`, an `npm run schema`
  sync path, and a `nightcrew init` YAML language-server comment pointing
  editors at the committed schema.
- Proposal generation and refinement prompts now ask candidate titles, bodies,
  and rationales to mirror the operator goal or feedback language while keeping
  BACKLOG checkbox formatting intact.
- `nightcrew propose` now runs the minimal, architecture, and risk proposal
  passes concurrently while keeping candidate numbering stable in lens order;
  TTY runs show live per-lens status lines, and non-TTY runs print plain
  start, completion, and failure lines.
- TTY proposal approval now uses an inline preview picker that shows the
  highlighted candidate's full body, source lens, and rationale without
  pre-printing the full candidate list.

## 1.3.0

The research release: proposals you can actually read, refine, and source.
Four plans, one unattended run, built by nightcrew on itself.

- Added Codex web-search controls: `provider.codex.webSearch` defaults to
  `cached`, `provider.codex.webSearchOverrides` can override operations such as
  `propose`, and the Codex adapter passes the resolved mode to SDK
  `ThreadOptions.webSearchMode`; proposal research prompts now ask
  external-ecosystem goals to search first and cite sources in rationales.
- Added `nightcrew propose refine [<id-or-file>] --feedback <text>` plus TTY
  zero-selection feedback refinement, preserving source lineage and archiving
  superseded proposal artifacts.
- TTY proposal review now prints each candidate's id, title, source lens, and
  full backlog body before opening the checkbox picker while preserving the
  existing non-TTY proposal output.
- Added shared per-plan history accounting and surfaced those metrics in the
  console project detail JSON and page while keeping `nightcrew report`
  summary behavior stable.

## 1.2.0

The propose release: goal in, ratified backlog out. All three features below
were built by nightcrew on itself (3 plans, 8 iterations, one unattended run).

- `nightcrew propose "<goal>"`: run three read-only structured Codex-provider
  proposal passes, persist one stable JSON artifact under `.nightcrew/proposals/`,
  list pending proposals, and select item ids into `crew.md` BACKLOG before
  archiving the artifact. Adds `routing.propose` (`light` by default).
- Proposal review now opens a Clack checkbox picker on TTY output after
  generation and through `nightcrew propose review [--latest|<file>]`, reusing
  the same append-to-`crew.md` and archive path as `propose select`; non-TTY
  runs print numbered items with a `propose select --ids` hint.
- Console project detail now lists pending proposal items and, when console
  actions are enabled, approves selected ids through the same append/archive
  path used by `nightcrew propose select`.

## 1.1.0

The dogfood release: every feature below was planned, implemented, verified,
reviewed, and landed by nightcrew running unattended on its own repository
(9 iterations, 4 plans, ~8.9M tokens, zero human-written product code).

- `nightcrew doctor`: preflight table for Node, git/repo detection, config
  validity, base branch, bootstrap/verify command strings, registry
  registration, and daemon lock state; exits non-zero when any check fails.
- `nightcrew plan add <title>`: create schema-valid active plan scaffolds from
  the CLI with date-prefixed slug ids, duplicate-id rejection, and printed
  created paths.
- `crew report`: aggregate `nightcrew report` data across every registered
  project with per-project landed/failed/tokens rows, grand totals, `--hours`,
  `--json`, and partial failure reporting for unreadable project reports.
- `nightcrew report`: add a per-plan breakdown with iterations, token totals,
  and landed/pending status in both text output and `--json`, while preserving
  the existing top-level summary.
- Plan op now receives an index of active and completed plans, so a multi-item
  BACKLOG is consumed item by item instead of replanning covered work.
- Garden no longer edits `crew.md` (it is operator-owned and protected by
  default); it reports done-looking BACKLOG items in its final message instead.

## 1.0.0

Phase 4 — Operator experience; API freeze.

- `nightcrew report`: the morning digest — iterations by outcome, plans
  landed (with titles and commit counts), token totals, failure breakdown,
  review escalations, open questions from `questions.md`, the active queue,
  and anything needing attention (paused / stopped / quota / pending
  repairs). `--hours` window, `--json` for machines.
- Docs for 1.0: README rewritten around the 90-second pitch; `docs/concepts.md`
  (design constitution, loop-engineering vocabulary map, operation model,
  promotion pipeline, guards); `docs/configuration.md` (full annotated config
  reference mirroring the zod schema); CONTRIBUTING; issue templates.
- Library surface completed and frozen: scheduler (`runProjectScheduler`,
  `runCrewDaemon`, `inWindow`), locks, and report join the exports.
- **API freeze under semver**: the `operation` model (plan / execute /
  verify / repair / garden), config schema, CLI surface, control-file
  layout (`.nightcrew/`), and library exports are stable from this release.
  Codex-only at 1.0 is a feature, not a gap: one deeply polished executor
  behind a provider interface built for more.

## 0.3.0

Phase 3 — The crew: multi-project daemon, parallel plans, schedule windows.

- `crew start`: one daemon drives every registered project concurrently, one
  scheduler per project; `--projects` filters, `--now` ignores windows,
  `--console` serves the web console with actions enabled.
- Parallel plans: plans marked `parallel: true` run in concurrent worktree
  lanes (bounded by `loop.maxParallelPlans`); serial plans queue; control
  ops (plan/garden) require exclusive occupancy. Per-plan repair state
  (`pendingRepairs` map) and defensive state merging keep concurrent lanes
  from clobbering each other's sessions, repairs, or the serial cursor.
- Schedule windows: `schedule.windows` (`"23:00-07:00"` wraps midnight and
  belongs to its start day) and `schedule.days`; outside the window the
  scheduler waits instead of running; `schedule.idleCooldownMs` naps after
  an idle stop before re-consulting the BACKLOG.
- Cross-process project lock (`runtime/daemon.lock`, stale-pid reclaim) plus
  in-process holder registry: `run`, `loop`, and the daemon refuse to
  double-drive a project.
- Main-checkout mutations (control commits, plan-file pre-commits, merges)
  are serialized through a per-repo mutex so parallel landings never race.
- Console v1: pause / resume / gc actions (POST API + header buttons), only
  when actions are explicitly enabled; `crew status` one-liner per project;
  `crew pause <name>` / `crew resume <name>`.
- Fixed a scheduler event-loop starvation bug where a settled lane promise
  turned the main loop into a microtask spin that never yielded to the event
  loop — child processes were never reaped and every in-flight git call hung.

## 0.2.0

Phase 2 — The loop, the guards, the review agent, the read-only console.

- `nightcrew loop`: durable loop with pause/resume, failure backoff, and
  automatic operation downgrade to `repair`.
- Full guard suite under worktree semantics: `loop.maxFailureStreak`,
  `loop.maxNoCommitStreak`, `loop.maxControlOnlyStreak` (interleaved plan/garden
  passes do NOT reset code-op streaks), idle detection, forced garden every N
  iterations.
- Budget ledger: per-iteration token usage in `history.jsonl`;
  `quota_exhausted` is typed scheduling (not failure) with window-aware
  auto-resume.
- Review agent ships: independent plan review + merge review on a fresh
  session and light model tier; `off`/`advisory`/`gate` modes;
  `request_changes` notes feed the next repair; `review.maxReviewRounds` caps
  maker↔checker ping-pong, then escalates to the operator; unparseable
  verdicts retry once, then escalate.
- Console v0 (read-only): project board, plan list, iteration history, token
  curve, live SSE event feed. Single dependency-free page served by
  `nightcrew console`.
- `nightcrew pause` / `resume` / `gc` commands.
- Real-SDK smoke test behind `NIGHTCREW_SMOKE=1` (verified against a live
  Codex subscription); 31 synthetic tests including a 20+-iteration
  unattended stress night.

## 0.1.0

Phase 1 — Single-project one-shot vertical slice.

- `nightcrew init`: scaffolds `.nightcrew/` (config, crew.md, plans dirs,
  questions/qa), patches `.gitignore`, registers the project globally.
- Provider seam with two adapters: **Codex SDK** (subscription auth, streamed
  typed events, overall + idle watchdogs, quota detection) and a scripted
  **fake** adapter for deterministic tests.
- Worktree-first execution: one branch + worktree per plan, bootstrap steps,
  session resume within a plan, scoped auto-commit at iteration end.
- Write-scope guard: control ops may only touch `.nightcrew/`; protected paths
  (`config.yaml`, `crew.md`, `.git`) are reverted on violation, everywhere.
- Deterministic verify profiles; failures downgrade the next iteration to
  `repair` with the failing step output embedded in the prompt.
- Promotion pipeline with a live review seam (NullReviewer until Phase 2):
  verify → review → merge-back (`auto`/`branch` policies), plan lifecycle
  active → completed, worktree/branch cleanup, typed `merge_conflict` repair.
- CLI: `run` (one iteration, auto-resolved operation), `status`, `plan
  list/show`.
- Synthetic e2e suite on temp git repos: green path, session continuity,
  verify→repair, idle/overall timeouts, merge-conflict repair, idle BACKLOG,
  control-scope violations, protected-path enforcement.

## 0.0.2

Phase 0 — Foundations.

- TypeScript strict + ESM scaffolding on Node >= 22.
- Tooling: biome (lint + format), vitest, tsup, changesets.
- GitHub Actions CI matrix (ubuntu + macos): typecheck, lint, test, build.
- Zod schema for `.nightcrew/config.yaml` (strict; unknown keys fail loudly).
- Core domain types: operations, typed failures, runtime state, history records.
- CLI skeleton with `nightcrew` and `crew` bins.

## 0.0.1

- Name reservation and project home.
