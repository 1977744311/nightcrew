---
"nightcrew": minor
---

Added the operator approval inbox. Agents now record open questions with 2-4 lettered options (one `(recommended)`, `=> backlog: ...` on options that imply code work); the console renders them as a one-click panel where answering writes the decision back and schedules marked options straight into BACKLOG, while leaving feedback makes garden redraft the options next run. New `- ` defect bullets in `qa.md` are auto-triaged by the loop (once per content state) into a pending qa-sourced proposal of fix candidates, also available on demand via `nightcrew propose --from-qa`. Agents still never write `crew.md` — every scheduled line traces to an operator click.
