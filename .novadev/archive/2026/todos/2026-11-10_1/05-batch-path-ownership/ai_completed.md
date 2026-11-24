# ai_completed — 05-batch-path-ownership

**Date:** 2026-11-10
**Feature:** FEAT-0014
**Commits:** 069d79e, 89e9399

## Prompt
One owner per file: a batch declares the paths it will touch (from its features' `touches:`), and
`novadev work start` refuses a batch whose paths overlap a batch locked in another worktree
(building on `features --touching`).

## What I did
- A batch in work CLAIMS paths: the `touches:` of every feature a `**Feature:**` line in its files
  names (briefs and records), plus `--claim <path>` on `work start` (repeatable) and the new
  `novadev work claim <batch> <path>…`. A claim may be `<sub-repo>:<path>` (`irrippr:ps/layouting/`
  → `repos/irrippr/ps/layouting`, via FEAT-0016's "subrepos"); a path leaving the project, or an
  unknown sub-repo, is refused.
- The claims sit in the lock (`claims:` in working.md's frontmatter) and in its registry entry
  (01). `work start` and `work claim` refuse an overlap — the same path, or one inside the other,
  `pathsOverlap` as `features --touching` uses — with a claim of a batch in work in ANOTHER worktree
  (gone worktrees ignored), naming the batch, the worktree, the branch and the agent.
  `--allow-overlap` is the lead's decision; the answer then lists the overlaps.
- The answer of `work start` says where each claim came from (`claimsFrom`: given, features), and
  tells a batch that claims nothing that no overlap was checked.
- `src/registry.ts`: `normalizeClaim`, `claimOverlaps`, `overlapText`, `batchClaims`.

## Placement
- Claims: `src/registry.ts` (shared with 01) — the claim rules sit with the registry that carries
  them; `work.ts` only calls them. Sizes in 01's record.

## Verification
- `tests/worktree-locks.test.ts`, the claims block (5 tests): overlap refused across worktrees with
  the branch named, `--allow-overlap` lists it; neighbouring paths (`src/auth` vs `src/auth2`) do not
  overlap; `work claim` adds, and refuses an overlap, and the registry follows; a feature's touches
  become claims; a batch with no claims gets the note; `../` refused; `irrippr:ps/layouting/` maps
  to the sub-repo folder and an unknown sub-repo is refused.
- `bun test`: 547 pass, 0 fail.

## Notes
- Claims are checked at `work start` and `work claim`. A feature named by a record written later
  does not grow the claims by itself: claim it (`work claim`) when the plan names the files.
  The worktree command (07) checks a worktree's claims against these too.

- **Independent review, 2026-11-10** (a fresh agent read the committed code; 11 findings, 10
  reproduced; all fixed in the 0.16.0 release commit, one regression test each in
  `tests/review016-findings.test.ts`, each failing on the code before): claims spelled `src//auth/` or `src/./auth` missed overlaps (one spelling now), and `_common:src/` was not read as a sub-repo claim (any folder name now).
