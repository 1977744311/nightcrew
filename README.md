# nightcrew

[Languages: Simplified Chinese](README.zh-CN.md)

> Your coding agents on the night shift.

You write a backlog in plain markdown and go to bed. nightcrew turns it into
bounded plans, executes each plan in an isolated git worktree, gates every
merge behind your test suite and an independent review agent, and lands
verified work on your base branch — iteration after iteration, unattended.
In the morning, `nightcrew report` tells you what landed, what failed, what
it cost, and which decisions are waiting for you.

It is a control plane *around* coding agents, not another agent. The agent
(OpenAI Codex today, via the official SDK on your existing subscription)
does the coding; nightcrew does everything an unattended agent cannot be
trusted to do itself: scope its writes, verify its claims, review its diffs,
stop its spirals, and keep a durable ledger of every step.

## Why this exists

Interactive agent CLIs are built for a human in the loop. Leave them alone
for a night and the failure modes are always the same: they wander outside
the task, claim success without proof, spin on the same broken test for six
hours, or silently burn the whole quota. nightcrew's design assumes all of
that will happen and makes each one a **typed, recoverable event** instead
of a morning surprise:

| Unattended failure mode | nightcrew's answer |
| --- | --- |
| Agent wanders off-task | Plans are bounded seams, authored from *your* BACKLOG, checked by plan review |
| "Done!" without proof | Deterministic verify profiles gate every landing; failures downgrade to `repair` |
| Self-approving slop | Independent merge review on a fresh session judges intent, scope, honesty |
| Infinite retry spirals | Failure / no-commit / control-only streak guards stop the loop with a typed reason |
| Wrecked working tree | All code work happens in per-plan git worktrees; your checkout stays clean |
| Touching what it must not | Write-scope guard reverts protected-path edits before anything is committed |
| Quota burned at 2am | `quota_exhausted` schedules a window-aware resume instead of failing |
| "What happened last night?" | Append-only history + events ledger, live console, morning report |

## Quickstart

```bash
npm install -g nightcrew   # Node >= 22; needs git and a Codex subscription (codex login)

cd your-repo
nightcrew init             # scaffolds .nightcrew/ and registers the project
nightcrew doctor           # first-run sanity check: runtime, repo, config, registry, lock
$EDITOR .nightcrew/crew.md # write rules + BACKLOG items
nightcrew propose "goal"   # or: draft ready-to-ratify BACKLOG items from a goal, pick in-terminal

nightcrew run              # one supervised iteration, to build trust
nightcrew loop             # a bounded unattended session (default 20 iterations)
crew start                 # the real thing: daemon, all projects, schedule windows
nightcrew report           # the morning after
```

`.nightcrew/` is committed with your repo (runtime state and worktrees are
git-ignored). Your repo *is* the database — remove the directory and
nightcrew never happened.

## How a night goes

Each iteration resolves one **operation** — the single run-intent field
across config, state, and console:

1. **plan** — no active plan? Author exactly one bounded plan from the
   BACKLOG (or declare IDLE). Plan review checks it is authorized and
   bounded before it is accepted.
2. **execute** — work the plan inside its own worktree + branch
   (`nightcrew/<plan-id>`), resuming the same provider session across
   iterations. Progress is auto-committed, scoped, at iteration end.
3. **verify** — deterministic gates (your commands: tests, typecheck,
   lint) run in the worktree. Green is a precondition for landing, not a
   claim the agent gets to make.
4. **repair** — any typed failure (verify red, merge conflict, review
   changes-requested, timeout…) becomes the next iteration's focused brief.
5. **garden** — periodic control-surface hygiene: prune stale questions,
   tidy the backlog, keep the paper cuts from compounding.

When a plan is complete and gates are green, the merge reviewer reads the
full diff against the plan on a fresh session. Approved work merges back
(or, with `git.mergeMode: pr`, is pushed and opened as a GitHub pull
request via `gh`), the worktree is cleaned up, and the plan's BACKLOG
item is ticked off by deterministic runner code — never by the agent.
Rejected work becomes a repair brief; anything genuinely ambiguous
escalates to `questions.md` and stops that plan — asynchronously, without
blocking the rest of the night.

Plans marked `parallel: true` run in concurrent worktree lanes (bounded by
`loop.maxParallelPlans`). The `crew` daemon drives many projects at once,
inside your `schedule.windows` (e.g. `"23:00-07:00"`), with one project
lock per repo so nothing is ever driven twice.

## The control surfaces

Everything you and the crew say to each other lives in markdown, in your repo:

```
.nightcrew/
  config.yaml        # the contract: provider, gates, guards, schedule
  crew.md            # your rules + BACKLOG (the only source of new work)
  questions.md       # decisions awaiting you, with lettered options to pick from
  qa.md              # defects you record; the loop triages them into proposals
  plans/             # active/ completed/ paused/ — one markdown file per plan
  runtime/           # state.json, history.jsonl, events.jsonl (git-ignored)
  worktrees/         # per-plan checkouts (git-ignored)
```

