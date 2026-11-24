# ai_completed — todo-after-links

**Date:** 2026-11-12
**Feature:** FEAT-0020
**Commits:** 95d5825, 29f4f89

## Prompt
"Do after" links between todos: `work start` refuses a todo that still waits; the lists say ready / waits for.

## What I did
- `after` in the filing payload; `novadev todo after <ref> <ref…>` / `--clear`, recorded in `todo.json` history.
- `work start` refuses a waiting todo, no override flag (the board's answer 2); judged once per start for all the todos it takes, so two started together may depend on each other.
- sync and doctor: a link to no todo or a cycle is a PROBLEM; a link to a cancelled todo a NEXT ACTION (the board's answer 3).

## Placement
New module `src/todo-links.ts` (never imports `src/todo.ts`). No hubs are configured.

## Verification
- `tests/todo-links.test.ts`; full suite 717 pass after the merge with the per-todo locks.
