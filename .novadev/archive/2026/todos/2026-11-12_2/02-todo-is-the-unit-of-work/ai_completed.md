# ai_completed — todo-is-the-unit-of-work

**Date:** 2026-11-12
**Feature:** FEAT-0014, FEAT-0019
**Commits:** 2c5c777, 4660e71, 6ed4bcc

## Prompt
The lock moves from the batch to the todo: `novadev work start <batch>/<todo>` locks ONE todo, its
lock and waypoints live with the todo; a batch only groups; `work start <batch>` stays for a solo
developer; `--todo` keeps working; everything 0.17.0 wrote keeps reading unchanged.

## What I did
- **The todo's lock.** `todos/<batch>/<todo>/working.md`; registry entry
  `<common git dir>/novadev/locks/<batch>.<todo>.json` (`unit: "todo"`, `covers: [todo]`, and `note`,
  the first line of the newest waypoint). `work start <batch>/<todo>` and `work start <batch> --todo`
  take one lock per todo, all or none (`startWork` → `planStart` judges every lock before the first
  write). Batch-addressed `waypoint | pause | stop | claim` act on this worktree's locks in that batch;
  with several, a waypoint or claim must name its todo, a pause writes the same record to every
  working lock, a stop releases them all.
- **The whole batch, for one developer.** `work start <batch>` with no todo takes ONE lock at the
  batch root (`todos/<batch>/working.md`, `locks/<batch>.json`) — the file 0.17.0 wrote. It and a
  todo's lock never hold the same todo.
- **Old locks.** 0.16.0/0.17.0 whole-batch locks are that batch-root lock; 0.17.0 `covers:` part-locks
  (`locks/<batch>@<hash>.json`) are read, resumed, paused, claimed for and stopped as before — no new
  one is made. No migration.
- **Who holds what.** `todoHolders` / `holderNote` (work.ts) answer per todo; `status`, `status --json`
  (`batches[].todos[].holder`, `batches[].inWorkElsewhere`; `inWork` entries gain `ref` and `unit`),
  `todo list` and `todo show` say it.
- **Worktrees.** `worktree create --todo <ref>` records the worktree's todos (a todo that is another
  worktree's task is a notice, not a refusal — the board's answer 6: the todo's lock is the gate);
  todos started in a worktree are added to it; `worktree mr` opens with `Todo:` lines; the merge
  names the reason when a second paused 0.17.0 part-lock stands in its way.
- Files: `src/work.ts`, `src/registry.ts`, `src/status.ts`, `src/todo.ts`, `src/worktree.ts`,
  `src/lib.ts` (`batchLockFiles`, `batchIsDone`), `src/archive.ts`, `src/todo-filing.ts`,
  `src/links.ts`, `src/doctor.ts`; docs in README, both playbooks, the folder READMEs, the adapter
  text (`src/deploy.ts`) and the CLI help.

## Decisions
- **The batch-root file for a whole-batch start**, not one lock per todo: a solo round keeps one
  trail and one pause record, and every lock 0.17.0 wrote is already that lock — nothing to migrate.
- **Todo `2026-11-12_2/01` (merge refuses a second paused part) needs no code of its own:** per-todo
  locks are separate files and cannot collide at a merge; for 0.17.0 part-locks the merge names the
  reason (`tests/old-locks.test.ts`, last test). Its record is the lead's to write.
- The work-in-progress limit (todo 09) will count a whole-batch lock as every unfinished todo of the
  batch (the board's answer 5); `todoHolders` already answers per todo.

## Placement
Nothing new outside the modules above; new test files `tests/todo-locks.test.ts`,
`tests/old-locks.test.ts`. `src/work.ts` 1081 → 1458 lines. No hubs are configured in this project.

## Verification
- `bun test`: 625 pass, 0 fail (33 files), on 6ed4bcc and again on 2026-11-12 before this record.
- `tests/todo-locks.test.ts` — the new model, the brief's test (two worktrees, two todos of one
  batch, one pauses, the other merges), the solo whole batch end to end, the docs.
  `tests/old-locks.test.ts` — locks and registry entries of 0.16.0/0.17.0 written by hand: read,
  resume, pause, stop, gate, merge.
- **Against the real IRRIS state, read-only** (cwd `~/_work/IRRIS/_ecosystem`, 2026-11-12, 117 batches,
  693 todos, 2 worktrees): live 0.17.0 vs this branch for `status`, `worktree list`, `todo list`,
  `sync --check`, `status --json`. `worktree list`, `todo list`, `sync --check`: identical. `status`:
  one line, the wording of "in work — none". `status --json`: only added keys — `holder` on each of
  the 693 todos, `inWorkElsewhere` on each of the 117 batches. IRRIS's tree was unchanged after.
  No IRRIS lock was live at that moment, so the old shapes were exercised by the hand-written tests
  only — and by this todo's own lock, a 0.17.0 `covers:` lock taken with the old code, resumed and
  stopped with the new.
- Review pass over `startWork`/`planStart`, `pauseWork`, `stopWork`, `status.ts`: no leftover of the
  batch-as-unit wording or logic found.

## For the release (the owner's step, not done here)
No layout change: `migrate-repo` only stamps; `novadev deploy` after it so the playbooks teach the new
commands. README *Upgrading* paragraph: the unit of work is the todo — `novadev work start
<batch>/<todo>` locks one todo in `todos/<batch>/<todo>/working.md` (registry
`locks/<batch>.<todo>.json`); `work start <batch> --todo` is the same lock; `work start <batch>` alone
still locks the whole batch for one developer. Locks written by 0.17.0 and earlier keep working until
they are stopped. `status`, `status --json`, `todo list`, `todo show` say per todo who holds it;
`worktree create --todo <ref>`; the merge request names its todos.
