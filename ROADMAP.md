# nightcrew Roadmap

> Your coding agents on the night shift.

nightcrew is a loop-engineering control plane for unattended agent work. It
owns the **outer loop** — durable plan pipelines, deterministic verify gates,
independent review, economic guards, and multi-project scheduling — and
delegates the **inner loop** (a single agent iteration) entirely to official
agent SDKs, running on your existing subscriptions.

This document is the north star for the first public release. It encodes the
lessons of a battle-tested private prototype that drove 700+ unattended
iterations (191 completed plans) across three provider CLIs. The prototype is
used as experience, not as code: nightcrew is a clean-room design.

## Design Constitution

Every decision below serves these principles. When in doubt, come back here.

1. **State lives in the repo, not in the conversation.** Everything is
   inspectable as files; git is the audit log. Runtime state is disposable.
2. **The agent is an untrusted worker.** Acceptance is issued outside the
   agent: deterministic gates judge mechanical correctness ("does it run?"),
   an independent review agent judges intent compliance ("should it merge?").
   The agent that did the work never grades its own homework.
3. **Every iteration either lands verified progress or records a typed
   failure.** No silent spinning. Economic guards are first-class citizens,
   not patches.
4. **Human involvement is asynchronous, never blocking.** Directives flow in
   (`crew.md`), questions flow out (`questions.md`). The loop continues.
5. **Provider-neutral, subscriptions are the budget.** Only typed SDK
   interfaces; never parse CLI text output.
6. **Zero-ceremony adoption.** `nightcrew init` in any repo, one config file,
   defaults encode best practice.

## Architecture

### Directory contract

```text
any-product-repo/
  .nightcrew/
    config.yaml        # provider routing, verify, loop policy, budget, review
    crew.md            # operator directive surface (rules + BACKLOG)
    plans/
      active/          # selected work, one file per plan
      completed/
      paused/
    questions.md       # decisions waiting for the operator
    qa.md              # defect log
    runtime/           # gitignored: state, history ledger, sessions, logs
    worktrees/         # gitignored: per-plan git worktrees

~/.nightcrew/
  registry.yaml        # project discovery for the crew daemon and console
```

Single git scope is the foundation: control surfaces (everything in
`.nightcrew/` except `runtime/` and `worktrees/`) are committed to the product
repo, so plan progression and code changes share one git timeline.

### Module map

| Module | Responsibility |
| --- | --- |
| `core/` | domain types, operation resolution, lifecycle state machine |
| `plans/` | plan file lifecycle, frontmatter parsing, selection rules |
| `providers/` | `Provider` interface; `codex` adapter (v1) + `fake` adapter (tests) |
| `policy/` | guards: streaks, budget, garden scheduling, stop conditions |
| `review/` | review agent: plan review + merge review, verdict parsing |
| `verify/` | deterministic verify profiles |
| `git/` | worktree lifecycle, snapshots, write-scope guard, merge-back |
| `loop/` | one-shot runner + loop orchestration |
| `scheduler/` | crew daemon, cron automations, quota-window scheduling |
| `cli/` | `nightcrew` / `crew` commands |
| `console/` | local web UI: JSON/SSE API + static frontend |

### Operations model

Five operations, one public run-intent field (proven in the prototype):

| Operation | Purpose |
| --- | --- |
| `plan` | author exactly one bounded plan from the BACKLOG (empty BACKLOG → empty output, never self-invent) |
| `execute` | implement the active plan inside its worktree |
| `verify` | run deterministic gates only, no provider |
| `repair` | bounded fix of a failed/incomplete slice, resumes the plan session |
| `garden` | control-surface hygiene: prune pointers, reconcile questions/qa/plans |

Auto-resolution: active plan → `execute`; none → `plan`; dirty worktree
pending → `repair` first; every N iterations → forced `garden`.

## Key Mechanisms

### Worktree-first execution

Worktree lifecycle is bound to the **plan**, not the iteration:

```text
plan selected  → git worktree add -b nightcrew/<plan-id> .nightcrew/worktrees/<plan-id>
               → bootstrap steps (e.g. pnpm install; cheap via shared store)
each iteration → reuses the same worktree and the same SDK session (resume)
verify + review green → merge back per policy → worktree removed
```

- Merge policy: `auto` (merge when gates are green; default) | `branch`
  (leave the branch for manual merge). A `pr` mode may follow post-1.0.
- Base branch moved overnight → typed failure `merge_conflict` → repair or
  blocked for the operator.
