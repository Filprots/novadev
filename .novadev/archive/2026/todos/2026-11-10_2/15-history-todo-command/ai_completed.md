# ai_completed — 15-history-todo-command

**Date:** 2026-11-10
**Feature:** FEAT-0015
**Commits:** fb0170f, 772a96c

## Prompt
Retroactive record: link FEAT-0015 (novadev todo: one todo at a time, away from the repository) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `fb0170f` — 2026-10-25 novadev 0.15.0 — for tools away from the repository: `status --json`, `totest --json`, and `novadev todo list/show/addendum/cancel` (one todo at a ti…
- `772a96c` — 2026-11-04 novadev todo: a screenshot sent later joins its todo, and a todo's brief can be edited — `todo addendum` takes `attachments` (copied into the todo fo…

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
