---
type: Feature
id: FEAT-0014
title: "The work lock: waypoints, pause and resume"
description: "Mark a todo — or, for one developer, a whole batch — as in work with a lock (todos/<batch>/<todo>/working.md, or todos/<batch>/working.md) that says who holds it and where the work is — `novadev work start`, `waypoint`, `pause` (the command half of /novadev-pause) and `stop` — so a later session resumes from the last waypoint, and status, sync, archive and filing respect it."
feature-status: shipped
status: stable
area: work
created: 2026-11-10
tags: [work, lock, covers, partial-lock, todo-lock, working-md, waypoint, pause, resume, abandoned, heartbeat, session, novadev-pause, worktree, registry, claims, overlap, one-owner-per-file]
touches: [src/work.ts, src/registry.ts, tests/work.test.ts, tests/worktree-locks.test.ts, tests/todo-locks.test.ts, tests/old-locks.test.ts, templates/skills/novadev-pause.md]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:6655fee
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-12T14:42:34+01:00 }
stale_after: 2027-11-12T14:42:34+01:00
---

# FEAT-0014 — The work lock: waypoints, pause and resume

## What it does

- **The todo is the unit of work** (since `2026-11-12_2/02`): `novadev work start <batch>/<todo>`
  (or `work start <batch> --todo <nn|slug>`, repeatable) locks ONE todo — its lock and waypoint
  trail are `todos/<batch>/<todo>/working.md`, its registry entry `locks/<batch>.<todo>.json`
  (`unit: "todo"`). Several todos in one command are taken all or none. `work start <batch>` alone
  locks the whole batch for one developer, in `todos/<batch>/working.md`, and resumes whatever
  locks this worktree already carries in the batch. `waypoint | pause | stop | claim` take
  `<batch>/<todo>` too; addressed by batch they act on this worktree's locks in it (several: a
  waypoint or claim must name its todo, a pause writes every working lock, a stop releases all).
  A todo is held by one lock: its own, or the batch-root lock that covers it. `status`,
  `todo list` and `todo show` say per todo who holds it (`todoHolders`).
- The bullets below describe the commands as they were built, batch first; they hold for a todo's
  lock the same way.

- `novadev work start <batch> [--agent <actor>] [--session <id>] [--take]` takes the lock,
  or resumes a paused one or one whose holder is gone, answering with the last waypoint.
- `novadev work waypoint <batch> <payload.json>` — `{ todo?, phase?, note }` — adds an
  entry to the trail (newest first) and refreshes the heartbeat.
- `novadev work pause <batch> <payload.json>` — `{ todo?, phase?, stopped, next, done?,
  resume?, open? }` — writes the exhaustive stop record, adding the branch, HEAD and
  uncommitted paths itself; the lock becomes `paused` and waits on the human.
- `novadev work stop <batch> [--take]` releases the lock at the end of a round.
- While a lock exists the batch is never marked complete or archived, and `file-todo` never
  reuses it; `todo addendum/edit/cancel` are refused while the lock is `working` and its
  holder is live (a paused batch accepts them). `status` and `sync` show it first; an
  **abandoned** lock (holder's process gone on this host, or no heartbeat for 120 minutes)
  is a NEXT ACTION, a paused one is WAITING ON THE HUMAN.

- **Across worktrees** (0.16.0): every `work` command mirrors the lock into
  `<git common dir>/novadev/locks/<batch>.json`, which every worktree of the repository reads.
  `work start` refuses a batch in work (or paused) in another worktree (`--take` moves it — the old
  holder's lock is then stale: its waypoints, pauses and claims are refused, and its `stop --take`
  leaves the new entry alone), takes over an abandoned one, and drops entries whose worktree is
  gone (a project below its repository's top included); sync's *in work* block lists
  the others (`◦`); a batch in work elsewhere is not complete, archived, filed into, or written
  by `todo addendum/edit/cancel` while live.
- **Claims**: the paths a batch owns — its features' `touches:` plus `--claim` / `novadev work
  claim` (`irrippr:ps/` for a sub-repo) — kept in the lock's `claims:` line and the registry;
  an overlap with a batch in work in another worktree is refused unless `--allow-overlap`.
  A claim is judged once, when it is added: resuming a lock does not re-judge the claims it
  holds, so `work claim` on a paused lock and `work start` agree.
- **Part of a batch, as 0.17.0 wrote it**: one lock at the batch root that holds only some todos
  (`covers:` in working.md, `covers` in the registry entry `locks/<batch>@<worktree hash>.json`) —
  still read, resumed, paused, claimed for and stopped, never made new (`--todo` takes todo locks now);
  claims come from those todos' features only; another worktree may lock other todos of the same
  batch; two locks collide when either covers the whole batch or they share a todo. sync/status
  show each part, `stop` lists as unfinished only its todos, `todo addendum/edit/cancel` wait
  only for a lock covering the todo.
- **In a worktree `novadev worktree create` made**: the batch claims the worktree's claims plus
  `--claim`, never the features' folders, and `--claim` / `work claim` there add to the worktree's
  claims too (FEAT-0019's gate then accepts them).

## How it works

`src/work.ts`: `startWork` resolves the locks a command names and `planStart` judges each before
the first write; `locksOf` / `requireLock` find the lock(s) a later command is about. The lock is flat frontmatter (state, agent, host, pid, session, started,
updated, resumed, todo, phase) plus a markdown trail. The holder is the harness process
(`CLAUDE_PID` or the grandparent pid via `ps`) and `CLAUDE_CODE_SESSION_ID`, when present.
`auditWork` feeds sync and doctor. Payloads are JSON files; answers are JSON. `src/registry.ts`
owns the shared registry (`registryLocks`, `locksElsewhere`, `pruneGone`, `batchesInWorkElsewhere`)
and the claims (`normalizeClaim`, `claimOverlaps`); `writeLock` in work.ts mirrors every write.

## Progress

- 2026-10-25 — landed in 0.14.0 (commit 6655fee): `working.md`, `novadev work`, `/novadev-pause`, "in work" in status and sync
- 2026-11-10 — locks every worktree sees, and claims between batches (`2026-11-10_1/01-worktree-visible-locks`, `2026-11-10_1/05-batch-path-ownership`)
- 2026-11-10 — fixes from the independent review of batch 2026-11-10_1, before the 0.16.0 release (`2026-11-10_1/07-worktree-command`)
- 2026-11-12 — part of a batch (`work start --todo`), worktree-only claims inside a novadev worktree, claims judged once (`2026-11-12_1/03-work-start-one-todo-claims`, `2026-11-12_1/04-worktree-batch-claims-files-only`)
- 2026-11-12 — the todo is the unit of work: a lock per todo, the whole batch as one lock for a solo round, 0.17.0 locks unchanged (`2026-11-12_2/02-todo-is-the-unit-of-work`)

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
