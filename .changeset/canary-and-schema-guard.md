---
"nightcrew": minor
---

Added the scheduled canary and structured-output schema guards, closing the gap where code whose correctness depends on live external systems passed every fake-provider test and still broke in production (as `init --assist` did). `canary.profile` points at a verify profile that the loop and `crew` daemon now run in the project root — outside any agent sandbox — at most once per `canary.everyHours`; a failing step is appended to `qa.md` (deduped) where overnight triage drafts fix candidates, and fires the new `canary_failed` notify event without ever blocking the loop. Output schemas handed to providers are now validated against OpenAI structured-output constraints: the fake provider rejects violating schemas exactly like the real API (`invalid_json_schema`), so any test that exercises a bad schema goes red before the first paid call.
