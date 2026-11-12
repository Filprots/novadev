# ai_completed — worktree-gate-reads-batch-claims

**Date:** 2026-11-12
**Feature:** FEAT-0019
**Commits:** 132e326

## Prompt
The worktree gate checked changed files only against the worktree entry's creation-time claims;
claims added later with `novadev work claim` to the batch locked in that worktree were ignored
(IRR-147: 5 files "changed outside the claims"). Expected: the gate accepts a file within the
worktree's claims OR the claims of a batch locked in that worktree.

## What I did
- `src/worktree.ts`: `gateClaims(entry)` — the worktree's claims plus the claims of every registry
  lock whose worktree is this one (locks written by 0.16.0 included). `gateWorktree` checks changed
  files against that union (still only when the worktree has claims at all, as before); `mr` lists
  the same claims.
- Together with todo 04: `work claim` / `work start --claim` run inside a novadev-made worktree
  also add the paths to the worktree's own entry, so the gate still accepts them after
  `work stop` released the lock (the registry lock entry is gone then).

## Placement
- `gateClaims` in `src/worktree.ts` (621 → 678 lines with todo 04's `worktree claim`); no hubs are
  configured in this project.

## Verification
- `tests/worktree.test.ts` › "the gate accepts a file `work claim` added to the batch locked there
  (a lock written by 0.16.0 too); a file under neither still fails": worktree claim A, `work claim`
  B, the registry patched back to the 0.16.0 shape (claim only in the lock entry) → no "changed
  outside the claims"; a file under neither → the gate fails naming it. Passes; it fails on the old
  gate.
- `bun test`: 589 pass, 0 fail (31 files).

## Notes
- The brief's scope said "no `worktree claim` command"; todo 04 (the later board yes) adds one.
  Both land: the gate reads the lock claims (01), and `worktree claim` writes the worktree's (04).
