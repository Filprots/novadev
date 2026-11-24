---
type: Feature
id: FEAT-0010
title: "Recording test results — the tester's, and a person's"
description: "File what a test round found — the tester agent's verdicts and evidence, a person's walk of an escalated scenario (`/novadev-what-to-test`) or round (`/novadev-test-review`) — into the task's test-results/ with `novadev test-result tasks|write|review` (with who tested), always appending; and the tester's asks to a person with `test-result escalate`."
feature-status: shipped
status: stable
area: testing
created: 2026-11-10
tags: [test-result, test-review, what-to-test, verdict, scenario, review-md, screenshots, append-only, tested-by, escalate, needs-human]
touches: [src/test-result.ts, src/test-results.ts, templates/skills/novadev-what-to-test.md, templates/skills/novadev-test-review.md]
depends-on: [FEAT-0006]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:dc73f7e
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-24T19:17:08+01:00 }
stale_after: 2027-11-24T19:17:08+01:00
---

# FEAT-0010 — Recording a person's test results

## What it does

- `novadev test-result tasks [query]` — the open queue as JSON with each task's scenarios,
  resolving how a person names a task ("16", "the selection one").
- `novadev test-result write <payload.json>` — one scenario's verdict (and any
  screenshots), appended to `test-results/scenario-<N>.txt` (the `/novadev-what-to-test` walk).
- `novadev test-result review <payload.json>` — a whole round (verdict, per-scenario
  notes, change requests, files) appended as a dated block to `test-results/review.md`
  (the `/novadev-test-review` write-up), attachments copied in.
- `novadev test-result skip <payload.json>` — `{ taskId, scenarios: [n,…] | "rest", by, reason }`:
  the owner's decision that scenarios will not be tested, appended to `test-results/skipped.md`
  with who (`by` must be a person) and why; a recorded verdict is never skipped; when nothing is
  left open it closes the round (FEAT-0006) and replaces each gated todo's `ai_needstest.md` by
  `ai_testskipped.md`.
- `write` and `review` take `"by"` — who tested (an actor; `"human"` is git's user.name) —
  written as `**Tested by:**` (after the verdict line, so the verdict is still read first).
- `novadev test-result escalate <payload.json>` — `{ taskId, scenarios, by, ask, tried }`: the
  tester's ask to a person, appended to `test-results/needs-human.md`. `by` must be an agent;
  a scenario that already has a result (or is skipped) is refused. The ask stays open until
  each scenario has a result or is skipped; it is not a result (`hasResults` ignores the file).
  `tasks` answers each task's `tester`, `untested` and `needsHuman`.
- A second pass **appends**; nothing a person reported is ever overwritten. Task ids are
  checked so nothing can be written outside `totest/`.

The next `novadev sync` sees the results and puts the review on the agent's list (FEAT-0006).

## How it works

`src/test-result.ts` (CLI, payload parsing, JSON answers) → `src/test-results.ts`
(`writeResult`, `writeReview`, `taskDir`, `escalate`, `escalations`); attachments are copied by `copyEvidence`,
which names clashes with `numbered` from `src/todo-filing.ts`.

## Progress

- 2026-09-09 — landed in 0.9.0 (commit dc73f7e): the two companion playbooks and `novadev test-result`
- 2026-11-12 — `test-result skip` (`2026-11-12_1/02-totest-skip-scenarios-and-close-round`); tests/test-skip.test.ts is the first test of `src/test-results.ts`
- 2026-11-24 — `test-result escalate`, and `by` on `write`/`review` (`2026-11-24_3/01-tester-agent-testing`); tests/tester-testing.test.ts
- 2026-11-24 — `test-result write` takes any scenario number a plan has; it refused every number above 99, so IRRISketch's FEAT-0001 round (scenarios 460–465) could not be recorded (`2026-11-24_1/02-scenario-numbers-above-99`); tests/test-result-write.test.ts

## Open questions

- `skip` (tests/test-skip.test.ts), `escalate` and `by` (tests/tester-testing.test.ts) have tests; `tasks` and `review` are covered only in part.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
