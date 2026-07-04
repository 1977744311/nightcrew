---
"nightcrew": patch
---

Merge commits now fall back to the built-in agent identity when git has no user configured (same fallback the commit paths already had), so plan landings work on CI runners and fresh machines instead of failing as merge conflicts.
