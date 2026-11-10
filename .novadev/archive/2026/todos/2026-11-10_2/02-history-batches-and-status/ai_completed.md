# ai_completed — 02-history-batches-and-status

**Date:** 2026-11-10
**Feature:** FEAT-0002
**Commits:** bc17f04, 5c9f453, fb0170f

## Prompt
Retroactive record: link FEAT-0002 (Batches and the stock-take: novadev new and novadev status) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `bc17f04` — 2026-08-16 novadev 0.1.0 — structured development system (deploy/new/status/archive/doctor + canonical playbooks + agent adapters)
- `5c9f453` — 2026-08-19 novadev 0.2.0 — chat-initiated work rule: chat asks with no open todo must be filed as todos (prompt.md brief + ai_ record with Thinking); batch-N sc…
- `fb0170f` — 2026-10-25 novadev 0.15.0 — for tools away from the repository: `status --json`, `totest --json`, and `novadev todo list/show/addendum/cancel` (one todo at a ti…

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
