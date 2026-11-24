# ai_completed — merge-queue

**Date:** 2026-11-12
**Feature:** FEAT-0022, FEAT-0019
**Commits:** 9865cb7, 9c808c6

## Prompt
`novadev worktree queue add|list|run|remove`: each approved branch is brought onto the newest default branches, checked there, and only then landed; a failure lands nothing and the queue goes on; one merge at a time; `worktree merge` uses the same checks.

## What I did
- `src/queue.ts`: `queue.json` and `queue.lock` in the common git dir; FIFO with an express lane.
- `landWorktree` (`src/worktree.ts`): dry run of every merge → default branches merged into the branch in its worktree → the gate there → re-check that no default branch moved → the merges (sub-repos first, undone together on a late failure) → `sync --after-merge`.
- `queueRun` marks a failed entry with its reason and goes on; exit 1 when any failed.
- `worktree merge --yes` holds the same lock and runs the same procedure — a behaviour change for 0.17.0 users: it now syncs the worktree and runs the gate before landing.
- `status`, `status --json` (`mergeQueue`), `worktree list --json` (`queue`).

## Decisions
- The merged result is checked in the builder's own worktree (the default branches merged into the branch), not in a temporary checkout: it has the project's links and shared folders, and with one merge at a time the tree that passed is the tree that lands.
- **After the independent review (2026-11-12):** the branch tips are pinned before the gate and the merges take those commits — a commit added while the checks ran fails the entry (it was a way for unchecked code to land); a main checkout that is not ready stops the run without failing entries; every change of `queue.json` is one locked, atomic step (`updateQueue`); a dead merge lock is taken over by one command only.

## Placement
New module `src/queue.ts` (state and lock only); the commands in `src/worktree.ts`, beside the merge they share. No hubs are configured.

## Verification
- `tests/claims-and-queue.test.ts` › the merge queue (5 tests): the brief's three — two that conflict (first lands, second fails, queue continues, fixed and re-queued it lands); two that merge cleanly but break a gate command together (second refused, nothing of it lands, the sub-repo neither); a failure late in the project undoes the sub-repo — plus add/list/remove and the one-at-a-time lock (live refuses, dead is taken over).
