# prompt — merge-queue

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## A merge queue: approved merge requests line up, each is merged onto the newest default branch and checked there

Board (Filipp, 2026-11-12, HQ session), on the eight proposals "robust parallel work, as big companies do it": "I want it all, sounds perfect go on! My whole company waits for it!" (before: "I want to make it really robust how big corps do it!", and: "I feel like we are going wrong way and the batch must be tackled only by a one dev or a coherent team"). Proposal 3. `novadev worktree queue add <name>` (the lead, after approval), `queue list`, `queue run` (and `queue remove`): the queue is ordered (first in, first out; priority and the express lane come with proposals 4 and 6); `run` takes the head, brings it onto the current default branches (all repos of the worktree, all-or-nothing as `worktree merge` is today), runs the gate and the project's gate commands ON THE MERGED RESULT, and only if they pass lands it (then `sync --after-merge`); a failure or a conflict lands nothing, marks the entry failed with the reason, and the queue goes on to the next one. The failed one goes back to its builder (`worktree sync`, fix, re-queue). One merge at a time (a queue lock every worktree sees). `worktree merge` stays as the direct form and uses the same checks. Queue state lives where every worktree sees it (the common git dir, like the registry) and is shown by `status`.

## Context from the conversation

Why: with claims as notices (proposal 2), two branches can change the same or coupled files; each passed its gate alone, but the combination was never tested. Companies solve this with a merge queue / bors-style "test the merge result, then land". Today `worktree merge` checks conflicts (merge-tree) but runs no checks on the merged tree.

Tests: two queued branches that each pass alone and conflict → first lands, second fails with nothing merged and the queue continues; two that merge cleanly but break a gate command together → second refused; a failure in a late repo of a multi-repo worktree undoes the earlier repos.

Part of one design (proposals 1–8, todos of this batch): the unit of work is the todo — one owner, one worktree, one merge request; a batch is only a group; conflicts are caught when merging (a merge queue), not by locking files in advance; todos carry priority and order. Build order: 1; then 2 with 3; then 4–8. Everything written by 0.17.0 (locks, registry entries, worktrees, batches in work) must keep reading unchanged; new settings are off when absent unless the todo says otherwise.
