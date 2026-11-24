# prompt — merge-refuses-second-paused-part

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## Merging a worktree refuses a branch that would put a second paused part-lock of the same batch on the default branch

Board (Filipp, 2026-11-12), answering the open question after batch 2026-11-12_1: "yess" to the proposal "the merge refuses that, so each part stops before its merge" (two paused parts of one batch, both merged, would land two progress files for one batch on the main branch).

## Context from the conversation

Since 2026-11-12_1/03 (`novadev work start <batch> --todo <nn>`), two worktrees can each lock a different part of one batch. Each writes its lock to the same path, `todos/<batch>/working.md`, on its own branch, with a `covers:` line naming its todos; the registry keeps them apart (`locks/<batch>@<hash>.json`). If both parts are paused (not stopped) and both branches are merged with `novadev worktree merge`, the default branch gets two different versions of the one working.md: a conflict, or one part's waypoint silently replacing the other's, so `novadev status` and the next `work start` resume the wrong part.

Wanted: `novadev worktree merge` (and the merge rules, if they touch working.md) refuses a branch whose `todos/<batch>/working.md` is a part-lock (has `covers:`) that is not stopped when the default branch — or another branch in the same merge — already holds a working.md for that batch; the message says to `novadev work stop` (or finish) that part before merging. A part whose todos are all recorded and stopped merges as today. Check first what 0.16.0's rule "only a working lock the branch added blocks a merge" already covers, and close only the gap.

Test: two worktrees, parts 01 and 02 of one batch, both paused; merging the first passes; merging the second is refused with that message; after `work stop` in the second worktree it merges, and `novadev status` on the default branch shows the remaining paused part correctly.