- Failed iterations either keep the worktree for `repair` (session intact) or
  discard it per policy. The operator's main checkout is never dirtied — the
  prototype's hairiest subsystem (cross-repo dirty-recovery fingerprints)
  disappears entirely.
- Parallel plans within one project are a scheduling problem only (Phase 3);
  the execution model already isolates them.

### Sessions

One SDK thread per plan. Iterations within a plan resume the thread (cheaper,
better repairs); a new plan, a garden pass, or an operator-initiated repair
starts fresh. Session ids live in runtime state.

### Review agent (independent, three modes)

Two review points, embedded in the promotion pipeline:

```text
execute (commits on worktree branch)
  → deterministic verify (tests/lint/typecheck/contract gates)   fail → repair
  → review agent (fresh session, light model tier)               fail → repair with notes
  → merge back to base
```

1. **Plan review** — before a new plan enters `active/`: is it inside the
   BACKLOG's authorization, is it one bounded seam? Automates the judgment
   that previously required manual operator reverts.
2. **Merge review** — before merge-back: does the diff implement the plan's
   stated intent, within scope, honestly (no fabricated data, no hollowed-out
   tests)?

Rules:

- Reviewer input is the plan file, the diff, the verify summary, and
  `crew.md` rules — never the maker's reasoning or self-summary.
- Structured verdict: `approve | approve_with_notes | request_changes |
  escalate`. `request_changes` feeds notes into the next repair;
  `escalate` blocks for the operator.
- `max_review_rounds` (default 2) caps maker↔checker ping-pong: anti-spin
  applies to review loops too.
- Modes: `off | advisory | gate`. Advisory logs notes into the report without
  blocking; gate blocks the merge. Ship advisory by default, promote to gate
  once dogfood data supports it.
- v1 is same-provider review (fresh context already removes most
  self-leniency); cross-vendor review (e.g. Codex writes, Claude reviews)
  arrives with post-1.0 adapters.

### Budget ledger and quota awareness

- Per-iteration token/cost usage is captured from SDK usage events into the
  history ledger.
- Hitting a subscription limit is **not a failure**: it is typed
  `quota_exhausted`, does not burn the failure streak, and schedules an
  automatic resume aligned to the provider's quota window (rolling 5-hour /
  weekly / monthly).
- Per-operation model-tier routing: `plan`/`garden`/review run on a light
  tier, `execute`/`repair` on a heavy tier.

### Guards (the moat)

All ported from prototype experience, simplified by single-repo + worktree
semantics:

- `max_failure_streak` — consecutive failed/triage iterations halt the loop
  even with continue-on-error.
- `max_no_commit_streak` — "successful" execute/repair iterations that land
  no commits on the worktree branch. Interleaved plan/garden iterations do
  **not** reset the counter.
- `max_control_only_streak` — commits that only touch `.nightcrew/` paths:
  the agent is updating its own paperwork instead of the product.
- Idle detection — no active plan after a clean plan pass → idle stop, not a
  retry storm.
- Forced garden — every N iterations, hygiene runs before drift compounds.
- `max_review_rounds` — see above.

## Requirements distilled from 700+ real iterations

| Prototype pain | Hard requirement in nightcrew |
| --- | --- |
| Provider buffered output → idle watchdog false-kills | heartbeat driven by typed SDK events, never byte-counting |
| Consecutive "green" runs with zero commits burned quota | no-commit streak breaker; interleaved ops don't reset it |
| Agent only updates its own paperwork | control-only commit streak breaker |
| Failure left a dirty tree → permanent skip loop | worktree disposal/resume policy; main checkout never dirty |
| Plan mode asked "what should I do?" and spun | provider input ends with a mandatory imperative per operation |
| Control surfaces bloated and rotted (1858-line prompt) | garden as a forced periodic operation with pointer-slimming rules |
| Orphan processes (Metro) outlived iterations | process-group ownership + SDK cancel + teardown sweep |
| Agent self-invented out-of-scope plans (manually reverted) | plan review gate; empty BACKLOG → empty plan output |

## Technical decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Runtime | Node ≥ 22, TypeScript strict, ESM | same ecosystem as the SDKs |
| Package shape | single package; console splits into a workspace later | no premature monorepo |
| State storage | JSON / JSONL + file locks | greppable (constitution §1); revisit if it hurts |
| Config | zod schema, generated JSON Schema | editor autocomplete for `config.yaml` |
| Tests | vitest; synthetic e2e with temp git repos + fake provider | the prototype's most valuable engineering practice, inherited |
| Lint/format | biome | one tool, zero bikeshedding |
| Build/release | tsup-bundled bin; changesets; npm provenance | 2026 OSS standard posture |
| First adapter | **Codex SDK** (`@openai/codex-sdk`), ChatGPT-subscription auth | primary executor; interface stays multi-provider (fake adapter proves the seam) |

