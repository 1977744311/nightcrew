# nightcrew Roadmap

> Your coding agents on the night shift.

nightcrew is a loop-engineering control plane for unattended agent work. It
owns the **outer loop** — durable plan pipelines, deterministic verify gates,
independent review, economic guards, and multi-project scheduling — and
delegates the **inner loop** (a single agent iteration) entirely to official
agent SDKs, running on your existing subscriptions.

This is a living document: constitution first, then what has shipped, what is
next, and what stays on the horizon. How the system works day-to-day lives in
[docs/concepts.md](docs/concepts.md); the full release history lives in
[CHANGELOG.md](CHANGELOG.md).

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

## Requirements distilled from 700+ real iterations

nightcrew is a clean-room redesign of a battle-tested private prototype that
drove 700+ unattended iterations (191 completed plans) across three provider
CLIs. Its scars are encoded as hard requirements:

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

## Shipped

The original Phase 0–4 plan landed in full; every acceptance bar was met and
tagged. Since 1.0, every feature has been planned, implemented, verified,
reviewed, and merged **by nightcrew running unattended on this repository**.

| Release | What landed |
| --- | --- |
| v0.0.2 | Foundations: package/bin layout (`nightcrew` + `crew`), biome, vitest, tsup, CI matrix (macOS + Linux), zod config schema, `.nightcrew/` contract, fake-provider test design |
| v0.1.0 | One-shot vertical slice: `init`, Provider interface + Codex/fake adapters, worktree-first git module with write-scope guard and merge-back, one-shot runner, promotion pipeline with the review seam reserved |
| v0.2.0 | The moat: loop orchestration, full guard suite (streaks, idle, forced garden), budget ledger + `quota_exhausted` window-aware resume, per-plan session policy, review agent (plan + merge review, advisory default), read-only console (JSON/SSE) |
| v0.3.0 | Scale-out: `crew` multi-project daemon with file locks, parallel plans via `parallel: true`, cron windows, console actions, per-operation model-tier routing |
| v1.0.0 | Operator experience: `nightcrew report`, README/concepts/configuration docs, CONTRIBUTING, issue templates, **API freeze under semver** |
| v1.1.0 | First dogfood cycle: `nightcrew doctor`, `nightcrew plan add`, `crew report`, per-plan report breakdown, plan-index in the planner prompt, operator-owned `crew.md` (garden reports instead of editing) |
| v1.2.0 | Propose: goal in, ratified backlog out — three research lenses (minimal / architecture-first / risk-first) in read-only passes, one stable proposal artifact, approval via checkbox TUI, `propose select --ids`, or the console |
| v1.3.0 | Research quality: full item bodies before the picker, `propose refine` (feedback → regenerate with lineage), `provider.codex.webSearch` (`disabled\|cached\|live` + per-operation overrides) with cited sources in rationales, console per-plan accounting |
| v1.4.0 | Polish: three concurrent propose passes with live per-lens progress, preview-pane picker, language mirroring, config JSON Schema for editor autocomplete, changesets release automation with npm provenance |
| v2.0.0 | First npm publish. Propose collapsed to one command + flags (breaking; balanced single pass default, `--lenses` opt-in), operator approval inbox with `qa.md` auto-triage, `git.mergeMode: pr`, `init --assist`, scheduled canary + structured-output schema guards, merge identity fallback for bare CI runners |

## Next

Queued in `.nightcrew/crew.md` BACKLOG (the crew builds these; this list is
the roadmap-level intent):

- **Launch write-up**: "what 700+ unattended iterations taught us",
  drafted from this document, concepts, and the changelog.

Decision point held open on purpose:

- **Merge review gate-by-default.** Dogfood so far: 40+ unattended
  iterations, one justified `request_changes`, zero bad merges. Advisory
  stays the default until a few more full nights land clean; then the
  default flips to `gate`.

## Horizon (explicitly not now)

- Claude Agent SDK and Cursor SDK adapters; cross-vendor maker/checker
  review. Deferred until the operator green-lights them — Codex-only is a
  feature while the loop machinery is the product.
- Webhook/event triggers beyond cron windows.
- SQLite ledger and richer analytics; console split into a workspace package.

## Engineering discipline (applies to everything above)

- Two-layer testing: synthetic e2e (temp git repos + fake provider, no
  network, runs in CI) as the backbone; real-SDK smoke tests behind an env
  flag, run manually.
- Every release ships a changelog entry and a tag; the README never lies
  about what works today.
- SDK adapters stay one-file-per-vendor behind one interface: a breaking SDK
  change must be absorbable inside a single file.
- The BACKLOG is the only authorization boundary: nothing lands that an
  operator did not queue, ratify, or write down as a rule.
