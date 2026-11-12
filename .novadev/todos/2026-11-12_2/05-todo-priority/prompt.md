# prompt — todo-priority

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## Priority on every todo: urgent, high, normal, later

Board (Filipp, 2026-11-12, HQ session), on the eight proposals "robust parallel work, as big companies do it": "I want it all, sounds perfect go on! My whole company waits for it!" (before: "I want to make it really robust how big corps do it!", and: "I feel like we are going wrong way and the batch must be tackled only by a one dev or a coherent team"). Proposal 4. A todo carries a priority (`urgent|high|normal|later`, default `normal`): set when filing (`priority` in the `file-todo` payload per part; the /novadev-file-a-todo playbook asks the person only when they signalled urgency), changed with `novadev todo priority <ref> <level>` (a person's decision; recorded with who and when). `novadev status`, `status --json`, `todo list`, `sync`'s NEXT ACTIONS and the merge queue order by it (then by filing order). Stored in the todo folder in a way old todos read as `normal` with no migration.

## Context from the conversation

Why: novadev todos have no priority at all (only test scenarios have one); the order of work is whatever the lead guesses. Companies use three or four levels and sort every queue by them.

Tests: filing with and without priority; old todo reads normal; list/status order; priority change recorded; JSON carries it.

Part of one design (proposals 1–8, todos of this batch): the unit of work is the todo — one owner, one worktree, one merge request; a batch is only a group; conflicts are caught when merging (a merge queue), not by locking files in advance; todos carry priority and order. Build order: 1; then 2 with 3; then 4–8. Everything written by 0.17.0 (locks, registry entries, worktrees, batches in work) must keep reading unchanged; new settings are off when absent unless the todo says otherwise.
