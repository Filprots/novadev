# ai_completed — work-start-one-todo-claims

**Date:** 2026-11-12
**Feature:** FEAT-0014
**Commits:** 132e326

## Prompt
`novadev work start <batch> --todo <nn|slug> [--todo …]`: claims only from the named todos'
features plus `--claim`, the lock records which todos it covers, another worktree can start a
different non-overlapping todo of the same batch; `work stop`, `sync`, the gate and `/novadev-work`
understand a partly-locked batch. Test: todo A (feature on X), todo B (feature on Y), worktree 1
holds Y → `--todo A` passes, `--todo B` refused.

## What I did
- `src/work.ts`: `--todo` (repeatable; folder, number or slug, `resolveTodoRef`); `WorkLock.covers`
  (`covers:` frontmatter, absent = whole batch, so 0.16.0 locks read unchanged); `startWork`
  derives claims with `batchClaims(…, covers)`, refuses only locks elsewhere whose covers collide
  (`coversOverlap`), takes over only those, and checks claims against other parts of the same
  batch too. Resuming with `--todo` adds todos; a whole-batch lock cannot be narrowed (refused).
  `auditWork` shows `(todos …)` for each part here and elsewhere and judges "every todo is
  recorded" on the covered todos; `stopWork` lists as unfinished only the covered todos;
  `requireLock` / `liveElsewhere(…, todo)` consider only colliding locks.
- `src/registry.ts`: `covers` in the registry entry; a whole-batch entry keeps the 0.16.0 file
  `locks/<batch>.json` and shape (no `covers` key); a partial one is
  `locks/<batch>@<sha1 of the worktree, 12 hex>.json`; entries carry the file they were read from,
  `removeRegistryEntry` removes exactly that one (`pruneGone`, `worktree remove` no longer remove
  every entry of a batch); `writeRegistryLock` drops this worktree's other entry of the batch.
- `src/todo.ts`: addendum/edit/cancel wait only for a lock covering the todo. `src/status.ts`:
  `covers` in `status --json` and the worktrees list.
- Docs: README ("Part of a batch"), HELP, `templates/skills/novadev-work.md` (phase 3, "Part of a batch").

## Placement
- All in the owners of the lock and the registry: `src/work.ts` (981 → 1081 lines, with todo 04),
  `src/registry.ts` (364 → 414). No hubs are configured in this project.

## Verification
- `tests/worktree-locks.test.ts` › "part of a batch" (5 tests): the brief's test (`--todo 01`
  passes with claims `src/x` only, `--todo 02` and the whole batch refused over `src/y`); a second
  worktree starts the other todo, the same todo / the whole batch is refused naming its todos;
  sync/status lines; archive refused; addendum gating; stop releases only its part; resume widens;
  narrowing refused; unknown todo named; overlapping claims between two parts refused; `--take`
  moves one part and leaves the other.
- Back-compat: all 0.16.0 tests unchanged and green (`tests/worktree-locks.test.ts` writes raw
  0.16.0 registry JSON without `covers`); a whole-batch entry is asserted to have no `covers` key.
  Read-only on IRRIS: `worktree list --json` and `status` give byte-identical output with the
  0.16.0 CLI and this branch.
- `bun test`: 589 pass, 0 fail.

## Notes
- The gate needed no change for parts: it reads the claims of every lock in the worktree (01).
- Open: two worktrees that each PAUSE a part of the same batch and both get merged would bring two
  different `working.md` for one batch to the default branch (merge refuses only a working lock).
  Not handled; stopping each part before its merge avoids it.
