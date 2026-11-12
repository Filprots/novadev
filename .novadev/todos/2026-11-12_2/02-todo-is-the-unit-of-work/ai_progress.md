# ai_progress — todo-is-the-unit-of-work

**Date:** 2026-11-12
**Feature:** FEAT-0014, FEAT-0019
**Commits:** 2c5c777, 4660e71 (code and tests); the docs commit and the WIP commit follow them on branch `robust-work`

## Prompt
The lock moves from the batch to the todo: `novadev work start <batch>/<todo>` locks ONE todo, its
lock and waypoints live with the todo; a batch only groups; `work start <batch>` stays for a solo
developer; `--todo` keeps working; everything 0.17.0 wrote keeps reading unchanged.

## Done (branch `robust-work`, worktree `/home/fil/_work/novadev-wt/robust`, not merged, no version bump)
- **Design.** A todo's lock is `todos/<batch>/<todo>/working.md`; its registry entry
  `<common git dir>/novadev/locks/<batch>.<todo>.json` (`unit: "todo"`, `covers: [todo]`, plus `note`,
  the first line of the newest waypoint). `work start <batch>` with no todo named takes ONE lock at
  the batch root (`todos/<batch>/working.md`, `locks/<batch>.json`) — the very file 0.17.0 wrote: a
  solo round has one trail and one pause record, and old whole-batch locks are that lock, so no
  migration. It and a todo's lock never coexist. 0.17.0 `covers:` part-locks
  (`locks/<batch>@<hash>.json`) are read, resumed, paused, claimed for and stopped as before; no
  new one is made (`--todo` now takes a lock per todo).
- `src/work.ts` (rewritten command half: `requireTarget`, `startWork` → `planStart` per lock, all or
  none; `locksOf`/`usable`/`requireLock`; `pauseWork` and `stopWork` over several locks;
  `todoHolders`, `holderNote`, `batchWorkLocks`, `lockHolding`), `src/registry.ts` (`unit`, `note`,
  `lockRef`, per-todo file names, `removeRegistryLock(root, batch, todo)`, worktree `todos`,
  `addWorktreeTodos`, claim holder kind `todo`), `src/status.ts`, `src/todo.ts` (holders),
  `src/worktree.ts` (`create --todo`, `mrTodos`, list/status, the merge's reason for a second paused
  0.17.0 part-lock), `src/lib.ts` (`batchLockFiles`, `batchIsDone`), `src/archive.ts`,
  `src/todo-filing.ts`, `src/links.ts`, `src/doctor.ts` (a todo's lock is not one of its records).
- Tests: `tests/todo-locks.test.ts` (new model, the brief's two-worktrees-pause-merge test, the solo
  whole batch end to end, the docs), `tests/old-locks.test.ts` (0.16.0/0.17.0 shapes written by hand),
  `tests/worktree-locks.test.ts` (`--todo` as a spelling), small updates in `tests/work.test.ts`,
  `tests/todo-json.test.ts`, `tests/worktree.test.ts`.
- Docs: README, `templates/skills/novadev-work.md`, `templates/skills/novadev-pause.md`,
  `templates/readmes/todos.md` + `root.md`, `src/deploy.ts` adapter text, `bin/novadev.ts` help.

## Next
1. `bun test` must be green (it was: 613 pass before the docs step; the docs step added tests).
2. Read-only comparison against IRRIS: run the live `novadev status`, `novadev worktree list`,
   `novadev sync --check`, `novadev todo list` and this worktree's
   `bun /home/fil/_work/novadev-wt/robust/bin/novadev.ts <same>` with cwd
   `/home/fil/_work/IRRIS/_ecosystem` (wrapper `/home/fil/_work/paperclip/scripts/irris-host` when a
   command needs the owner's home); diff the outputs and explain every difference. Expected
   differences: `[in work]` marks on batches that are in work only in other worktrees; a holder note
   on todo lines held by a `covers:` lock or in another worktree; the `in work — none` wording. Run
   nothing there that writes (`sync` without `--check` writes).
3. Review pass over `src/work.ts` (`startWork`/`planStart`, `pauseWork`, `stopWork`) and
   `src/status.ts` for leftovers; `grep -rn "batch's lock\|locked batch" src templates README.md`.
4. Write `ai_completed.md` (replace this file): what was done, decisions (why the batch-root file for
   the whole batch), what is left of todo `2026-11-12_2/01` (nothing in code: per-todo locks cannot
   collide, and the merge names the reason for a second paused 0.17.0 part-lock —
   `tests/old-locks.test.ts`, last test; its record is the owner's/lead's to write), the upgrade note
   for the release (below), `## Placement`.
5. Knowledge: FEAT-0014 and FEAT-0019 (`feature.md`: what it does, how it works, progress line,
   `touches:` add `tests/todo-locks.test.ts`, `tests/old-locks.test.ts`), FEAT-0002 (status per todo
   holder) and FEAT-0015 (`todo list/show` holder) if their pages describe the output; wiki
   `glossary.md` (lock, waypoint), `architecture.md` (state: where locks live), `workflows.md` (test
   count); each change with `bun bin/novadev.ts knowledge log <payload.json>`.
6. `bun bin/novadev.ts work stop 2026-11-12_2/02` (this worktree holds a 0.17.0 `covers:` lock on
   the todo, taken with the old code on purpose), then `bun bin/novadev.ts sync` until clean for
   this todo; commit; put the hashes in `**Commits:**`; sync once more.
7. Not for this todo: the version bump, `migrate-repo`, `deploy` (they refresh `.novadev/skills/`,
   CLAUDE.md and AGENTS.md from the templates), the README's *Upgrading* paragraph — the owner's
   release step.

## Upgrade note for the release (draft for the README's *Upgrading* section)
The next version changes no layout: `migrate-repo` only stamps; run `novadev deploy` after it so the
playbooks teach the new commands. The unit of work is the todo: `novadev work start <batch>/<todo>`
locks one todo, in `todos/<batch>/<todo>/working.md` (registry `locks/<batch>.<todo>.json`);
`work start <batch> --todo` is the same lock; `work start <batch>` alone still locks the whole
batch for one developer, as before. Locks and registry entries written by 0.17.0 and earlier —
whole-batch and `covers:` — keep working until they are stopped. `status`, `status --json`
(`batches[].todos[].holder`, `inWorkElsewhere`; `inWork` entries gain `ref` and `unit`), `todo list`
and `todo show` say per todo who holds it. `worktree create --todo <ref>`; the merge request names
its todos.

## Placement
nothing new placed outside the modules named above; new test files `tests/todo-locks.test.ts`,
`tests/old-locks.test.ts`.

## Open questions for the owner
- A lock on the whole batch counts as how many todos for the work-in-progress limit (todo 09)?
  Recommended: every unfinished todo of the batch (`todoHolders` already answers per todo).
- `worktree create --todo` on a todo that is another worktree's task is said, not refused (the
  todo's lock is the gate). Recommended: keep it a notice.
