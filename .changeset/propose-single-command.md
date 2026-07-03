---
"nightcrew": major
---

The `propose list/review/refine/select` subcommands collapsed into flags on the one `propose` command: bare `nightcrew propose` lists pending proposals and reopens the latest picker (was `list` + `review`), `--proposal <id-or-file>` targets a specific pending proposal, `--ids 1,3` ratifies non-interactively (was `select`), and `--feedback "<text>"` regenerates (was `refine`).
