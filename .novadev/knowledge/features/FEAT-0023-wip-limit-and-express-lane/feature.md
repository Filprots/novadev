---
type: Feature
id: FEAT-0023
title: Wip limit and express lane
description: "Cap the unfinished todos one holder may have in work (`wipLimit`, off by default) — `work start` refuses one more and says how to free a slot — and give an urgent todo an express lane: exempt from the limit, pausing what its holder was in, first in the merge queue, skipping no check."
feature-status: shipped
status: stable
area: work
created: 2026-11-12
tags: [wip, work-in-progress, limit, holder, slot, express-lane, urgent, pause, expedite]
touches: [src/wip.ts, tests/wip-and-express.test.ts]
depends-on: [FEAT-0014, FEAT-0020, FEAT-0022]
supersedes: []
superseded-by: []
conflicts-with: []
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-12T15:39:48+01:00 }
stale_after: 2027-11-12T15:39:48+01:00
---

# FEAT-0023 — Wip limit and express lane

## What it does

- `"wipLimit": N` (0 or absent: off) and `"wipCountsPaused": false` (default true) in the main checkout's novadev.json.
- A holder is the actor a lock records (`--agent`); a lock without one is not counted. A todo takes a slot while a lock
  holds it and it is not finished; a lock on a whole batch holds every unfinished todo of it (the board's answer 5).
- `work start` on one more is refused — `Work-in-progress limit: … holds 2 of 2 todo(s)` — with the list and how to
  free a slot. Resuming what you hold is not one more.
- `status` shows each holder against the limit (*work in progress*); `status --json` has `wip` always.
- **Express lane**: an urgent todo (FEAT-0020) is never refused and takes no slot. Started at the limit, `work start`
  first pauses every todo its holder is working on in this worktree — the ordinary pause, with a record ("Paused for
  the urgent todo …") — and answers `expressLane` (`paused`, `stillInWorkElsewhere`). Its worktree is express in the
  merge queue (FEAT-0022). The gate, the review and the merged-result checks all still run. `status` names who was
  paused for it.

## How it works

`src/wip.ts` reads the settings and counts (`wipSlot`, `wipHolders`) from `todoHolders` (work.ts); it never imports
work.ts at run time. `wipCheck` and `pauseForUrgent` in `src/work.ts` run in `startWork` after every other refusal and
before the first write. `queueAdd` (worktree.ts) reads the todos' priority.

## Progress

- 2026-11-12 — built: `2026-11-12_2/09-work-in-progress-limit`, `2026-11-12_2/07-express-lane-for-urgent`

## Open questions

- IRRIS developers share one actor id today: the limit needs one id per developer before it is turned on.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
