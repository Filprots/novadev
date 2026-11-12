# ai_completed — totest-skip-scenarios-and-close-round

**Date:** 2026-11-12
**Feature:** FEAT-0006, FEAT-0010
**Commits:** d9caccd

## Prompt
A command to mark totest scenarios (or the rest of a round) `skipped` with who decided and why,
keep the real verdicts, close and archive the round like a review, link it from the feature's
tests.md as skipped by the owner, mark the originating todos with a distinct "not human-tested"
record (never ai_confirmed); the playbooks know the skipped state. First user: IRRIS FEAT-0001
(skip all but scenarios 1, 2, 5, 11).

## What I did
- `novadev test-result skip <payload.json>` — `{ taskId, scenarios: [n,…] | "rest", by, reason }`
  (a JSON payload, like the other agent-facing commands: the reason is prose). `src/test-results.ts`
  `skipScenarios`: reads the plan's scenarios and the verdicts already in test-results/
  (`recordedVerdicts`: `## / ### Scenario N` blocks of scenario-N.txt, review.md, a hand-written
  results.md — `**Verdict:**` or the first word); appends the skipped ones with by/reason to
  `test-results/skipped.md`; refuses a scenario with a recorded verdict, an unknown number, an
  empty reason, and a `by` that is not a person (`human:<id>` or `human` → git's user.name).
- When no scenario is left open it closes the round: plan `status: reviewed`, `verdict: skipped`
  (nothing tested) or `partly-skipped`, `last-tested`, `skipped: <n>`, `skipped-by: <actor>`, a
  `## Revisions` line; each todo in the plan's `todos:` whose `ai_needstest.md` waits on this task
  gets `ai_testskipped.md` (new `RECORD_TESTSKIPPED`, "NOT tested by a human", the skipped and the
  person-tested scenarios) and loses `ai_needstest.md` — its state becomes `completed`, never
  `confirmed`. Recorded non-pass verdicts are named in `next` for a follow-up review. Archiving
  stays with `novadev sync`, exactly as after a review.
- `src/lib.ts` `TestRound.skipped/skippedBy`; `src/links.ts` tests.md line "skipped by the owner
  (<by>): N scenario(s) not tested by a human"; `src/totest.ts` shows a closed round as CLOSED;
  `src/doctor.ts` refuses `ai_needstest.md` beside `ai_testskipped.md`; `src/todo.ts` shows it.
- Docs: README ("Skipping a test", command list), HELP, `templates/readmes/totest.md`, the three
  playbooks (`novadev-work` phase 6, `novadev-what-to-test`, `novadev-test-review`); redeployed here.

## Placement
- `skipScenarios` and its helpers in `src/test-results.ts` (the test-result mechanics: 185 → 442
  lines); `scenariosIn` moved there from `src/test-result.ts` (the CLI) so both share it. No hubs
  are configured.

## Verification
- `tests/test-skip.test.ts` (3 tests, the first tests of `src/test-results.ts`): "rest" with one
  recorded pass → skipped.md, plan reviewed/partly-skipped/skipped: 3/skipped-by, Revisions line,
  ai_testskipped.md written, ai_needstest.md gone, no ai_confirmed.md, todo state completed,
  `totest` shows CLOSED, `sync` archives to rev3-<date>, tests.md has the skipped line, doctor and
  links name nothing; named scenarios (real verdict refused, unknown number, agent `by`, missing
  reason, round stays open with a gap, a later fail named in `next`, a second close refused); a
  round nobody walked → verdict `skipped`.
- `bun test`: 589 pass, 0 fail.

## Notes
- Not exercised on IRRIS FEAT-0001 (not to touch IRRIS). For it: first record scenarios 1, 2, 5,
  11 as passed (`test-result write`, the board's word on IRR-184), then `skip` with `"rest"`.
- The plan's `todos:` is kept on close (tests.md then shows the gated todos); phase 6 of a normal
  review clears it.
