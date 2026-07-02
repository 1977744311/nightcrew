# Contributing

Thanks for helping build the night shift. This project is small on purpose;
the bar for merging is "provably correct under unattended conditions", not
"looks plausible".

## Setup

```bash
git clone https://github.com/1977744311/nightcrew.git
cd nightcrew
npm install
npm run check   # typecheck + lint + tests + build — must be green before a PR
```

Node >= 22, npm (the repo has `package-lock.json`), git. No other services.

## Ground rules

- **`operation` is the single run-intent field.** Config, runtime state,
  provider input, API payloads, and console labels all use it. Never add a
  parallel notion of "mode" or "phase".
- **The core stays provider-neutral.** Anything above `src/providers/types.ts`
  must not import an SDK. New agent integrations are one adapter file
  implementing `Provider` plus a factory entry.
- **Every behavior change ships with a synthetic test.** The suite runs the
  full pipeline against temp git repos with the scripted fake provider —
  deterministic, offline, fast. If your change matters, a test can show it.
- **Typed failures only.** New failure paths get a `FailureKind`, not a
  string. New stop conditions get a `StopReason`.
- **No new dependencies without a reason** that survives the question "what
  breaks at 3am when this is stale?".

## Working on it

- `npm test` — full synthetic suite (temp repos, fake provider).
- `NIGHTCREW_SMOKE=1 npm test` — additionally runs the real Codex SDK smoke
  test (needs `codex login`).
- `npm run lint:fix` — biome formats and organizes imports.
- Runtime bugs: `.nightcrew/runtime/events.jsonl` and `logs/<iteration>.log`
  in your test project are the first places to look.

## Pull requests

- One bounded change per PR — the same rule the plan reviewer enforces on
  the agents.
- Include: what failure mode this addresses, how the test proves it, and
  any config surface changes (update `docs/configuration.md` in the same PR).
- CI (typecheck, lint, tests, build on ubuntu + macos) must be green.

## Releases

Semver from 1.0.0: the config schema, CLI surface, `operation` model, and
library exports are frozen — breaking any of them is a major. Releases are
tagged from `main` with an updated `CHANGELOG.md`.
