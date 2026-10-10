---
"nightcrew": minor
---

`nightcrew report` now opens with the shape of the night. A one-line verdict ("Clean shift — 3 plans landed, nothing broke.") sits above a shift strip: a token-burn sparkline over one outcome mark per time cell — `◆` landed, `✗` failed, `◐` quota, `●` ok, `○` idle, `·` off the clock — with the first and last iteration times and total crew time underneath. Cells are proportional to wall-clock time, so a quota wait or a 3am failure cluster shows up as exactly that, and a landing is never hidden by the failure that starts next to it. The strip shrinks to narrow terminals, and its data ships additively as `timeline` in `report --json`. Times are UTC, like the rest of the CLI.
