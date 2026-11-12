---
type: Feature
id: FEAT-0006
title: "The human-testing queue (totest)"
description: "Hand work an agent cannot check to a person as a stepped test plan in totest/<task>/, gate the todo with ai_needstest.md so the batch cannot archive, and see what is waiting with `novadev totest` (or `--json`)."
feature-status: shipped
status: stable
area: testing
created: 2026-11-10
tags: [totest, human-testing, test-plan, gate, needstest, confirmed, scenario, round, living-task]
touches: [src/totest.ts, templates/readmes/totest.md]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:109a980
  - resource: commit:c6b3335
  - resource: commit:72e0194
  - resource: commit:fb0170f
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-12T08:15:26+01:00 }
stale_after: 2027-11-12T08:15:26+01:00
---

# FEAT-0006 — The human-testing queue (totest)

## What it does

- One **living** test task per feature, `totest/FEAT-NNNN-<slug>/`: `test-plan.md`
  (frontmatter `id, created, updated, status, revision`; `## Scenario` sections with
  *Expect (pass)* and *Watch for (fail)*) and an empty `test-results/` for the person.
- The todo is gated with `ai_needstest.md` (not terminal: the batch stays out of the
  archive). When results land, `sync` puts the review on the agent's list; the agent writes
  `ai_confirmed.md`, marks the round `reviewed`, and sync archives it as `rev<N>-<date>`.
- **Skipped by the owner** (FEAT-0010's `test-result skip`): a round closed without a full
  human test is `reviewed` with verdict `skipped` / `partly-skipped` and `skipped:` /
  `skipped-by:` in its plan; its todos carry `ai_testskipped.md` (not human-tested — never
  `ai_confirmed.md`); the feature's `tests.md` lists the round as skipped by the owner, and
  `novadev totest` shows a closed round as CLOSED until sync archives it.
- `novadev totest` lists what is waiting on the person and what is ready for review;
  `--all` adds the archived rounds; `--json` gives it as data; `--new <slug>` scaffolds a
  task (refusing a second one for the same feature), `--round <task>` revives a task from
  its newest archived round so the agent can revise the plan for a new round;
  `--todo(s)`, `--feature`, `--scope` fill the new plan's header.

## How it works

`src/totest.ts` (CLI, `testPlanSkeleton`); the task and round readers (`listTestTasks`,
`listTestRounds`) are in `src/lib.ts`. Recording the person's findings is FEAT-0010.

## Progress

- 2026-08-27 — landed in 0.4.0 (commit 109a980): the queue with a non-terminal gate
- 2026-08-27 — 0.5.0 (commit c6b3335): one living task per feature, revised in place
- 2026-08-28 — 0.6.0 (commit 72e0194): reviewed rounds archive to `archive/<year>/totest/`
- 2026-10-25 — 0.15.0 (commit fb0170f): `totest --json`
- 2026-11-12 — rounds skipped by the owner (`2026-11-12_1/02-totest-skip-scenarios-and-close-round`)

## Open questions

- Only `--json` has an automated test (`tests/todo-json.test.ts`); `--new`, `--round` and the gate's archive behaviour are untested.
- `novadev help` names only `--all`, `--json` and `--new`, not `--round`, `--todo(s)`, `--feature` or `--scope`; the header comment of `src/totest.ts` still describes the pre-0.6.0 `history/` rotation.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
