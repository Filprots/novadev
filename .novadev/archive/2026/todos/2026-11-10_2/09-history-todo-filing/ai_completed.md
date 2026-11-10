# ai_completed — 09-history-todo-filing

**Date:** 2026-11-10
**Feature:** FEAT-0009
**Commits:** 5c9f453, dc73f7e, 6655fee

## Prompt
Retroactive record: link FEAT-0009 (Filing a todo from chat) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `5c9f453` — 2026-08-19 novadev 0.2.0 — chat-initiated work rule: chat asks with no open todo must be filed as todos (prompt.md brief + ai_ record with Thinking); batch-N sc…
- `dc73f7e` — 2026-09-09 novadev 0.9.0 — four novadev-* skills: the loop, plus the human's three entry points
- `6655fee` — 2026-10-25 novadev 0.14.0 — the work lock: working.md, `novadev work start/waypoint/pause/stop`, the /novadev-pause playbook, "in work" in status and sync

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
