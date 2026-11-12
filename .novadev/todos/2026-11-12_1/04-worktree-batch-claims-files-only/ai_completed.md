# ai_completed — worktree-batch-claims-files-only

**Date:** 2026-11-12
**Feature:** FEAT-0014, FEAT-0019
**Commits:** 132e326

## Prompt
(1) `work start` inside a novadev-made worktree claims only the worktree's claims plus `--claim`,
not folders from the features' `touches:` (IRR-174, IRR-152); (2) `novadev worktree claim <name>
<path…> [--allow-overlap]` adds file claims to an existing worktree entry with create's overlap
check, and the gate reads them; (3) `work claim` on a paused lock and `work start` agree.

## What I did
- (1) `src/work.ts` `startWork`: when `worktreeAt(root)` finds the registry entry of this
  worktree, the claims are the given ones, the kept ones and the worktree's (`claimsFrom.worktree`),
  no feature folders; the paths given with `--claim` (and `work claim`) are added to the worktree's
  entry too (`addWorktreeClaims`, `src/registry.ts`), so the gate sees them even after `work stop`.
- (2) `src/worktree.ts` `claimWorktree` + `worktree claim` command: normalised claims, refused in a
  sub-repo the worktree lacks (shared `worktreeClaims` with `create`), overlap checked against every
  holder outside the worktree (`claimHolders(main, entry.path)`), `--allow-overlap` reports the
  allowed overlaps. The gate reads `entry.claims`, so it sees them at once.
- (3) A claim is judged once, when it is added: `work start` checks only claims new to the lock
  (not those the lock already holds, nor the worktree's own). `work claim` accepted with
  `--allow-overlap` → a later resume no longer refuses it.
- Docs: README (Claims; worktree section; gate list), HELP, `templates/skills/novadev-work.md`.

## Placement
- `src/worktree.ts` (`claimWorktree`, `worktreeClaims`, `takenText`), `src/registry.ts`
  (`worktreeAt`, `addWorktreeClaims`), `src/work.ts` (`worktreeBatchClaims`). No hubs are configured.

## Verification
- `tests/worktree.test.ts`: the brief's test (W2 holds src/f.ts in src/, W1's feature touches src/:
  `work start` in W1 passes with claims `src/g.ts` only, while the same batch outside a worktree is
  still refused; `worktree claim W1 src/f.ts` refused, accepted with `--allow-overlap`; a change
  to F in W1 is not "outside the claims"); and "`work claim` on a paused lock and `work start`
  agree" (claim allowed on the paused lock, resume passes; a NEW overlapping `--claim` still refused).
- `bun test`: 589 pass, 0 fail.

## Notes
- Behaviour change, intended by (3): before, resuming a lock re-judged every claim it held, so a
  claim allowed with `--allow-overlap` had to be allowed again on every resume. Now it is judged
  once. Outside worktrees, feature-folder claims are still derived (and judged when new).
- Overlap with 01: settled by doing both (the owner's later yes on 04 asked for the command).
