# ai_completed — merge-refuses-second-paused-part

**Date:** 2026-11-12
**Feature:** FEAT-0019
**Commits:** 2c5c777, 4660e71

## Prompt
The merge refuses a branch that would put a second paused part-lock of one batch on the default branch.

## What I did
- Made unnecessary for new work by todo 02: a todo's lock is its own file (`todos/<batch>/<todo>/working.md`), so two paused todos of one batch never meet at a merge.
- For locks 0.17.0 wrote (`covers:` at the batch root) `novadev worktree merge` names the reason and merges nothing: "carries a paused lock on part of a batch … two parts of one batch share that one file" (`tryMerge`, built in 2c5c777).

## Placement
No new code placed: the refusal lives in `tryMerge` (`src/worktree.ts`), built with todo 02.

## Verification
- `tests/old-locks.test.ts`, last test: two 0.17.0 part-locks, both paused, the second merge is refused with that reason and nothing merged.
- `tests/todo-locks.test.ts`: two worktrees, two todos of one batch, one pauses, the other merges.
