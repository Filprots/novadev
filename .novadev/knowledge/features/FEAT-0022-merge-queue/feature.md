---
type: Feature
id: FEAT-0022
title: Merge queue
description: "Line approved worktrees up in a merge queue: `novadev worktree queue add|list|run|remove` brings each branch onto the newest default branches, runs the gate on that merged result, and lands it only when it passes — one merge at a time, a failure lands nothing and the queue goes on; `worktree merge --yes` is the direct form with the same checks."
feature-status: shipped
status: stable
area: work
created: 2026-11-12
tags: [merge-queue, queue, bors, merged-result, gate, one-at-a-time, queue-lock, express, failed, land, worktree-merge]
touches: [src/queue.ts, src/worktree.ts, tests/claims-and-queue.test.ts]
depends-on: [FEAT-0019, FEAT-0017]
supersedes: []
superseded-by: []
conflicts-with: []
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-12T15:39:48+01:00 }
stale_after: 2027-11-12T15:39:48+01:00
---

# FEAT-0022 — Merge queue

## What it does

- `novadev worktree queue add <name> [--express] [--agent <actor>]`, `queue list [--json]`, `queue run [--one]`,
  `queue remove <name>`. First in, first out; express entries first (a worktree with an urgent todo is express by
  itself — FEAT-0023).
- `run` lands the head and goes on: every merge tried first (`git merge-tree`, all or nothing); the default branches
  merged INTO the branch in its worktree (what `worktree sync` does), so its tree is what would land; the gate and the
  project's gate commands there; if a default branch moved meanwhile, again (three tries); then the merges, sub-repos
  first, undone together when one fails late; then `sync --after-merge`.
- A conflict or a failed check lands nothing: the entry is marked `failed` with its reason and waits for its builder
  (`worktree sync`, fix, `queue add` again — it goes to the end).
- One merge at a time per clone: `queue run` and `worktree merge --yes` hold `queue.lock`; a second is told to wait; a
  lock whose process is gone, or half a day old, is taken over.
- `worktree merge --yes` runs the same procedure for one branch (it checked only conflicts before 0.18.0).
- `status` (*merge queue*), `status --json` (`mergeQueue`), `worktree list --json` (`queue`); `worktree remove` takes its
  worktree out.

## How it works

`src/queue.ts` owns the state — `<git common dir>/novadev/queue.json` and `queue.lock`, never committed, seen by every
worktree — and `queueOrder` / `withQueueLock`. `src/worktree.ts`: `landWorktree` (the shared procedure), `tryMerge`
(the dry run and the merges, as before), `queueAdd`, `queueRun`, `queueData`.

## Progress

- 2026-11-12 — built: `2026-11-12_2/04-merge-queue`

## Open questions

- The merges into the branch that the queue makes stay after a failure (they are what `worktree sync` makes); the builder fixes on top of them.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
