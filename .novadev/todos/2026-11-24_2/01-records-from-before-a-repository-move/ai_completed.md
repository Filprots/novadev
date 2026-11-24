# ai_completed — records-from-before-a-repository-move

**Date:** 2026-11-24
**Feature:** FEAT-0016
**Commits:** 6c0deb1

## Prompt
A project that moved repositories: its old records' commits ("is not in this repository's history") and its `**Repos:**` lines ("is not a sub-repo") flood sync's NEXT ACTIONS — 1,455 of 1,594 in IRRISketch (the board: "yes clean them! there is too much").

## What I did
- `"commitsSince": "<day>"` in novadev.json: the day from which the records' commits are in this repository. A record dated before it (its `**Date:**`, else its batch's day) is not asked for its commits nor for its `**Repos:**` names; a later record is asked as always. A value that is no day is a problem.
- An empty `"subrepos": []` now means "this project has no sub-repos": a `**Repos:**` line is free text and is not judged. A project that never set the key (or set null) is told as before.
- README (*Sub-repos*, the Upgrading note), tests.

## Placement
nothing new placed — a parser and a flag in `src/subrepos.ts` (the module that says where a record's commits live), eight lines in the link audit (`src/links.ts`). No hubs are configured.

## Verification
- `tests/subrepos.test.ts`: four new tests (every record asked without the settings; the day itself counts as "since"; a missing commit after the day is still named; the empty list against a missing or null one; a value that is no day). `tests/docs.test.ts`: the README's example is read by the real parser.
- Full suite: 767 pass, 0 fail.
- On a throw-away worktree of the real IRRISketch tree with `"commitsSince": "2026-11-18"` (its `"subrepos": []` was there already): `sync --check` lists 134 NEXT ACTIONS in place of 1,594 — no `**Repos:**` note, no missing-commit note.

## Decisions
- **A day, not a list of exempt records**, as `placementSince` does: one line a person can read, and a record written after the move is still checked.
- **The empty list is the statement.** A missing `"subrepos"` cannot tell "has none" from "never thought about it"; `[]` is written on purpose (neither deploy nor migrate-repo writes the key).
- **No migration and no version change**: both are opt-in settings.
