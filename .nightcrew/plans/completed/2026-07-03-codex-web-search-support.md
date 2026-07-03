---
id: 2026-07-03-codex-web-search-support
title: Add Codex web search controls
created: 2026-07-03
parallel: false
---

## Goal
Close the Codex provider web-search seam by making the SDK search mode explicit in config, overridable for proposal generation, and reflected in proposal research prompts when outside ecosystem context matters; this is the only remaining authorized backlog item not already covered by an existing plan.

## Acceptance
- [x] `provider.codex.webSearch` accepts `disabled`, `cached`, or `live`, defaults to `cached`, and existing configs continue to parse.
- [x] Per-operation web-search overrides resolve at least for `propose`, and the Codex adapter passes the resolved value as SDK `ThreadOptions.webSearchMode` without changing the fake provider contract.
- [x] Proposal research prompts instruct external-ecosystem goals to search first and cite 1-2 references in candidate rationales while preserving the structured output contract.
- [x] Tests cover config parsing/defaults, override resolution, adapter option passing, prompt guidance, and the `CHANGELOG.md` Unreleased entry.

## Steps
1. Inspect the config schema, Codex adapter thread option construction, proposal prompt builder, and existing tests around provider routing.
2. Add additive config types and schema defaults for `provider.codex.webSearch` plus a per-operation override map that includes `propose`.
3. Resolve the web-search mode for provider calls and pass it through to the Codex SDK `ThreadOptions`, leaving fake-provider behavior unchanged.
4. Extend the propose research prompt with external-ecosystem web-search and citation guidance inside candidate rationales.
5. Add focused tests for parsing, defaults, overrides, adapter option passing, and prompt text, then update `CHANGELOG.md` under `## Unreleased`.
