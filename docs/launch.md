# What 700+ Unattended Iterations Taught Us About Loop Engineering

This is a source-bound launch draft. Every factual claim below is grounded in
`ROADMAP.md`, `docs/concepts.md`, or `CHANGELOG.md`; places that need the
operator's firsthand voice are left as HTML comments instead of invented story.

<!-- operator: Add the opening personal anecdote or stakes from the private prototype. The authorized sources establish 700+ unattended iterations and 191 completed plans, but not the human story around them. -->

nightcrew is a loop-engineering control plane for unattended agent work. It
owns the outer loop: durable plan pipelines, deterministic verify gates,
independent review, economic guards, and multi-project scheduling. The inner
loop remains the job of official agent SDKs running on existing subscriptions.

The project exists because the private prototype behind nightcrew ran 700+
unattended iterations, completed 191 plans, and exposed a set of recurring loop
failures. nightcrew is the clean-room redesign of those lessons.

## Failure Modes Of Unattended Agent Loops

Unattended agent work does not usually fail in one dramatic way. The roadmap's
prototype table records quieter failure modes that become expensive only after
the loop has been left alone.

Provider output can be the wrong heartbeat. The prototype saw buffered output
trigger idle watchdog false-kills, so nightcrew treats typed SDK events as the
source of liveness instead of counting bytes.

"Green" can still mean no progress. Consecutive successful runs with zero
commits burned quota, and control-only updates could make the agent look busy
while only maintaining its own paperwork.

A dirty checkout can turn one failure into a loop-shaped failure. The prototype
recorded cases where a failed run left the tree dirty, causing later iterations
to skip permanently.

An underspecified agent can spin before it starts. Plan mode once asked "what
should I do?" and looped; nightcrew's provider input now ends with a mandatory
imperative per operation.

Control surfaces can become their own problem. The roadmap cites a 1858-line
prompt that bloated and rotted, which became a requirement for forced garden
operations and pointer-slimming rules.

Processes can outlive the iteration that launched them. The prototype saw
orphan processes outlive agent runs, so nightcrew treats process ownership,
SDK cancellation, and teardown as loop mechanics.

Scope can drift without an authorization boundary. The prototype also saw an
agent invent out-of-scope plans that had to be manually reverted, which became
the rule that an empty BACKLOG produces no invented plan.

<!-- operator: Add one concrete failure story if desired. The current sources list failure modes and requirements, not a dated incident or morning cleanup anecdote. -->

## The Guard, Review, And Worktree Answers

nightcrew's answer starts with where state lives. Plans, questions, rules, and
history are files under `.nightcrew/`, committed alongside the project. Runtime
state is disposable; git is the audit log.

The worker is deliberately untrusted. The execute agent receives a narrow brief
inside a scoped workspace, but verification and review sit outside that agent.
Mechanical correctness comes from deterministic verify profiles: project-owned
commands whose exit codes decide whether the run is green.

Intent compliance comes from a maker-checker split. The review agent runs in a
fresh session, in a read-only sandbox, and sees evidence only: plan, diff, gate
results, and operator rules. It returns a strict JSON verdict:
`approve`, `approve_with_notes`, `request_changes`, or `escalate`.

Progress is promoted through four gates in one iteration: the plan must be
complete, verification must pass, merge review must approve or record notes
according to the configured mode, and the main checkout must be clean. If a gate
fails, the loop keeps iterating, creates a repair brief, escalates, or preserves
the branch depending on the typed failure.

Worktrees keep failures contained. Each plan gets one branch and one worktree,
session continuity is scoped to that plan, and landing removes the worktree
after the plan moves from active to completed. The main checkout is protected
from dirty-tree fallout.

Anti-spin guards turn "something is stuck" into typed stops: failure streaks,
no-commit streaks, control-only streaks, session and per-plan iteration caps,
and idle or wall-clock watchdogs. A tripped guard writes a stop reason, halts
the loop, and puts the issue at the top of the report.

Budget awareness is part of the loop instead of an afterthought. Every
iteration records token usage; quota exhaustion is treated as scheduling, not
failure, and the same plan and session can resume when the provider window
reopens.

Human involvement stays asynchronous. Operators put directives in `crew.md`;
the system writes questions to `questions.md`. Escalation can park one plan, but
it does not park the whole night.

## The Dogfood Story: 1.1 To 1.3

The roadmap says the Phase 0-4 plan landed in full and that, since 1.0, every
feature has been planned, implemented, verified, reviewed, and merged by
nightcrew running unattended on this repository. The changelog gives the public
dogfood trail for releases 1.1 through 1.3.

Version 1.1.0 was the dogfood release. It added `nightcrew doctor`,
`nightcrew plan add <title>`, aggregate `crew report`, per-plan report
breakdowns, plan-index context for the planner, and the change that garden no
longer edits the operator-owned `crew.md`. The changelog records that those
features landed through 9 iterations, 4 plans, about 8.9M tokens, and zero
human-written product code.

Version 1.2.0 was the propose release: "goal in, ratified backlog out." It
added three read-only proposal research passes, stable proposal artifacts,
pending proposal listing, non-interactive `propose select --ids`, TTY checkbox
approval, and console approval of selected proposal items. The changelog says
the three features were built by nightcrew on itself in 3 plans, 8 iterations,
and one unattended run.

Version 1.3.0 was the research release. It added Codex web-search controls for
proposal research, `nightcrew propose refine`, full item bodies before TTY
proposal review, and shared per-plan history accounting for reports and the
console. The changelog records four plans, one unattended run, built by
nightcrew on itself.

That dogfood record matters because the project is not only describing
unattended-loop controls; it is using those controls to build its own operator
surface. The public claim should stay narrow: 1.1 through 1.3 show nightcrew
using its own plan, execute, verify, review, reporting, and proposal workflows
on this repository.

<!-- operator: Add your voice on what the 1.1-1.3 dogfood cycle changed about trust in the tool. The sources support shipped outcomes and changelog metrics, not the operator's subjective conclusion. -->

## Source Boundary For Final Editing

Keep the final launch post grounded in these source-backed claims:

- The prototype history: 700+ unattended iterations and 191 completed plans.
- The failure modes and hard requirements listed in the roadmap table.
- The design constitution in `ROADMAP.md` and `docs/concepts.md`.
- The operation model, plan isolation model, promotion pipeline, review agent,
  guards, scheduling, reports, and typed failure behavior in `docs/concepts.md`.
- The 1.1, 1.2, and 1.3 release narratives and dogfood metrics in
  `CHANGELOG.md`.

Avoid adding benchmarks, customer anecdotes, reliability percentages, or
operator quotes unless they are supplied by the operator or added to an
authorized source first.
