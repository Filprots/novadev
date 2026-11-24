# ai_completed — 02-multi-repo-commits

**Date:** 2026-11-10
**Feature:** FEAT-0016, FEAT-0005, FEAT-0012
**Commits:** 71c2451, 89e9399

## Prompt
`**Commits:** abc123` is ambiguous when a todo changes several sub-repos (irris, irrippr,
irrisketch_locales …). Allow `repo@hash` (`irrippr@abc123`) and a `**Repos:**` line; `novadev links`
resolves them against sub-repos configured in novadev.json (`"subrepos": ["repos/*"]`).

## What I did
- `src/subrepos.ts` (new): the `"subrepos"` setting (folders relative to the root; a last `/*` = every
  repository in that folder, named by its folder), `listSubrepos` (cached per run; a folder counts
  when it is the top of its own work tree), `commitRefsIn` — now the one parser of a `**Commits:**`
  value (bare hash or `name@hash`), `repoNamesIn` for `**Repos:**`, and `commitChanges` (the files a
  commit changed, project-relative, in whichever repository it names).
- `src/links.ts`: each commit is checked in the repository it names; notes for a missing commit, a
  name that is not a sub-repo (in `**Commits:**` or `**Repos:**`), and a bare hash that belongs to a
  sub-repo ("write it as irrippr@abc1234"); setting problems (two sub-repos with one name) are
  problems. `work.md` lists commits as written and each todo's repos.
- `src/placement.ts`: reads commits with `commitRefsIn` and their files with `commitChanges`, so a
  hub inside a sub-repo is checked like any other.
- `src/git.ts`: `commitPaths(..., nested)` asks a nested repository without a hook's GIT_* variables;
  `hasCommit`. `commitHashesIn` (lib.ts) removed — `commitRefsIn` replaced every use.
- `src/sync.ts`: every `commit … (…)` note, a bad `**Repos:**` name and a `"subrepos"` note are NEXT
  ACTIONS.
- README (new section *Parallel work — branches, worktrees and sub-repos*), the playbook (record
  template and phase 4).

## Placement
- Sub-repo rules: `src/subrepos.ts`, new, 0 → 150 lines — one owner for the setting and the commit
  syntax, used by links and placement now and by the review gate (06) and `novadev worktree` (07).
- `src/links.ts` 515 → 548, `src/placement.ts` 186 → 189, `src/git.ts` 307 → 310, `src/lib.ts` −5.
  No hubs are configured in this repo.

## Verification
- `tests/subrepos.test.ts` (new, 9 tests): the parsers; a super-repo fixture whose `repos/irrippr` is
  an independent repository — commits resolve in their own repositories and work.md shows them; a
  missing sub-repo commit, an unknown repo name and an unknown Repos name are NEXT ACTIONS; a bare
  hash of the sub-repo gets the `irrippr@` suggestion; two sub-repos with one name; a non-repository
  folder; the placement check across repositories, with and without a Placement section.
- `bun test`: 527 pass, 0 fail.

## Notes
- Feature verdict: build FEAT-0016 (searched `features repo`, `features commits`, `--touching
  src/links.ts`, `--touching src/placement.ts`: no feature covered nested repositories); it extends
  the link graph (FEAT-0005) and placement (FEAT-0012).

- **Independent review, 2026-11-10** (a fresh agent read the committed code; 11 findings, 10
  reproduced; all fixed in the 0.16.0 release commit, one regression test each in
  `tests/review016-findings.test.ts`, each failing on the code before): `commitRefsIn` dropped or cut sub-repo names starting with `_` or `.`, or holding `+` (`_common@…` read as no commit, which let team mode treat an approved record as naming none); a name is now everything up to the `@`.
