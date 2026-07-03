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
- Language split: BACKLOG items and other `.nightcrew/` operator files may
  be written in Chinese, but product source, comments, tests, docs, and CLI
  output must stay English — `tests/localized-readme.test.ts` scans tracked
  files outside `.nightcrew/` and `README.zh-CN.md` and fails verify on any
  Han character.

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
- [x] Propose progress feedback + concurrent passes: run the three lens
      passes concurrently (they are read-only and independent) and show
      per-lens live progress. TTY mode: one status line per lens — running,
      then completed with elapsed seconds and candidate count, or failed
      with a short reason — so the operator watches three workers instead
      of silence. Non-TTY mode: plain start/finish lines. Candidate
      numbering must stay stable in lens order (minimal, architecture,
      risk), never completion order. Error semantics unchanged: any failed
      pass fails the whole command. Tests cover stable ordering under
      out-of-order completion and the failure path. Tests included.
- [x] Proposal picker preview pane (kill the duplicated pre-print): in TTY
      flows, stop printing the full candidate list before the picker.
      Instead build a custom multiselect on `@clack/core` (already
      installed — do NOT add other dependencies) where the highlighted
      item's full body plus lens and rationale render in a preview area
      below the option list, re-rendering as the cursor moves. Space
      toggles, enter confirms, cancel selects nothing — semantics and the
      append/archive flow stay identical to today. Non-TTY output stays
      unchanged (numbered full bodies + `propose select --ids` hint).
      Unit-test the preview rendering pure function; the raw TTY event
      loop may stay untested. Tests included.
- [x] Propose mirrors the operator's language: candidate title, body, and
      rationale must be written in the language of the goal text — a
      Chinese goal yields Chinese candidates, an English goal yields
      English. Implement as prompt instructions in the proposal passes (no
      language-detection code); `propose refine` follows the language of
      the operator feedback. Static CLI strings stay English. BACKLOG
      format rules (checkbox first line, 3-10 lines) apply regardless of
      language. Tests assert the prompts carry the language-mirroring
      instruction. Tests included.
- [x] Config JSON Schema for editor autocomplete: generate
      `schema/config.schema.json` from the zod config schema using zod v4's
      native `z.toJSONSchema` (no new dependencies). Add an `npm run schema`
      script, commit the generated file, and add a test that regenerates the
      schema and fails when the committed file is out of sync. Update the
      `nightcrew init` config template to start with a
      `# yaml-language-server: $schema=` comment pointing at the raw GitHub
      URL of the committed schema so editors autocomplete `config.yaml`.
      Tests included.
- [x] Release automation with changesets + npm provenance: add
      `.github/workflows/release.yml` using the official changesets action
      (version PR flow; publish runs `npm publish --provenance` and needs the
      `NPM_TOKEN` secret — configuring the secret itself is operator work,
      document that plus the release steps in CONTRIBUTING). Set
      `publishConfig.provenance` in package.json. Do NOT change existing CI
      or version numbers. Keep the manual `npm version` + tag flow documented
      as fallback.
- [x] Launch write-up draft at `docs/launch.md`: "what 700+ unattended
      iterations taught us about loop engineering". Ground every claim ONLY
      in ROADMAP.md (requirements table, constitution), docs/concepts.md,
      and CHANGELOG.md — do not invent metrics, benchmarks, or anecdotes not
      present in those files. Structure: the failure modes of unattended
      agent loops → the guard/review/worktree answers nightcrew ships → the
      dogfood story (1.1-1.3 were built by nightcrew on itself, per
      CHANGELOG). Mark operator-voice gaps with `<!-- operator: ... -->`
      comments instead of fabricating. No code changes.

- [x] Add `README.zh-CN.md` as a Chinese translation of the current `README.md`, preserving the same structure, command names, config keys, links, status, and license details.
      Add an English-only language link from `README.md` to `README.zh-CN.md`, and a backlink from the Chinese file to `README.md`.
      Keep Han-script text allowed only in `README.zh-CN.md`; no source, tests, docs, package metadata, changelog text, or CLI output should contain Chinese.
      Add focused tests that scan tracked text files for Han characters outside `README.zh-CN.md` and assert package publishing metadata includes the localized README.
      Include `README.zh-CN.md` in package publishing metadata so the localized README ships with npm package contents.
      Update `CHANGELOG.md` under `## Unreleased`. Tests included.

- [ ] 操作者通知：新增 `notify` 配置段（v1 只做一个 `webhook` URL 加可选
      事件过滤，schema 只增不改）。当 loop 以 typed reason 停止、有新 open
      question 追加、或有 pending proposal 落地（含 qa triage）时 POST 一段
      紧凑 JSON：项目名、计数（landed / failed / open questions / pending
      proposals）和 console 地址提示。纯确定性代码，不调用模型；推送失败
      只记 warning，绝不拖垮 loop。代码、注释与 CLI 输出保持英文。
      Tests included.
- [ ] Codex 预检：`nightcrew doctor` 增加 provider 检查——配置为 codex 时
      验证登录凭据存在（可读的 `~/.codex/auth.json` 或等价的轻量 SDK 探
      测），失败时给出 `codex login` 提示；fake provider 报 skip。同样的检
      查在 `nightcrew loop` 与 `crew start` 启动时 fail-fast，避免没装或没
      订阅时白烧一次迭代。代码与 CLI 输出保持英文。Tests included.
- [ ] BACKLOG 完成项自动勾选：plan 操作在 frontmatter 里用可选 `backlog`
      字段记录该计划覆盖的 BACKLOG 条目（精确首行文本；plan review 校验
      映射）。merge 成功后由确定性 runner 代码——绝不是 agent——把 crew.md
      里对应的 `- [ ]` 勾成 `- [x]`；找不到唯一匹配就记一条 note 且不做任
      何改动。agent 对 crew.md 的写入限制保持与今天完全一致。
      Tests included.
- [ ] `pr` 合并模式：新增 `git.mergeMode: merge | pr` 配置（默认 merge，
      只增不改）。pr 模式下，门禁全绿的已完成 plan 推送 `nightcrew/<plan-id>`
      分支并用 `gh` CLI 向 base branch 开 PR（正文为 plan 标题加验收摘
      要），把 PR URL 记入 history notes，随后完成该 plan 并清理 worktree；
      push 或开 PR 失败转为 typed repair。`nightcrew doctor` 仅在配置了 pr
      模式时要求 `gh` 存在。Tests included.
- [ ] `nightcrew init --assist`：脚手架完成后跑一次只读 Codex pass，检查仓
      库并起草配置——verify profile 步骤、bootstrap 命令、baseBranch——外加
      2-3 条初始 crew.md rules。先打印草稿，操作者明确确认后才写入
      （非 TTY：只打印不写）。裸 `init` 保持离线且行为不变；fake provider
      保证该流程可测。Tests included.
