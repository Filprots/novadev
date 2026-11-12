# prompt — todo-is-the-unit-of-work

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## The lock moves from the batch to the todo: one todo, one owner, one worktree, one merge request

Board (Filipp, 2026-11-12, HQ session), on the eight proposals "robust parallel work, as big companies do it": "I want it all, sounds perfect go on! My whole company waits for it!" (before: "I want to make it really robust how big corps do it!", and: "I feel like we are going wrong way and the batch must be tackled only by a one dev or a coherent team"). Proposal 1. `novadev work start <batch>/<todo>` (and the todo ref forms `novadev todo` accepts) locks ONE todo; its lock and waypoint live with the todo (e.g. `todos/<batch>/<todo>/working.md`), so two developers on two todos of one batch never write the same file, on any branch. The batch is a group: `novadev status`, `sync` and `todo list` show per todo who holds it and where it stopped; a batch is "in work" while any of its todos is. `work start <batch>` stays for a solo developer who takes the whole batch (it locks every open todo of it, as one round); `--todo` from 0.17.0 keeps working as a spelling of the same thing. `work waypoint|pause|stop|claim`, the registry (`locks/`), `worktree create|gate|mr|merge`, team mode and the playbooks (/novadev-work, /novadev-pause) follow: a worktree is made for a todo, its MR names the todo. This makes todo `2026-11-12_2/01-merge-refuses-second-paused-part` unnecessary where the per-todo lock file removes the collision — say in its record what is left of it, if anything.

## Context from the conversation

Why: a batch is a filing unit ("what the owner said in one conversation"), not a work unit; locking it made unrelated todos travel together and forced the `--todo` patch of 0.17.0 (partial locks, `covers:`, `locks/<batch>@<hash>.json`). In companies the unit is one small ticket with one owner, one branch, one pull request; an epic or sprint only groups.

Tests: two worktrees lock todos 01 and 02 of one batch, pause both, merge both — no conflict, status shows both waypoints; a 0.16.0/0.17.0 whole-batch lock and a `covers:` lock still read, resume and stop; `work start <batch>` solo still works end to end.

Part of one design (proposals 1–8, todos of this batch): the unit of work is the todo — one owner, one worktree, one merge request; a batch is only a group; conflicts are caught when merging (a merge queue), not by locking files in advance; todos carry priority and order. Build order: 1; then 2 with 3; then 4–8. Everything written by 0.17.0 (locks, registry entries, worktrees, batches in work) must keep reading unchanged; new settings are off when absent unless the todo says otherwise.
