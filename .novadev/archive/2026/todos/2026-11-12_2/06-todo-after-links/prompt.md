# prompt — todo-after-links

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## "Do after" links between todos

Board (Filipp, 2026-11-12, HQ session), on the eight proposals "robust parallel work, as big companies do it": "I want it all, sounds perfect go on! My whole company waits for it!" (before: "I want to make it really robust how big corps do it!", and: "I feel like we are going wrong way and the batch must be tackled only by a one dev or a coherent team"). Proposal 5. A todo can name the todos it waits for (`after: [<ref>…]`, in the filing payload and via `novadev todo after <ref> <ref…>` / `--clear`): `work start` on it is refused while any of them is not completed (in team mode: approved and merged), naming them; `status` / `todo list` show "ready" and "waits for …"; `sync` and `doctor` flag a link to a todo that does not exist, was cancelled, or a cycle. Refs across batches work; a link to an archived completed todo counts as satisfied.

## Context from the conversation

Why: order between todos lives only in the brief text today ("stage 3 after stage 2"), so a lead handing todos to several developers can start one too early. Companies link tickets ("blocked by") and show what is ready.

Tests: start refused then allowed after the first completes; cycle and dangling link flagged; archived dependency satisfied; JSON carries the links and the ready flag.

Part of one design (proposals 1–8, todos of this batch): the unit of work is the todo — one owner, one worktree, one merge request; a batch is only a group; conflicts are caught when merging (a merge queue), not by locking files in advance; todos carry priority and order. Build order: 1; then 2 with 3; then 4–8. Everything written by 0.17.0 (locks, registry entries, worktrees, batches in work) must keep reading unchanged; new settings are off when absent unless the todo says otherwise.
