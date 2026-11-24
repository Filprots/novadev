# ai_completed — todo-priority

**Date:** 2026-11-12
**Feature:** FEAT-0020
**Commits:** 6d3e6d3, 3db7c9f

## Prompt
A priority on every todo (urgent, high, normal, later), set when filing and changed on a decision, ordering every list.

## What I did
- `todo.json` per todo (`priority`, `history`); `priority` per part when filing; `novadev todo priority <ref> <level>`; `todo list`, `status`, `status --json` and sync's NEXT ACTIONS ordered by it.
- The board's answer 1: the lead (`"lead"` in novadev.json) may change a priority too, with a required reason, recorded `"as": "lead"`; any other agent is refused.
- `novadev todo priority --changed-since <date> [--by-agent] [--json]` for the morning digest.

## Placement
New modules `src/todo-meta.ts`, `src/lead.ts` (neither imports `src/todo.ts`). No hubs are configured.

## Verification
- `tests/todo-priority.test.ts` and the priority tests in `tests/docs.test.ts`; full suite 717 pass.
- IRRIS, read-only: `todo list` and `status` text identical (no todo there has a priority yet); JSON gains `priority`, `after`, `waitsFor`, `ready`.
