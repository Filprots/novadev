# ai_completed — area-owners

**Date:** 2026-11-12
**Feature:** FEAT-0021
**Commits:** 25f4e8e, 9f1adac

## Prompt
Area owners: who builds and who must review, per feature area and path.

## What I did
- `"owners"` in novadev.json (areas, paths as globs or `<sub-repo>:<glob>`, override); `suggestedOwner` in `file-todo`'s answer, `todo show` and the JSON lists; *Required reviewers* in `worktree mr`; `novadev owners [<path|area>]`.
- `todo review`: an APPROVE lacking a reviewer of a matching rule is PARTIAL and the todo stays in `review` — in every project, team mode or not; sign-offs kept per reviewed commits; override by a person, the lead or `owners.override`, with a recorded reason (the board's answer 4: each area).
- sync and doctor audit the setting. No setting = no change.

## Placement
New module `src/owners.ts`; enforcement in `reviewTodo` (`src/todo.ts`) and `reviewGate` (`src/review.ts`). No hubs are configured.

## Verification
- `tests/owners.test.ts` and the owners tests in `tests/docs.test.ts`; full suite 717 pass.
