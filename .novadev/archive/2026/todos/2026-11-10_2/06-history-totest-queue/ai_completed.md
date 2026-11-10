# ai_completed — 06-history-totest-queue

**Date:** 2026-11-10
**Feature:** FEAT-0006
**Commits:** 109a980, c6b3335, 72e0194, fb0170f

## Prompt
Retroactive record: link FEAT-0006 (The human-testing queue (totest)) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `109a980` — 2026-08-27 novadev 0.4.0 — human-testing queue (totest) with a non-terminal gate
- `c6b3335` — 2026-08-27 novadev 0.5.0 — one LIVING test task per feature, revised in place
- `72e0194` — 2026-08-28 novadev 0.6.0 — feature folders, namespaced archive, and version-aware migrations
- `fb0170f` — 2026-10-25 novadev 0.15.0 — for tools away from the repository: `status --json`, `totest --json`, and `novadev todo list/show/addendum/cancel` (one todo at a ti…

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
