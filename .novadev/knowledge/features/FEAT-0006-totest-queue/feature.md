---
type: Feature
id: FEAT-0006
title: "The testing queue (totest), walked by a tester agent"
description: "Hand what the builder's own tests cannot show to a TESTER agent as a stepped test plan in totest/<task>/, gate the todo with ai_needstest.md so the batch cannot archive, and see each open round and who it waits on — a tester, or the human for an escalated ask — with `novadev totest` (or `--json`) and `novadev sync`."
feature-status: shipped
status: stable
area: testing
created: 2026-11-10
tags: [totest, tester, tester-agent, novadev-test, human-testing, escalation, test-plan, gate, needstest, confirmed, scenario, round, living-task]
touches: [src/totest.ts, src/test-queue.ts, templates/readmes/totest.md, templates/skills/novadev-test.md]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:109a980
  - resource: commit:c6b3335
  - resource: commit:72e0194
  - resource: commit:fb0170f
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-24T19:17:08+01:00 }
stale_after: 2027-11-24T19:17:08+01:00
---

# FEAT-0006 — The testing queue (totest), walked by a tester agent

## What it does

- One **living** test task per feature, `totest/FEAT-NNNN-<slug>/`: `test-plan.md`
  (frontmatter `id, created, updated, status, revision`; `## Scenario` sections with
  *Expect (pass)* and *Watch for (fail)*) and an empty `test-results/` for the person.
- **Who walks it:** a TESTER — an agent that did not build the work (`/novadev-test`,
  `templates/skills/novadev-test.md`). It builds the testing tools it needs, runs every
  scenario, records the results (FEAT-0010), escalates to the human only what it cannot run,
  then reviews the round: `ai_confirmed.md` (**Tested by**, **Tools built for it**,
  **Escalated to the human**), follow-up todos, plan `reviewed`; sync archives it as
  `rev<N>-<date>`. The builder never tests its own round (a playbook rule: actors are
  per model, so code cannot tell two sessions apart).
- The todo is gated with `ai_needstest.md` (`**Built by:**` the builder; not terminal: the
  batch stays out of the archive).
- **Who it waits on** (`roundState`, `src/test-queue.ts`): scenarios without a result → the
  tester (`test`); every scenario with a result or skipped → the tester closes it (`close`);
  only escalated scenarios left → the human. `sync` prints WAITING ON A TESTER and, for the
  asks, WAITING ON THE HUMAN — an open round is never the builder's NEXT ACTION.
- **Skipped by the owner** (FEAT-0010's `test-result skip`): a round closed without a full
  human test is `reviewed` with verdict `skipped` / `partly-skipped` and `skipped:` /
  `skipped-by:` in its plan; its todos carry `ai_testskipped.md` (not human-tested — never
  `ai_confirmed.md`); the feature's `tests.md` lists the round as skipped by the owner, and
  `novadev totest` shows a closed round as CLOSED until sync archives it.
- `novadev totest` lists every open round and who it waits on (`--json`: `tester`, `untested`,
  `needsHuman`; `readyForReview` = every scenario has a result);
  `--all` adds the archived rounds; `--json` gives it as data; `--new <slug>` scaffolds a
  task (refusing a second one for the same feature), `--round <task>` revives a task from
  its newest archived round so the agent can revise the plan for a new round;
  `--todo(s)`, `--feature`, `--scope` fill the new plan's header.

## How it works

`src/totest.ts` (CLI, `testPlanSkeleton` — its header asks for **Why this needs a tester**
and **Tools**); `src/test-queue.ts` (`roundState`, `testQueue`, the sync/status lines,
`roundJson`); the task and round readers (`listTestTasks`, `listTestRounds`) are in
`src/lib.ts`. Recording results and escalations is FEAT-0010.

## Progress

- 2026-08-27 — landed in 0.4.0 (commit 109a980): the queue with a non-terminal gate
- 2026-08-27 — 0.5.0 (commit c6b3335): one living task per feature, revised in place
- 2026-08-28 — 0.6.0 (commit 72e0194): reviewed rounds archive to `archive/<year>/totest/`
- 2026-10-25 — 0.15.0 (commit fb0170f): `totest --json`
- 2026-11-12 — rounds skipped by the owner (`2026-11-12_1/02-totest-skip-scenarios-and-close-round`)
- 2026-11-24 — testing is a tester agent's job: `/novadev-test`, WAITING ON A TESTER, the human only for escalations (`2026-11-24_3/01-tester-agent-testing`); tests/tester-testing.test.ts

## Open questions

- Only `--json` has an automated test (`tests/todo-json.test.ts`); `--new`, `--round` and the gate's archive behaviour are untested.
- `novadev help` names `--round` now, but not `--todo(s)`, `--feature` or `--scope`.
- The derived `tests.md` still says "Human test rounds" / "awaiting the human" (left so `sync --check` does not fail in every consumer worktree; see `postponed/tests-md-wording.md`).

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
