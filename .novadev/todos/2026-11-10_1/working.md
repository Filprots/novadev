---
state: working
agent: claude-code/claude-opus-5-5
host: irrisketch-server-1
pid: 609663
session: 901fd7fe-7537-4b7d-9e55-46c9f88efcf1
started: 2026-11-10T15:19:15+01:00
updated: 2026-11-10T15:44:41+01:00
todo: 07-worktree-command
phase: 3
---

# Working — 2026-11-10_1

<!-- The batch's LOCK, managed by `novadev work`: an agent is working this batch, or paused in it.
     Newest entry first — the top section is where the work resumes. Never edit it by hand:
     `novadev work waypoint` and `/novadev-pause` write it, `novadev work stop` removes it. -->

## Waypoint 5 — 2026-11-10 15:44 · 07-worktree-command · phase 3 WORK

06 landed (76f52b5, FEAT-0018). Starting 07: novadev worktree create|list|status|gate|mr|sync|merge|remove in src/worktree.ts, generalising paperclip's irris-worktree; registry worktrees/<name>.json beside the locks; claims shared with 05; merge = merge-tree pre-check, sub-repos first, project last, then sync --after-merge.

## Waypoint 4 — 2026-11-10 15:39 · 06-review-record · phase 3 WORK

01+05 landed (069d79e). Starting 06: ai_review.md (APPROVE/CHANGES) + novadev todo review; CHANGES reopens a completed todo; "team": true makes completed = APPROVE + every commit reachable from the default branch (sub-repos from theirs).

## Waypoint 3 — 2026-11-10 15:32 · 01-worktree-visible-locks · phase 3 WORK

03 landed (9345706, FEAT-0017). Starting the 01+05 seam: a lock registry in <common>/novadev/locks/<batch>.json written by every work command (working.md stays); claims from --claim, work claim, and the batch's features' touches; status lists the worktrees.

## Waypoint 2 — 2026-11-10 15:28 · 03-merge-rules-for-parallel-branches · phase 3 WORK

04 landed (45b7350), 02 landed (71c2451, FEAT-0016). Starting 03: deploy writes the .gitattributes block + merge driver config; sync --after-merge repairs the log, regenerates, commits .novadev/.

## Waypoint 1 — 2026-11-10 15:20 · 04-archive-only-on-default-branch · phase 3 WORK

Plan settled with the human (batch ai_progress.md): locks in branch + common-dir registry; merged = commits reachable from default; one commit per todo on master. Deployment + wiki + registry committed (5fea3d8). Wave 1 starts: 04 (default branch in git.ts, sweep only there).
