# ai_completed — claims-warn-protected-paths-lock

**Date:** 2026-11-12
**Feature:** FEAT-0014, FEAT-0019
**Commits:** 9865cb7

## Prompt
Claims become notices behind an opt-in setting; only the project's `protectedPaths` stay hard locks; the gate fails only on an unheld protected file and lists shared files.

## What I did
- `"claims": "notice"` and `"protectedPaths"` (paths or globs, `<sub-repo>:<path>`), read from the MAIN checkout so a branch cannot loosen the rule. Absent = `lock`: 0.17.0 behaviour, whatever `protectedPaths` says.
- `work start`, `work claim`, `worktree create`, `worktree claim`: a soft overlap goes on and is said (`shared` in the answer / a `shared (a notice, not a lock)` line); an overlap whose shared path reaches a protected path is refused as before, `--allow-overlap` still passes.
- Who shares what is computed from the registry on every read (`sharedClaims`): `worktree list --json` (`shares`), `status` (*shared claims*), `status --json` (`sharedClaims`).
- Gate under `notice`: fails on a changed file under a protected path the worktree does not hold; lists files shared with other open worktrees (changed there too, or under their claims) — in the merge request too.
- sync and doctor name an unreadable setting.

## Decisions
- Shares are computed, not stored: nothing to keep in step between two worktrees' entries.
- Two claims on a folder ABOVE a protected path are hard too: they share the protected path.
- Goes live with the merge queue (todo 04), which is the guard that replaces the lock.

## Placement
New module `src/claim-policy.ts` (the policy, globs, `sharedClaims`); callers in `src/work.ts`, `src/worktree.ts`, `src/status.ts`. No hubs are configured in this project.

## Verification
- `tests/claims-and-queue.test.ts` › the settings, claims as notices (5 tests): the brief's four cases — overlap outside protected paths, both proceed and both listed; under a protected path refused; the gate passes with a shared unprotected file and names it; the gate fails on an unheld protected file.
- IRRIS, read-only, 2026-11-12: `worktree list`, `todo list`, `sync --check` identical to live 0.17.0.
