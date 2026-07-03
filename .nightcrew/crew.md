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
- Keep new CLI output consistent with the existing style: `console.log` +
  `picocolors` (`pc`) in commands, `log` from `src/utils/log.ts` for
  runtime-loop messages.

## BACKLOG

Authorized work, most valuable first. The crew plans ONLY from this list —
an empty backlog means the crew idles instead of inventing work.

- [x] `nightcrew doctor`: a preflight command that checks the environment and
      config, then prints a pass/fail table. Checks: node >= 20, git present
      and repo detected, `.nightcrew/config.yaml` parses against the schema,
      base branch exists, bootstrap/verify commands are non-empty strings,
      project is registered in the global registry, and no stale daemon lock.
      Exit code 0 only when every check passes. Tests included.
- [x] `nightcrew plan add <title>`: scaffold a valid plan file into
      `.nightcrew/plans/active/` from the CLI (id = date + slug of title,
      frontmatter matching the schema, Goal/Acceptance/Steps skeleton), so an
      operator can queue work without hand-writing frontmatter. Print the
      created path. Reject duplicate ids. Tests included.
- [x] `crew report`: aggregate morning digest across ALL registered projects
      (reuse `buildReport` per project, then render one combined summary:
      per-project landed/failed/tokens plus a grand total). `--hours` and
      `--json` flags consistent with `nightcrew report`. Tests included.
- [x] `nightcrew report` per-plan breakdown: extend the report data with a
      per-plan table (iterations, tokens, landed or not) so the operator sees
      where the night's budget went. Keep the existing summary intact. Tests
      included.
- [x] `nightcrew propose "<goal>"`: turn a one-line goal into reviewable
      BACKLOG candidates. Run 3 independent read-only research passes over
      the repo (lenses: minimal path / architecture-first / risk-first), each
      returning structured JSON via the provider `outputSchema` (reuse the
      reviewer's fresh-session pattern; the fake provider must remain
      scriptable for tests). Persist ONE proposal artifact under
      `.nightcrew/proposals/` (JSON with a stable schema and stable item ids;
      must survive across command invocations) holding every candidate item:
      id, title, backlog-ready body (3-10 lines, checkbox-format text),
      rationale, source lens. Add `routing.propose` config (light|heavy,
      default light). Include a non-interactive approval path:
      `nightcrew propose select --ids 1,3` appends the chosen items verbatim
      to the `## BACKLOG` section of `.nightcrew/crew.md` in checkbox format
      and archives the proposal artifact. `propose list` shows pending
      proposals. Tests included.
- [x] Interactive picker for propose: when stdout is a TTY, after generation
      finishes (and via `nightcrew propose review [--latest|<file>]` for a
      stored proposal) open an in-terminal checkbox picker: arrow keys move,
      space toggles items, enter confirms, and aborting selects nothing.
      Selected items flow through the exact same append-to-crew.md +
      archive path as `propose select`. Use `@clack/prompts` (already
      installed as a dependency — do NOT add other new dependencies).
      Non-TTY environments fall back to printing numbered items plus a hint
      to use `propose select --ids`. Unit-test the selection/merge logic and
      the non-TTY fallback; the raw TTY event loop itself may stay untested.
      Tests included.
- [x] Console support for proposals: the project detail page lists pending
      proposal items (title + body + lens) with checkboxes. With `--actions`
      enabled, an approve button POSTs the selected item ids to a new
      endpoint that reuses the same append-to-crew.md + archive path; without
      actions the list renders read-only and the endpoint returns 404. Tests
      included.

- [x] Console project detail per-plan accounting: extract report-style plan history aggregation into a shared module that returns plan id, title, iterations, total tokens, durationMs, and landed/pending status.
      Use that model from `nightcrew report` and `src/console/data.ts` so the project detail JSON exposes a stable per-plan metrics field instead of page-only aggregation.
      Render a per-plan table on the console project detail page with token totals and human-readable duration while preserving the existing summary, proposals, token curve, and history table.
      Tests included for aggregation, console detail JSON, and the HTML rendering path.
- [x] Proposal picker must show full item bodies: in TTY flows (after
      generation and in `propose review`), print every candidate — id,
      title, lens, and the full backlog body — BEFORE opening the checkbox
      picker, so the operator reads the exact text they are approving.
      Keep picker option labels short (id + title, lens as hint) and the
      non-TTY output unchanged. Test the pre-picker printing through the
      injectable prompt seam. Tests included.
- [x] `nightcrew propose refine`: feedback-and-regenerate for proposals.
      Non-interactive: `nightcrew propose refine [<id-or-file>] --feedback
      "<text>"` (default: latest pending). Interactive: when the TTY picker
      closes with zero selections, prompt once for optional feedback text;
      empty input leaves the proposal pending and untouched. Refine reruns
      the three lens passes with the original goal PLUS the previous
      candidates (id/title/lens) and the operator feedback in each prompt,
      writes a NEW pending artifact recording `refinedFrom` (source id) and
      the feedback text (additive optional schema fields), archives the
      source artifact, and in TTY reopens the picker on the new artifact.
      Fake-provider tests cover: feedback present in rerun prompts, lineage
      fields, source archived, and the zero-selection/no-feedback path
      changing nothing. Tests included.
- [x] Web search support: add `provider.codex.webSearch` config
      (`disabled | cached | live`, default `cached` to match current SDK
      behavior) and pass it to the SDK ThreadOptions as `webSearchMode`;
      allow an optional per-operation override map (at minimum `propose`
      must be overridable, e.g. propose uses `live` while execute stays
      `cached`). Then extend the propose research prompt: when the goal
      involves external ecosystems (UI patterns, library choices, best
      practices), instruct the pass to run web searches first and cite
      1-2 reference sources inside the candidate `rationale` field so the
      operator sees them in the picker and console. Keep the fake provider
      unaffected. Tests cover config parsing/defaults, adapter option
      passing, and the prompt containing the research guidance. Tests
      included.
- [ ] Config JSON Schema for editor autocomplete: generate
      `schema/config.schema.json` from the zod config schema using zod v4's
      native `z.toJSONSchema` (no new dependencies). Add an `npm run schema`
      script, commit the generated file, and add a test that regenerates the
      schema and fails when the committed file is out of sync. Update the
      `nightcrew init` config template to start with a
      `# yaml-language-server: $schema=` comment pointing at the raw GitHub
      URL of the committed schema so editors autocomplete `config.yaml`.
      Tests included.
- [ ] Release automation with changesets + npm provenance: add
      `.github/workflows/release.yml` using the official changesets action
      (version PR flow; publish runs `npm publish --provenance` and needs the
      `NPM_TOKEN` secret — configuring the secret itself is operator work,
      document that plus the release steps in CONTRIBUTING). Set
      `publishConfig.provenance` in package.json. Do NOT change existing CI
      or version numbers. Keep the manual `npm version` + tag flow documented
      as fallback.
- [ ] Launch write-up draft at `docs/launch.md`: "what 700+ unattended
      iterations taught us about loop engineering". Ground every claim ONLY
      in ROADMAP.md (requirements table, constitution), docs/concepts.md,
      and CHANGELOG.md — do not invent metrics, benchmarks, or anecdotes not
      present in those files. Structure: the failure modes of unattended
      agent loops → the guard/review/worktree answers nightcrew ships → the
      dogfood story (1.1-1.3 were built by nightcrew on itself, per
      CHANGELOG). Mark operator-voice gaps with `<!-- operator: ... -->`
      comments instead of fabricating. No code changes.