## Phases

### Phase 0 — Foundations (small)

Scaffolding done right: package layout, bin entries (`nightcrew` + `crew`
alias), biome, vitest, tsup, GitHub Actions matrix (macOS + Linux:
typecheck/lint/test), changesets, zod config schema, `.nightcrew/` contract
frozen, fake-provider test design.

**Acceptance:** CI green; `npx nightcrew --version` works. Ships `0.0.2`.

### Phase 1 — Single-project one-shot vertical slice (medium-large)

- `init`: scaffold `.nightcrew/`, patch gitignore, register in the global
  registry.
- `Provider` interface + **fake adapter** + **Codex adapter** (subscription
  auth, streamed events, timeout/cancel, usage capture).
- Worktree-first git module: create/bootstrap/teardown, snapshots,
  write-scope guard, merge-back (`auto` policy).
- One-shot runner end to end, including the mandatory imperative section in
  provider input.
- Promotion pipeline reserves the review gate seam (verdict types, gate
  interface) even though the review executor ships in Phase 2.
- CLI: `run`, `status`, `plan list`.

**Acceptance:** a real repo runs one full plan→execute (in worktree)→verify→
merge cycle; synthetic e2e covers success/failure/timeout/merge-conflict.
Ships `0.1.0`.

### Phase 2 — The loop, the guards, read-only console (large; the moat)

- Loop orchestration: pause/resume, backoff, failure→repair downgrade,
  operation reset after success.
- Full guard suite under worktree semantics (all three streaks, idle, forced
  garden, worktree keep/discard recovery).
- Budget ledger + `quota_exhausted` window-aware resume.
- Session policy: resume within plan, fresh thread per new plan.
- **Review agent ships**: plan review + merge review, advisory default, gate
  configurable, `max_review_rounds`, notes-into-repair closed loop.
- **Console v0 (read-only)**: single-project board, live iteration log (SSE),
  history, cost curve. Separate static frontend + typed JSON/SSE API.
- Every row of the requirements table above is closed and tested.

**Acceptance:** 20+ unattended iterations in synthetic stress runs; every
breaker reproducible; **dogfood starts — nightcrew develops nightcrew.**
Ships `0.2.0`.

### Phase 3 — Multi-project, parallelism, scheduling, console actions (medium-large)

- `crew start` daemon: N projects in parallel, per-project loops, file locks.
- Parallel plans within a project: only plans with `parallel: true`
  frontmatter run concurrent worktrees; serial by default.
- Automations: per-project cron windows (e.g. weekdays 23:00–07:00),
  quota-window auto-resume.
- **Console v1**: multi-project board + actions (pause/resume/run/gc); `crew
  status` CLI equivalent.
- Per-operation model-tier routing; merge review promoted to gate-by-default
  if dogfood data supports it.

**Acceptance:** two real projects, one running two plans in parallel, run
overnight without cross-contamination; the morning board tells the whole
story in one screen. Ships `0.3.0`.

### Phase 4 — Operator experience and 1.0 (medium)

- `nightcrew report`: the morning digest — commits landed, cost spent,
  questions awaiting decisions.
- OSS packaging: README that explains the value in 90 seconds, concept doc
  mapping nightcrew to loop-engineering vocabulary, config reference
  generated from the zod schema, CONTRIBUTING, issue templates, launch
  write-up ("what 700 unattended iterations taught us").
- API freeze, semantic versioning commitment.

**Acceptance:** `1.0.0`, public announcement. Codex-only at 1.0 is a feature,
not a gap: one deeply polished executor behind an open interface.

## Post-1.0 (explicitly out of scope for now)

- Claude Agent SDK and Cursor SDK adapters; cross-vendor maker/checker review.
- `pr` merge mode (open a PR instead of merging).
- Webhook/event triggers beyond cron.
- SQLite ledger, richer analytics.

## Engineering discipline (applies to every phase)

- Two-layer testing: synthetic e2e (temp git repos + fake provider, no
  network, runs in CI) as the backbone; real-SDK smoke tests behind an env
  flag, run manually.
- Every phase ends with a changeset, changelog entry, tag, and an updated
  "what works today" section in the README. The README never lies.
- SDK adapters stay one-file-per-vendor with a converged interface: a
  breaking SDK change must be absorbable inside a single file.
