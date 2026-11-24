# ai_completed — 04-archive-only-on-default-branch

**Date:** 2026-11-10
**Feature:** FEAT-0004
**Commits:** 45b7350

## Prompt
`novadev sync` archiving on a task branch moves folders that master moves too, and the two moves
conflict. Archive only when the current branch is the default branch; on other branches report what
would be archived.

## What I did
- `src/branch.ts` (new): `archivePlace(root)` — may finished work move here? Yes outside git, when
  git cannot name a default branch, and on the default branch; otherwise no, with the reason
  ("this is branch task/x, not main", "HEAD is detached, not on main"). `"defaultBranch"` in
  novadev.json (`parseDefaultBranchSetting`) names the branch when the project wants another one.
- `src/git.ts`: `defaultBranch(path, configured, nested)` — the setting, else `origin/HEAD`, else the
  first existing of `init.defaultBranch`, `main`, `master`. Also the read-only questions the next
  todos of this batch need: `isAncestor`, `hasCommit`, `commonGitDir`, `worktreeList`,
  `isRepositoryTop`.
- `src/archive.ts`: `sweepDone` returns `{ moved, held, place }`; off the default branch it moves
  nothing (test rounds and batches alike) and lists the held moves; `completed.md` is still written.
  `novadev archive` (explicit or `--done`) refuses off the default branch.
- `src/sync.ts`: prints the held moves under "not archived here — …; main archives N item(s) after
  the merge:" — information, not a NEXT ACTION.
- README (*The system*), the playbook (phase 10) and the CLI help say so.

## Placement
- `archivePlace` / `parseDefaultBranchSetting` / `projectDefaultBranch`: `src/branch.ts`, new, 0 → 51
  lines — the branch policy, apart from the sweep so 06 and 07 can ask the same question.
- `defaultBranch` and the other git questions: `src/git.ts`, 199 → 307 — the read-only git module.
- `src/archive.ts` 195 → 221; `src/sync.ts` 255 → 260. No hubs are configured in this repo.

## Verification
- `tests/branches.test.ts` (new, 10 tests): archives on main; a task branch holds batches and test
  rounds and still writes completed.md; a detached HEAD; `"defaultBranch": "develop"`; `archive`
  refuses on a branch (explicit and `--done`); a repo with unusual branch names; an unreadable
  setting; `defaultBranch()` prefers `origin/HEAD`, null outside git.
- `bun test`: 518 pass, 0 fail.

## Notes
- The default branch of a sub-repo (06's merge check) uses the same `defaultBranch(..., nested)`.
- Batch decisions: `2026-11-10_1` ai_progress.md.
