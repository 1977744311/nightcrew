# Concepts

nightcrew is a **loop-engineering** control plane. This page maps its moving
parts to that vocabulary and records the design constitution behind them.

## The design constitution

Six principles decide every design question. When two features conflict, the
higher rule wins.

1. **State lives in the repo, not in the conversation.** Plans, questions,
   rules, and history are files in `.nightcrew/`, committed alongside code.
   Any iteration can crash — the next one reconstructs everything from disk.
2. **The agent is an untrusted worker.** It gets a narrow brief, a scoped
   workspace, and no authority over what counts as done. Verification and
   review sit outside the agent.
3. **Every iteration either lands verified progress or records a typed
   failure.** There is no third outcome. `history.jsonl` is append-only;
   "it did something, unclear what" cannot happen by construction.
4. **Human involvement is asynchronous.** You talk to the crew through
   markdown (BACKLOG in, questions out), never through a blocking prompt.
   Escalation parks one plan; it never parks the night.
5. **Provider-neutral core.** Everything above the `Provider` interface —
   operations, guards, review, scheduling — is agent-agnostic. 1.0 ships
   one polished adapter (Codex); the interface is the product.
6. **Zero-ceremony adoption.** One `nightcrew init` in an existing repo.
   Deleting `.nightcrew/` fully un-adopts. No servers, no databases, no
   accounts beyond the agent subscription you already have.

## Loop-engineering vocabulary → nightcrew

| Loop-engineering term | In nightcrew |
| --- | --- |
| Outer loop | `runLoop` / the `crew` daemon: prompt → act → check → iterate, forever |
| Loop state | `.nightcrew/` control surfaces + `runtime/state.json` |
| Task decomposition | `plan` operation: one bounded plan per BACKLOG seam |
| Ground truth / oracle | Verify profiles: your deterministic commands, exit codes only |
| Maker–checker | Execute agent vs. review agent, always on separate sessions |
| Typed failure taxonomy | `FailureKind`: `verify_failed`, `merge_conflict`, `quota_exhausted`, … |
| Anti-spin guards | Failure / no-commit / control-only streaks, `maxIterations`, review round caps |
| Budget awareness | Token ledger per iteration; quota exhaustion schedules a resume window |
| Human-on-the-loop | `crew.md` BACKLOG in; `questions.md` escalations out; console actions |
| Observability | `events.jsonl` (SSE to console), `history.jsonl`, `nightcrew report` |

In the morning flow, `nightcrew report` includes a per-plan breakdown of
iterations, token spend, and landing status so the overnight total has an
audit trail.

## The operation model

`operation` is the single run-intent field across config, runtime state,
provider input, API payloads, and console labels. There are exactly five:

- **plan** — turn the top unclaimed BACKLOG item into one bounded plan file
  (or declare IDLE). Control-scoped: may only write `.nightcrew/`.
- **execute** — advance the active plan inside its worktree. Code-scoped.
- **verify** — run the deterministic gate profile. No provider involved.
- **repair** — execute's failure-focused twin: the typed failure context
  (failing step output, review notes, conflict detail) becomes the brief.
- **garden** — control-surface hygiene on a cadence (`loop.gardenEvery`).

Auto-resolution order, every iteration: pending repair → forced garden →
active plan → author a plan. Operators can override (`nightcrew run -o …`),
the loop never needs them to.

## Plans

A plan is a markdown file with YAML frontmatter (`id`, `title`, `parallel`,
optional `max_iterations`) living in `plans/active|completed|paused/` — the
directory *is* the status. Plans are the unit of:

- **isolation** — one worktree + one branch (`nightcrew/<id>`) per plan;
- **session continuity** — one provider session per plan, resumed across
  iterations, dropped on completion;
- **parallelism** — `parallel: true` plans may run in concurrent lanes;
- **review** — plan review at authoring, merge review at landing;
- **accounting** — repairs, review rounds, and sessions are keyed by plan id.

## The promotion pipeline

Landing is a pipeline with four independent gates; all must pass in one
iteration for a merge to happen:

```
plan complete? → verify green? → merge review approves? → main checkout clean?
      │                │                   │                       │
   keep iterating   repair brief     repair brief or        typed stop; branch
                                     escalate to human       preserved for you
```

Merge policy `auto` merges `--no-ff` into the base branch; `branch` stops
after review and leaves the branch for a human PR. Either way the plan file
moves to `completed/` and the worktree is removed.

## Review agent

Two review points, one contract. The reviewer runs on a **fresh session**
(never the maker's context), a light model tier, and a read-only sandbox.
It sees evidence only — plan, diff, gate results, operator rules — never
the maker's self-report. It must answer in a strict JSON verdict:
`approve | approve_with_notes | request_changes | escalate`.

- `advisory` mode logs notes without blocking (the default — collect data
  first); `gate` mode blocks landings.
- `request_changes` notes become the next repair brief.
- `review.maxReviewRounds` caps maker↔checker ping-pong, then escalates:
  anti-spin applies to review loops too.
- An unparseable verdict retries once, then escalates. A mute reviewer
  must never silently approve.

## Guards

Guards convert "the agent is stuck" from a morning discovery into a typed
stop, usually within three iterations:

| Guard | Trips when |
| --- | --- |
| `loop.maxFailureStreak` | N consecutive failed iterations |
| `loop.maxNoCommitStreak` | N consecutive code ops that commit nothing |
| `loop.maxControlOnlyStreak` | N consecutive iterations that only touch `.nightcrew/` |
| `loop.maxIterations` | Session budget spent |
| plan `max_iterations` | One plan is consuming the night |
| watchdogs | No provider events for `idleTimeoutMs`, or wall-clock `iterationTimeoutMs` |

A tripped guard writes `state.stop` with the reason; the loop halts, the
daemon waits for the operator, and `report` puts it at the top.

## Scheduling

- `schedule.windows` (`"23:00-07:00"` wraps midnight and belongs to its
  start day) and `schedule.days` gate when the daemon may run.
- `quota_exhausted` is scheduling, not failure: the loop suspends until the
  provider window (`budget.quotaWindowHours`) reopens, then resumes the
  same plan and session.
- One file lock per project (`runtime/daemon.lock`, stale-pid reclaim)
  guarantees a single driver across processes; a per-repo mutex serializes
  main-checkout mutations across in-process lanes.
