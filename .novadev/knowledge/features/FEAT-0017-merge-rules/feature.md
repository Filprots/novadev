---
type: Feature
id: FEAT-0017
title: "Merge rules for parallel branches, and sync --after-merge"
description: "Branches that both record knowledge or regenerate derived files merge without conflicts: deploy writes a .gitattributes block (the log by union, derived files keep ours) and the merge driver, and `novadev sync --after-merge` repairs the log, regenerates and commits."
feature-status: shipped
status: stable
area: close-out
created: 2026-11-10
tags: [merge, gitattributes, merge-driver, novadev-derived, union, after-merge, parallel-branches, worktrees, log-repair]
touches: [src/merge-rules.ts, tests/merge-rules.test.ts]
depends-on: [FEAT-0001, FEAT-0008, FEAT-0013]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: todo:2026-11-10_1/03-merge-rules-for-parallel-branches
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T16:13:07+01:00 }
stale_after: 2027-11-10T16:13:07+01:00
---

# FEAT-0017 — Merge rules for parallel branches, and sync --after-merge

## What it does

- `novadev deploy` writes a managed block into the project's `.gitattributes`:
  `knowledge/log.md merge=union`, and `merge=novadev-derived` for every derived file
  (`index.md`s, features' `work.md`/`tests.md`, batches' `completed.md`,
  `metrics/latest.json`). It also defines the driver in the clone's git config
  (`merge.novadev-derived.driver true`: keep this side's copy), which every worktree shares.
- `novadev sync` lists a NEXT ACTION when the block is there but this clone lacks the driver
  (a fresh clone): `novadev deploy` sets it.
- `novadev sync --after-merge` refuses mid-merge or with uncommitted `.novadev/` changes, joins
  the log's split days (newest first, each entry once), runs sync, and commits what changed
  in `.novadev/` (only those paths, with `git commit --only`).

## How it works

`src/merge-rules.ts`: `MERGE_RULES` / `withMergeRules` / `writeMergeRules` (the block),
`configureMergeDriver` / `mergeDriverConfigured`, `repairLog` (on `parseLog`'s "second section"
and "order" problems only), `afterMergeRefusal`, `commitAfterMerge`. `src/deploy.ts` step 6
writes the rules; `src/sync.ts` handles `--after-merge` and the missing-driver action. Without
the driver, git falls back to a text merge and a derived file conflicts (verified by hand,
2026-11-10).

## Progress

- 2026-11-10 — built: `2026-11-10_1/03-merge-rules-for-parallel-branches`
- 2026-11-10 — fixes from the independent review of batch 2026-11-10_1, before the 0.16.0 release (`2026-11-10_1/07-worktree-command`)

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
