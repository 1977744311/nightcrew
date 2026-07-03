---
"nightcrew": minor
---

`nightcrew propose` now runs a single balanced research pass by default, turning a goal into 1-3 ready-to-ratify BACKLOG candidates without cross-lens duplicates. The three competing research lenses (minimal / architecture-first / risk-first) move behind a new `--lenses` flag, and `propose refine` reruns whatever passes produced the source artifact.
