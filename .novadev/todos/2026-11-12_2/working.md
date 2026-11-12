---
state: paused
agent: claude-code/claude-fable-5-2
host: irrisketch-server-1
pid: 1278642
session: 424a0828-ab62-4356-950f-edee62252655
started: 2026-11-12T13:32:28+01:00
updated: 2026-11-12T14:05:35+01:00
todo: 02-todo-is-the-unit-of-work
phase: 4
covers: 02-todo-is-the-unit-of-work
---

# Working — 2026-11-12_2

<!-- The batch's LOCK, managed by `novadev work`: an agent is working this batch, or paused in it.
     Newest entry first — the top section is where the work resumes. Never edit it by hand:
     `novadev work waypoint` and `/novadev-pause` write it, `novadev work stop` removes it. -->

## PAUSED — waypoint 3 — 2026-11-12 14:05 · 02-todo-is-the-unit-of-work · phase 4 RECORD

**By:** claude-code/claude-fable-5-2 on irrisketch-server-1

**Tree at the pause:** branch `robust-work`, HEAD `6ed4bcc` — 2 uncommitted path(s):
- `??` .novadev/todos/2026-11-12_2/02-todo-is-the-unit-of-work/ai_progress.md
- `??` .novadev/todos/2026-11-12_2/working.md

### Stopped at

Paused on the owner's word, between the docs commit (6ed4bcc) and the verification/record steps. Code, tests and docs of todo 02 are committed on branch robust-work (2c5c777, 4660e71, 6ed4bcc); `bun test` was green on that state: 625 pass, 0 fail. Nothing is half-written. Not done yet: the read-only comparison against the real IRRIS state, a last review pass over src/work.ts, the ai_completed.md record, the feature pages (FEAT-0014, FEAT-0019), the wiki, the knowledge log, the stop of this lock and the clean sync.

### Next

1. Read .novadev/todos/2026-11-12_2/02-todo-is-the-unit-of-work/ai_progress.md: its Next list (7 steps) is the plan, in order.
2. Run `bun test` in /home/fil/_work/novadev-wt/robust (expect 625 pass, 0 fail).
3. Do the read-only IRRIS comparison (live `novadev status|worktree list|todo list|sync --check` against `bun /home/fil/_work/novadev-wt/robust/bin/novadev.ts <same>` with cwd /home/fil/_work/IRRIS/_ecosystem) and explain every difference.
4. Write ai_completed.md (replacing ai_progress.md), update FEAT-0014 and FEAT-0019 and the wiki, record each change with `bun bin/novadev.ts knowledge log`.
5. `bun bin/novadev.ts work stop 2026-11-12_2/02`, `bun bin/novadev.ts sync` until clean for this todo, commit, put the hashes into **Commits:**, sync once more.

### Done

2c5c777 feat (per-todo locks, registry, status/todo/worktree), 4660e71 test (old shapes by hand), 6ed4bcc docs (README, playbooks, folder READMEs, adapters, CLI help). ai_progress.md written for the todo.

### To resume

Work only in /home/fil/_work/novadev-wt/robust (branch robust-work); never write in /home/fil/_work/novadev (the live clone). Run this worktree's CLI as `bun /home/fil/_work/novadev-wt/robust/bin/novadev.ts …`, never the bare `novadev`, for bookkeeping here. This lock is a 0.17.0 `covers:` lock at the batch root (taken with the old code on purpose): `bun bin/novadev.ts work start 2026-11-12_2/02 --agent <actor>` resumes it. No push, no merge, no version bump, no deploy.

### Open

For the owner: (1) does a lock on a whole batch count as every unfinished todo of it for the work-in-progress limit of todo 09 — recommended yes; (2) `worktree create --todo` on a todo that is already another worktree's task is said, not refused — recommended to keep it a notice. The other agent's branch (todos 05, 06, 08) touches src/todo.ts, src/status.ts and startWork in src/work.ts: expect small merge conflicts there and in tests/todo-json.test.ts.

### Todos at the pause

- · 01-merge-refuses-second-paused-part — open
- … 02-todo-is-the-unit-of-work — progress
- · 03-claims-warn-protected-paths-lock — open
- · 04-merge-queue — open
- · 05-todo-priority — open
- · 06-todo-after-links — open
- · 07-express-lane-for-urgent — open
- · 08-area-owners — open
- · 09-work-in-progress-limit — open

## Waypoint 2 — 2026-11-12 13:59 · 02-todo-is-the-unit-of-work · phase 3 WORK

Code and tests landed: 2c5c777 (per-todo locks, registry, status/todo/worktree) and the old-shape regression tests (tests/old-locks.test.ts). Full suite green. Next: README, playbooks (templates/skills/novadev-work.md, novadev-pause.md), folder READMEs, deploy.ts adapter text, CLI help, docs tests; then the record, features, wiki, knowledge log, sync; then the read-only IRRIS comparison.

## Waypoint 1 — 2026-11-12 13:35 · 02-todo-is-the-unit-of-work · phase 2 PLAN

Plan settled. A todo's lock is todos/<batch>/<todo>/working.md (registry: locks/<batch>.<todo>.json, unit todo, covers [todo]). `work start <batch>` with no todo named keeps writing the batch-root working.md + locks/<batch>.json exactly as 0.17.0 (one round, one trail) and collides with every todo lock of the batch; 0.17.0 `covers:` locks stay readable and operable, never written new. Batch-addressed waypoint/pause/stop act on this worktree's locks of the batch. Next: registry.ts, work.ts, then status/todo/worktree, tests, docs.
