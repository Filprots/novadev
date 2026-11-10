# ai_completed — 01-worktree-visible-locks

**Date:** 2026-11-10
**Feature:** FEAT-0014, FEAT-0002
**Commits:** 069d79e

## Prompt
A lock taken with `novadev work start` lives in todos/<batch>/working.md on the current branch, so
other worktrees of the same repo cannot see it. Keep locks in the git common dir
(`$(git rev-parse --git-common-dir)/novadev/locks/<batch>.json`) so every worktree sees them;
`novadev status` lists `git worktree list` with each worktree's branch and locked batch.

## What I did
As the human decided (batch ai_progress.md, decision 1): BOTH places. `working.md` stays the lock
that counts in its worktree (trail and pause record in git, travelling with the branch); every
`novadev work` command also mirrors it into `<common git dir>/novadev/locks/<batch>.json`.
- `src/registry.ts` (new): read/write/remove entries, `locksElsewhere` (with `gone` for a worktree
  that no longer exists), `pruneGone`, `batchesInWorkElsewhere`.
- `src/work.ts`: `writeLock` mirrors every write (start, waypoint, pause, claim); `stop` removes the
  entry (another worktree's only with `--take`). `work start` refuses a batch live or paused in
  another worktree (where, by whom; resume a paused one where its pause record is), takes over an
  abandoned one (answer: `takenFromWorktree`), and prunes gone entries. `auditWork` lists batches in
  work elsewhere (`◦ … in another worktree: <path> (branch b)`), information only.
- `src/status.ts`: a *worktrees* block (when there is more than one) — path, branch, main checkout,
  this one, and the batches in work there; `status --json` → `worktrees`.
- A batch in work elsewhere is not complete or archived (`src/archive.ts`), `file-todo` does not
  reuse it (`src/todo-filing.ts`), and `todo addendum/edit/cancel` wait for a live session there
  (`src/todo.ts`).
- README (*Locks every worktree sees, and claims*), the playbook (phase 3), the CLI help.

## Placement
- The registry: `src/registry.ts`, new, 0 → 243 lines (with 05's claims) — work.ts keeps the lock
  file, registry.ts the shared mirror, so status/archive/filing ask the registry without loading
  the lock module's command code.
- `src/work.ts` 813 → 968 (mirroring, the elsewhere checks, `work claim`); `src/status.ts` 172 → 205;
  `src/archive.ts` +6; `src/todo.ts` +4; `src/todo-filing.ts` +3. No hubs are configured here.

## Verification
- `tests/worktree-locks.test.ts` (new, 12 tests, real `git worktree add`): a lock taken in a worktree
  shows in the main checkout's status (text and JSON) and sync; starting it elsewhere is refused
  while live, `--take` moves it; a pause elsewhere is refused with "resume it there"; an abandoned
  lock in the real second worktree is listed ABANDONED and taken over, a gone worktree's entry is
  pruned; stop releases; a finished batch in work elsewhere is neither complete nor archivable;
  `todo addendum` waits; plus the claims tests of 05.
- `bun test`: 547 pass, 0 fail.

## Notes
- 01 and 05 are one seam (the registry carries the lock and its claims): one commit for both, as
  planned in the batch's ai_progress.md.
- The registry is only a mirror. A worktree whose `working.md` was deleted by hand leaves an entry
  until the next `work` command there or `novadev worktree remove` (07).

- **Independent review, 2026-11-10** (a fresh agent read the committed code; 11 findings, 10
  reproduced; all fixed in the 0.16.0 release commit, one regression test each in
  `tests/review016-findings.test.ts`, each failing on the code before): a project below its repository's top made every other worktree's entry look gone (now: inside a live worktree); a cross-worktree `--take` left the old holder able to mirror back (its lock writes are now refused as stale); `stop --take` removed the other worktree's entry (now only this worktree's); status matches a root to its deepest worktree top.
