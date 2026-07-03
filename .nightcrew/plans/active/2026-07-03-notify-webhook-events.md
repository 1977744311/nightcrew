---
id: 2026-07-03-notify-webhook-events
title: Add notify webhook events
created: 2026-07-03
parallel: false
---

## Goal
Close the operator notification seam by adding an additive `notify` config surface and deterministic webhook delivery for loop stop reasons, newly appended open questions, and landed pending proposals, so unattended runs can alert the operator without relying on model behavior or blocking the loop when delivery fails.

## Acceptance
- [ ] `notify.webhook` and optional event filtering parse through config and generated schema without changing existing config keys or defaults.
- [ ] Loop typed stops, new open-question appends, and pending proposal landings enqueue one compact JSON POST with project name, landed/failed/open-question/pending-proposal counts, and console address hint.
- [ ] Webhook delivery is deterministic runtime code only, never calls a provider/model, and failed POSTs emit a warning without changing loop/proposal success or failure outcomes.
- [ ] Tests cover config parsing/defaults, event filtering, all required trigger points, payload shape, and warning-only behavior on push failure.
- [ ] `CHANGELOG.md` is updated under `## Unreleased`.

## Steps
1. Inspect the config schema, generated schema workflow, loop stop handling, question append path, proposal landing path, report/count helpers, and runtime logging style.
2. Add the additive `notify` config model with `webhook` URL and optional event filter, update defaults, schema generation, and config tests.
3. Implement a small deterministic notification helper that builds the compact payload, computes project counts, POSTs when enabled, and logs warnings on delivery errors.
4. Wire the helper into typed loop stops, open-question appends, and proposal landing flows without changing their existing control flow semantics.
5. Add focused unit tests for payloads, filtering, trigger integration, and failed delivery, then update `CHANGELOG.md`.
