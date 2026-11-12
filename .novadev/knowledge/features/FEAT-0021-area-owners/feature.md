---
type: Feature
id: FEAT-0021
title: Area owners
description: "Name who owns each feature area and path (`owners` in novadev.json) so a todo gets a suggested owner, a merge request names its required reviewers, and `todo review` holds an APPROVE as PARTIAL until one reviewer of each matching rule approved — with a recorded override for a person or the lead."
feature-status: shipped
status: stable
area: review
created: 2026-11-12
tags: [owners, code-owners, reviewers, required-reviewers, suggested-owner, partial, sign-off, override, areas, globs]
touches: [src/owners.ts, src/review.ts, tests/owners.test.ts]
depends-on: [FEAT-0018, FEAT-0019, FEAT-0015]
supersedes: []
superseded-by: []
conflicts-with: []
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-12T15:39:48+01:00 }
stale_after: 2027-11-12T15:39:48+01:00
---

# FEAT-0021 — Area owners

## What it does

- Setting: `"owners": { "areas": { "<area>": { owner, reviewers } }, "paths": { "<glob>" | "<sub-repo>:<glob>": { owner,
  reviewers } }, "override": [actors] }`. No setting = nothing changes.
- `suggestedOwner` (`{ owner, because, others? }`) in `file-todo`'s answer, `todo show`, `todo list --json` and
  `status --json`, from the features and paths the brief names.
- `worktree mr` has a *Required reviewers* block for the files the branch changed.
- `todo review`: an APPROVE that lacks a reviewer of a matching rule is written as `**Verdict:** PARTIAL` and the todo
  stays in `review` (team mode or not). Sign-offs are kept per reviewed commits and carry forward while `**Commits:**`
  is unchanged; a CHANGES verdict clears them. A person, the lead or an actor in `owners.override` may override with a
  reason, recorded as `**Override:**`.
- `novadev owners [<path|area>] [--json]` answers who owns and who must review; sync and doctor audit the setting.

## How it works

`src/owners.ts`: the setting, glob matching (`*`, `**`, `?`; a key with no `/` matches a name in any folder),
`todoReviewRules` (area rules of the features a `**Feature:**` line names, path rules for the files of the record's
`**Commits:**`, the features' `touches` when no commit is known), `requiredReviews`, `requiredReviewerLines`,
`auditOwners`. Enforcement in `reviewTodo` (`src/todo.ts`) and `reviewGate` (`src/review.ts`).

## Progress

- 2026-11-12 — built: `2026-11-12_2/08-area-owners` (one reviewer per matching rule — the board's answer 4)

## Open questions

- IRRIS agents share one actor id (`claude-code/…`): required reviewers need distinct ids (e.g. `paperclip/reviewer`) before the rule can bite.
- A builder approving its own work is not detected: novadev does not know who built.
- If the setting changes so a PARTIAL review needs nothing more, the todo stays in `review` until someone reviews again.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
