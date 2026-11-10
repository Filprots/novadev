---
type: Feature
id: FEAT-0018
title: "The review record (ai_review.md) and team mode"
description: "A reviewer records APPROVE or CHANGES on a finished todo with `novadev todo review` (ai_review.md); CHANGES reopens it, and in team mode (\"team\": true) a todo is completed only once approved and its commits are on the default branch."
feature-status: shipped
status: stable
area: work
created: 2026-11-10
tags: [review, ai-review, approve, changes, code-review, reviewer, team, team-mode, merged, default-branch, two-keys]
touches: [src/review.ts, tests/review.test.ts]
depends-on: [FEAT-0015, FEAT-0016, FEAT-0004]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: todo:2026-11-10_1/06-review-record
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T16:13:07+01:00 }
stale_after: 2027-11-10T16:13:07+01:00
---

# FEAT-0018 — The review record (ai_review.md) and team mode

Not the human-testing review of phase 6 (that is [FEAT-0006](../FEAT-0006-totest-queue/feature.md)):
this is a code review of a finished todo, by another agent, the lead or a person.

## What it does

- `novadev todo review <ref> <payload.json>` — `{ verdict: APPROVE | CHANGES, by: <actor>,
  checks: ["…" | { check, result }], findings?, notes? }` — writes `ai_review.md` beside
  `ai_completed.md` (the previous review goes to `.review-history/`). Checks are required; a
  CHANGES verdict needs findings; `by` must be an actor (`"human"` = git's user).
- A CHANGES verdict reopens a completed todo in every project: state `changes`, a NEXT ACTION,
  its batch not complete.
- Team mode, `"team": true` in novadev.json: a finished todo is `review` until approved and
  `unmerged` until merged — every commit on its `**Commits:**` line reachable from the default
  branch (a sub-repo's `repo@hash` from that repository's default branch), or, with no commits,
  the record itself committed there. sync lists both under WAITING ON REVIEW OR MERGE, not as
  NEXT ACTIONS. Neither takes an addendum. Derived files leave the merge out (`todoState(dir,
  { merged: false })`): `work.md` shows an approved todo as completed in every clone, so `sync
  --check` does not depend on how deep a clone is.

## How it works

`src/review.ts`: `parseVerdict`, `reviewVerdict`, `teamMode`, `reviewGate` (asked by `todoState`
in `src/lib.ts` for a todo with ai_completed.md; lib.ts and review.ts import each other, so
review.ts runs nothing at load time), `merged` (git: `defaultBranch`, `isAncestor`,
`fileOnBranch`; answers cached per run), `parseReviewPayload`, `renderReview`. `src/todo.ts`
has the command; `src/sync.ts` the action and the waiting list. Only open todos (in `todos/`)
are gated; archived ones keep the state their records give.

## Progress

- 2026-11-10 — built: `2026-11-10_1/06-review-record`
- 2026-11-10 — fixes from the independent review of batch 2026-11-10_1, before the 0.16.0 release (`2026-11-10_1/07-worktree-command`)

## Open questions

- Self-review is forbidden by the playbook only: a record does not name its builder, so the
  command cannot compare.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
