# ai_completed — 06-review-record

**Date:** 2026-11-10
**Feature:** FEAT-0018, FEAT-0015

## Prompt
Add `ai_review.md` (verdict APPROVE / CHANGES, the checks run with results, the reviewer) to the
record chain. In a team mode (novadev.json), a todo counts as completed only with an APPROVE review
and a merge commit on the default branch.

## What I did
- `src/review.ts` (new): the record (`ai_review.md`: Date, Verdict, Reviewer, `## Checks`,
  `## Findings`, `## Notes`), its payload and its verdict parser; `reviewGate`, which `todoState`
  (lib.ts) asks for a todo with ai_completed.md; `teamMode` (`"team": true`); `merged`.
- New todo states: `changes` (a CHANGES review — in EVERY project, since a rejected change is not
  done), and in team mode `review` (no APPROVE yet) and `unmerged` (approved, not on the default
  branch). None is terminal, so the batch stays open.
- "Merged", as the human decided (batch ai_progress.md, decision 2): every commit on the record's
  `**Commits:**` line is an ancestor of the default branch (branch.ts's choice: setting, origin/HEAD,
  main/master); a sub-repo's `repo@hash` of THAT repository's default branch; a record naming no
  commit must itself be committed on the default branch. Outside git: merged. Git cannot name the
  default branch: not merged, and sync says to set "defaultBranch".
- `novadev todo review <ref> <payload.json>`: checks required, CHANGES needs findings, `by` an actor
  or "human"; the previous review kept in `.review-history/`; not refused behind a lock (reviewing
  is part of the loop). A todo in `review`/`unmerged` takes no addendum/edit/cancel.
- `src/sync.ts`: `changes` is a NEXT ACTION; `review`/`unmerged` are listed under WAITING ON REVIEW
  OR MERGE (with what is missing) — not NEXT ACTIONS, so a builder is never told to clear them.
- Marks for the new states in status, the pause record and completed.md; ai_review.md is a reserved
  name for attachments and makes a batch "touched" for filing.
- README (*Review, and team mode*), the playbook (vocabulary, phase 4 "Review"), the CLI help.

## Placement
- The review gate and the record: `src/review.ts`, new, 0 → 186 lines. lib.ts imports it for
  `todoState` (a cycle: review.ts runs nothing at load time, said in both files).
- `src/todo.ts` 299 → 344 (the command), `src/sync.ts` +15, `src/lib.ts` +12, `src/git.ts` +13
  (`fileOnBranch`). No hubs are configured here.

## Verification
- `tests/review.test.ts` (new, 9 tests): verdict spellings; the command writes the record and keeps
  the history; its refusals (nothing finished, no checks, CHANGES without findings, a non-actor, a
  bad verdict); without team mode CHANGES reopens (NEXT ACTION, batch not complete, status mark)
  and APPROVE closes, and no review is needed; in team mode, on real git: `review` → `unmerged`
  on the task branch → `completed` after `git merge --no-ff` on main; a record without commits; a
  sub-repo commit that is `unmerged` until the sub-repo's own merge; no addendum while waiting.
- `bun test`: 556 pass, 0 fail.

## Notes
- The playbook forbids self-review; the command cannot enforce it (a record does not name its
  builder). Open question in FEAT-0018.
