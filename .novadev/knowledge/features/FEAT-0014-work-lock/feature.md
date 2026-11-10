---
type: Feature
id: FEAT-0014
title: "The work lock: waypoints, pause and resume"
description: "Mark a batch as in work with a lock (todos/<batch>/working.md) that says who holds it and where the work is — `novadev work start`, `waypoint`, `pause` (the command half of /novadev-pause) and `stop` — so a later session resumes from the last waypoint, and status, sync, archive and filing respect it."
feature-status: shipped
status: stable
area: work
created: 2026-11-10
tags: [work, lock, working-md, waypoint, pause, resume, abandoned, heartbeat, session, novadev-pause]
touches: [src/work.ts, tests/work.test.ts, templates/skills/novadev-pause.md]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:6655fee
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0014 — The work lock: waypoints, pause and resume

## What it does

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

## How it works

`src/work.ts`: the lock is flat frontmatter (state, agent, host, pid, session, started,
updated, resumed, todo, phase) plus a markdown trail. The holder is the harness process
(`CLAUDE_PID` or the grandparent pid via `ps`) and `CLAUDE_CODE_SESSION_ID`, when present.
`auditWork` feeds sync and doctor. Payloads are JSON files; answers are JSON.

## Progress

- 2026-10-25 — landed in 0.14.0 (commit 6655fee): `working.md`, `novadev work`, `/novadev-pause`, "in work" in status and sync

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
