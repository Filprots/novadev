# prompt — express-lane-for-urgent

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## An express lane: an urgent todo jumps the queue and may pause running work

Board (Filipp, 2026-11-12, HQ session), on the eight proposals "robust parallel work, as big companies do it": "I want it all, sounds perfect go on! My whole company waits for it!" (before: "I want to make it really robust how big corps do it!", and: "I feel like we are going wrong way and the batch must be tackled only by a one dev or a coherent team"). Proposal 6. An `urgent` todo (proposal 4) goes to the head of the merge queue (proposal 3) behind other urgent ones, and is exempt from the work-in-progress limit (proposal 8): a developer at the limit may start it, and `work start` then offers/does a pause of the todo they are in (the existing pause, with its waypoint) so nothing is left locked without a resume point. It skips NO check: the gate, the review and the queue's merged-result checks all still run. `status` shows an urgent todo first, with who was paused for it.

## Context from the conversation

Why: a production bug must not wait behind normal work, and must not tempt anyone to bypass the gate. Companies have an expedite lane with the same quality bar.

Tests: urgent entry overtakes queued normal ones; urgent start at the WIP limit pauses the current todo with a waypoint; the gate still refuses a bad urgent branch.

Part of one design (proposals 1–8, todos of this batch): the unit of work is the todo — one owner, one worktree, one merge request; a batch is only a group; conflicts are caught when merging (a merge queue), not by locking files in advance; todos carry priority and order. Build order: 1; then 2 with 3; then 4–8. Everything written by 0.17.0 (locks, registry entries, worktrees, batches in work) must keep reading unchanged; new settings are off when absent unless the todo says otherwise.
