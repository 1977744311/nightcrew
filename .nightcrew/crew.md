# Crew Directives

Operator surface. The crew reads this every iteration; only the operator edits it.

## Rules

- This repo is nightcrew itself. Follow `CONTRIBUTING.md`: strict TypeScript,
  Biome, vitest. Every behavior change needs a test in `tests/`.
- Provider adapters: Codex only. Do NOT add Claude, Cursor, or any other
  adapter — that work is not authorized until the operator says so explicitly.
- Public API is frozen under semver: additive changes only, no breaking
  renames of exported types, CLI commands, or config keys.
- Update `CHANGELOG.md` under an `## Unreleased` heading for every landed plan.
- Never touch `ROADMAP.md`, version numbers in `package.json`, or git tags —
  release mechanics belong to the operator.
- Keep new CLI output consistent with the existing `log`/`c` color helpers.

## BACKLOG

Authorized work, most valuable first. The crew plans ONLY from this list —
an empty backlog means the crew idles instead of inventing work.

- [ ] `nightcrew doctor`: a preflight command that checks the environment and
      config, then prints a pass/fail table. Checks: node >= 20, git present
      and repo detected, `.nightcrew/config.yaml` parses against the schema,
      base branch exists, bootstrap/verify commands are non-empty strings,
      project is registered in the global registry, and no stale daemon lock.
      Exit code 0 only when every check passes. Tests included.
- [ ] `nightcrew plan add <title>`: scaffold a valid plan file into
      `.nightcrew/plans/active/` from the CLI (id = date + slug of title,
      frontmatter matching the schema, Goal/Acceptance/Steps skeleton), so an
      operator can queue work without hand-writing frontmatter. Print the
      created path. Reject duplicate ids. Tests included.
- [ ] `crew report`: aggregate morning digest across ALL registered projects
      (reuse `buildReport` per project, then render one combined summary:
      per-project landed/failed/tokens plus a grand total). `--hours` and
      `--json` flags consistent with `nightcrew report`. Tests included.
- [ ] `nightcrew report` per-plan breakdown: extend the report data with a
      per-plan table (iterations, tokens, landed or not) so the operator sees
      where the night's budget went. Keep the existing summary intact. Tests
      included.