The morning routine is one approval inbox in the console: open questions
render their options (answering can schedule the chosen option straight
into BACKLOG; leaving feedback makes the crew redraft options next run),
and new `qa.md` defect bullets are auto-triaged overnight into a pending
proposal of fix candidates for you to approve. Every BACKLOG line still
traces back to one of your clicks — agents never write `crew.md`.

Prefer a push over polling? Configure `notify.webhook` and the loop POSTs
compact JSON when it stops with a typed reason, when a question lands,
when a proposal awaits approval, and when the canary fails —
deterministic code, no model calls, and delivery failures never break
the loop.

Fake-provider tests cannot prove live integrations (a real provider
call, `gh` auth, your deploy credentials). Point `canary.profile` at a
verify profile and the loop runs those steps in the project root —
outside any agent sandbox — at most once per `canary.everyHours`,
before picking up work. A failing step is appended to `qa.md` (where
overnight triage drafts fix candidates) and fires the `canary_failed`
webhook; the loop itself keeps going.

## Commands

| Command | What it does |
| --- | --- |
| `nightcrew init` | Scaffold `.nightcrew/`, patch `.gitignore`, register the project; `--assist` drafts config values and starter rules from one read-only Codex pass (applied only after you confirm) |
| `nightcrew doctor` | Preflight the local runtime, repository, config, registry, daemon lock, and Codex auth (the same provider check fail-fasts `loop` and `crew start`) |
| `nightcrew run` | One iteration; `-o/--operation` and `-p/--plan` override resolution |
| `nightcrew loop` | Iterate until a guard, budget, or the operator stops it |
| `nightcrew status` | Plans, streaks, worktrees, recent iterations |
| `nightcrew report` | Morning digest: landed, failed, cost, open questions |
| `nightcrew plan add <title>` | Create an active plan scaffold |
| `nightcrew propose "<goal>"` | One research pass drafts BACKLOG candidates (`--lenses` runs 3 competing passes, `--from-qa` drafts from qa.md defects); pick via checkbox TUI, `--ids 1,3`, or the console. Bare `propose` resumes pending drafts; `--feedback "<text>"` regenerates |
| `nightcrew plan list/show` | Inspect plans |
| `nightcrew pause/resume` | Suspend / wake the loop (also from console and `crew`) |
| `nightcrew console` | Local web console: board, history, token curve, live events, question + proposal approvals |
| `nightcrew gc` | Clean stale worktrees, sessions, old logs |
| `crew start` | Daemon across all registered projects; `--console` serves the UI with actions |
| `crew report` | Aggregate the morning digest across all registered projects |
| `crew status` | One line per registered project |

## Configuration, in 20 lines

```yaml
# .nightcrew/config.yaml
project:
  name: my-app
provider:
  codex:
    sandbox: workspace-write
verify:
  profiles:
    default:
      steps:
        - { name: test, run: npm test }
        - { name: typecheck, run: npx tsc --noEmit }
review:
  mode: gate          # off | advisory | gate
git:
  mergeMode: merge    # merge locally | pr: push + open a GitHub PR
notify:
  webhook: https://example.com/hook   # optional push: stops, questions, proposals, canary
canary:
  profile: smoke      # verify profile run nightly outside the sandbox; failures land in qa.md
schedule:
  windows: ["23:00-07:00"]
loop:
  maxIterations: 40
```

Every key is validated strictly at load time — a typo fails loudly at
startup, not silently at 3am. Full reference: [docs/configuration.md](docs/configuration.md).
Concepts and design rationale: [docs/concepts.md](docs/concepts.md).

## Safety model

The agent is treated as an untrusted worker with a narrow contract:

- code ops run in a worktree and may not touch `protectedPaths` or `.git`;
- control ops run on the main checkout and may *only* touch `.nightcrew/`;
- violations are reverted before anything is committed, and fail the iteration;
- landing on your base branch requires: gates green, plan complete, review
  approval, clean main checkout — all four, every time;
- the daemon holds a per-project lock; two loops can never drive one repo;
- every iteration ends in a ledger record: verified progress or a typed failure.

## Library use

The CLI is a thin skin over a typed library — every seam (provider,
reviewer, scheduler, report) is exported:

```ts
import { loadProject, buildProvider, buildReviewer, runIteration } from "nightcrew";

const ctx = loadProject(process.cwd());
const provider = buildProvider(ctx.config, ctx.root);
const record = await runIteration(ctx, { provider, reviewer: buildReviewer(ctx.config, provider, ctx.root) });
```

## Status

2.0 ships Codex as the single deeply-polished executor behind a provider
interface designed for more: Claude Code and Cursor adapters are the next
milestone (`Provider` is ~one file to implement — see `src/providers/`).
The `operation` model, config schema, CLI surface, and library exports have
been frozen under semver since 1.0.0 — 2.0.0 is that contract enforced:
collapsing the `propose` subcommands into flags was a breaking CLI change,
so the major version moved.

## License

MIT
