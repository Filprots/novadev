# ai_completed — 03-merge-rules-for-parallel-branches

**Date:** 2026-11-10
**Feature:** FEAT-0017

## Prompt
Two branches that both touch the knowledge log or derived files (index.md, features' work.md/tests.md,
todos' completed.md) conflict. `novadev deploy` should write the .gitattributes rules (log.md
merge=union; derived files merge=novadev-derived keeping ours) and the merge driver config, and
`novadev sync --after-merge` regenerates and commits the derived files.

## What I did
- `src/merge-rules.ts` (new): the managed `.gitattributes` block (`# novadev:begin … # novadev:end`;
  the project's own lines outside it are kept) with `log.md merge=union` and `merge=novadev-derived`
  for every derived file — the IRRIS super-repo's hand-written set plus `metrics/latest.json`; the
  driver in the clone's git config (`--local`, i.e. the common git dir every worktree shares); the
  log repair; the after-merge refusal and commit.
- `src/deploy.ts` step 6 writes the block and the driver and reports them.
- `src/sync.ts`: `--after-merge` refuses mid-merge (MERGE_HEAD), with uncommitted `.novadev/`
  changes, outside git, and together with `--check`; it repairs the log (one section per day,
  newest first, each entry once — only when parseLog's problems are of those two kinds), runs the
  whole sync, then commits what changed in `.novadev/` with `git commit --only -- .novadev`, problems
  or not (they are printed for the person). A NEXT ACTION when the block is there but this clone
  lacks the driver.
- README (*Merging parallel branches*), the playbook (phase 10, "After a merge"), the CLI help.

## Placement
- Merge rules, the driver, the log repair and the after-merge commit: `src/merge-rules.ts`, new,
  0 → 205 lines — it owns novadev's only git writes outside the worktree command (07), so
  `src/git.ts` stays read-only by its contract.
- `src/sync.ts` 260 → 309 (the flag, the commit step, one NEXT ACTION); `src/deploy.ts` +7.

## Verification
- `tests/merge-rules.test.ts` (new, 8 tests): the block is appended after the project's rules and
  replaced in place; deploy writes the block and the driver and a second deploy changes nothing; a
  missing driver is a NEXT ACTION; `repairLog` joins split days, orders them and keeps each entry
  once, and leaves healthy or otherwise-broken logs alone; a REAL merge of two branches that each
  recorded a memory merges without conflict, `sync --after-merge` regenerates the memories index,
  commits only `.novadev/`, `sync --check` passes, and a second run makes no commit; the refusals
  (dirty `.novadev/`, a merge in progress, outside git, with `--check`); the README shows the block
  exactly as deploy writes it.
- By hand (scratchpad repo): a `merge=<driver>` whose driver is not defined falls back to a text
  merge and conflicts; defined as `true` it keeps ours; `log.md merge=union` with both sides adding
  the same new day gave one section.
- `bun test`: 535 pass, 0 fail.

## Notes
- The IRRIS super-repo has the same rules hand-written above where deploy will put its block; they
  agree, so after 0.16.0 is deployed there the hand-written lines can go (its owner's call).
- Not done: a post-merge hook that runs `--after-merge` by itself — `novadev worktree merge` (07) runs
  it after its merge.
- Feature verdict: build FEAT-0017 (`features merge` found only deploy, `features gitattributes`
  nothing, `--touching src/deploy.ts` FEAT-0001, which it depends on).
