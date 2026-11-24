# ai_completed — 07-worktree-command

**Date:** 2026-11-10
**Feature:** FEAT-0019, FEAT-0014
**Commits:** c0df0d2, 89e9399

## Prompt
Generalise ~/_work/paperclip/scripts/irris-worktree into `novadev worktree
create|list|status|gate|mr|sync|merge|remove`: worktrees of the repo plus named sub-repos on one
branch, claims, a gate whose checks are configured per repo in novadev.json, an all-or-nothing merge
(git merge-tree pre-check) followed by `sync --after-merge`.

## What I did
- `src/worktree.ts` (new): the eight subcommands, ported from irris-worktree and made generic:
  the project's main checkout and its "subrepos" (FEAT-0016) instead of IRRIS paths; any worktree
  name (branch = `branchPrefix` + name); the default branch per repository (branch.ts / git.ts)
  instead of master-or-main; the settings in `"worktree"` (dir, branchPrefix, share, linkSubrepos,
  gate per repository — "." for the project).
- Claims are the registry's (registry.ts): a worktree's `--claim` paths are checked against every
  other worktree AND every batch in work elsewhere, and `work start` in a worktree checks against
  the other worktrees' claims too (one `claimHolders` list for both kinds). The gate also fails on a
  change outside the claims — the "claims checked again at the gate" the Paperclip analysis asked for.
- The gate runs `novadev sync --check` with THIS novadev (process.execPath + bin/novadev.ts), then the
  configured commands with NOVADEV_WORKTREE/BRANCH/BASE/CHANGED.
- The merge: refuses a dirty worktree, a main checkout off its default branch or dirty, and a branch
  that carries a batch's working.md; pre-checks all repositories with `git merge-tree --write-tree`
  and merges nothing unless all would go; merges sub-repos first and the project last (records
  never land without their code); `sync --after-merge` (FEAT-0017) on the main checkout.
- `sync` merges the default branches in and runs `sync --after-merge` in the worktree when the
  project moved. `remove` refuses from inside the worktree and with uncommitted changes (unless
  `--force`), deletes merged branches, keeps unmerged ones unless `--force`, drops the registry
  entries (the worktree's and its locks').
- registry.ts: worktree entries; `claimHolders` (batches and worktrees); `overlapText` names the
  holder's kind. README (*`novadev worktree`*, settings table), the playbook (when an agent may run
  create and merge — the human asked for that way of working; merge only as the named lead), help.

## Placement
- The command: `src/worktree.ts`, new, 0 → 604 lines — it owns every git write of the worktree flow,
  so `src/git.ts` stays read-only. Settings parse in the same file (one reader).
- `src/registry.ts` 243 → 340 (worktree entries, claim holders); `bin/novadev.ts` +11.
  No hubs are configured here.

## Verification
- `tests/worktree.test.ts` (new, 10 tests, a real super-repo with sub-repos irrippr and irris):
  settings; create (both worktrees on one branch, irris and node_modules linked, `git status`
  clean, registry, list, status, `novadev status`); its refusals (name taken, overlapping claim,
  unknown sub-repo, a claim in a sub-repo it lacks, a bad name); a batch in a worktree claims
  against the neighbour worktree and shows in list; the gate passes (sync --check, a project
  command, a sub-repo command using NOVADEV_CHANGED) and fails on dirt, whitespace, a change outside
  the claims; mr names `irrippr@hash`; merge dry run order, `--yes` merges sub-repo then project and
  runs after-merge, remove deletes merged branches and the registry entry; a project conflict merges
  NOTHING (the sub-repo stays unmerged), a dirty main checkout and a branch carrying a lock refuse;
  sync brings main in; remove refuses dirt and from inside, `--force` drops an unmerged branch; the
  README documents every new setting and its example parses; the help names the new commands.
- `bun test`: 566 pass, 0 fail.

## Notes
- Not ported (IRRIS-specific, on purpose): the main-checkout commit guard (`guard install`, hooks
  refusing commits in the main checkout) and the hydra-check suggestions in gate/mr. A project's
  `gate` commands cover its checks; the guard could become a later todo if wanted.
- `~/_work/paperclip/scripts/irris-worktree` stays as it is; switching the IRRIS company to
  `novadev worktree` is the owner's call once 0.16.0 is deployed there.

- **Independent review, 2026-11-10** (a fresh agent read the committed code; 11 findings, 10
  reproduced; all fixed in the 0.16.0 release commit, one regression test each in
  `tests/review016-findings.test.ts`, each failing on the code before): `merge --yes` could merge a sub-repo and then fail on the project (an untracked file in the main checkout, or a hook) — now an untracked file the branch would write refuses up front, and a late failure undoes the merges that run made; any `working.md` on the branch blocked the merge, even a paused one or one from main (now only a WORKING lock the branch added or changed); `sync` skipped `--after-merge` for good after a sub-repo conflict (now always runs it).
