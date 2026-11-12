# ai_completed — express-lane-for-urgent

**Date:** 2026-11-12
**Feature:** FEAT-0023, FEAT-0022
**Commits:** f2904df

## Prompt
An urgent todo jumps the merge queue, is exempt from the work-in-progress limit, pauses what its holder was in, and skips no check.

## What I did
- `work start` on an urgent todo at the limit: every lock its holder is working on in this worktree is paused first, with a record ("Paused for the urgent todo …", how to resume); the answer has `expressLane` (`paused`, `stillInWorkElsewhere`).
- `worktree queue add` puts a worktree with an urgent todo in the express lane by itself — behind other express entries, ahead of the rest; `--express` is the lead's hand-set form.
- `status` lists the urgent todo first and names who was paused for it.

## Decisions
- Only locks in THIS worktree are paused: a lock in another worktree is on another branch and cannot be written from here; it is named so it is paused there.
- Nothing is paused below the limit.

## Placement
In `src/work.ts` (`wipCheck`, `pauseForUrgent`) and `queueAdd` in `src/worktree.ts`; counting in `src/wip.ts`. No hubs are configured.

## Verification
- `tests/wip-and-express.test.ts` › the express lane (2 tests): the brief's three — the urgent entry overtakes queued normal ones; an urgent start at the limit pauses the current todo with a waypoint; the gate still refuses a bad urgent branch.
