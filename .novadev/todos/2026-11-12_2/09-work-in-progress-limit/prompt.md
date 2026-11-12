# prompt — work-in-progress-limit

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## A limit on work in progress per developer

Board (Filipp, 2026-11-12, HQ session), on the eight proposals "robust parallel work, as big companies do it": "I want it all, sounds perfect go on! My whole company waits for it!" (before: "I want to make it really robust how big corps do it!", and: "I feel like we are going wrong way and the batch must be tackled only by a one dev or a coherent team"). Proposal 8. A setting `wipLimit` (project `novadev.json`, default off; suggested 2): one holder (the lock's holder identity novadev already records) may have at most N todos started and not yet merged-or-completed; paused todos count unless `wipCountsPaused: false`. `work start` on one more is refused, naming what they hold and how to free a slot (finish and hand to review, or stop). Urgent todos are exempt (proposal 6). `status` shows each holder's count against the limit.

## Context from the conversation

Why: an agent that starts a fourth task before finishing the first leaves half-done branches that go stale and conflict; companies cap work in progress so work is finished before more is started. Needs proposal 1 (the lock is per todo, so "how many todos does this holder have" is countable).

Tests: refusal at the limit with the list; slot freed by completion/merge; paused counting both ways; urgent exempt; off by default.

Part of one design (proposals 1–8, todos of this batch): the unit of work is the todo — one owner, one worktree, one merge request; a batch is only a group; conflicts are caught when merging (a merge queue), not by locking files in advance; todos carry priority and order. Build order: 1; then 2 with 3; then 4–8. Everything written by 0.17.0 (locks, registry entries, worktrees, batches in work) must keep reading unchanged; new settings are off when absent unless the todo says otherwise.
