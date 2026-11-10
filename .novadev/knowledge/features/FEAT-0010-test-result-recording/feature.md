---
type: Feature
id: FEAT-0010
title: "Recording a person's test results"
description: "Walk the test queue with a person (`/novadev-what-to-test`) or take a round they already did (`/novadev-test-review`), and file what they found — verdicts, notes, change requests, screenshots — into the task's test-results/ with `novadev test-result tasks|write|review`, always appending."
feature-status: shipped
status: stable
area: testing
created: 2026-11-10
tags: [test-result, test-review, what-to-test, verdict, scenario, review-md, screenshots, append-only]
touches: [src/test-result.ts, src/test-results.ts, templates/skills/novadev-what-to-test.md, templates/skills/novadev-test-review.md]
depends-on: [FEAT-0006]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:dc73f7e
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
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
- A second pass **appends**; nothing a person reported is ever overwritten. Task ids are
  checked so nothing can be written outside `totest/`.

The next `novadev sync` sees the results and puts the review on the agent's list (FEAT-0006).

## How it works

`src/test-result.ts` (CLI, payload parsing, JSON answers) → `src/test-results.ts`
(`writeResult`, `writeReview`, `taskDir`); attachments are copied by `copyEvidence`,
which names clashes with `numbered` from `src/todo-filing.ts`.

## Progress

- 2026-09-09 — landed in 0.9.0 (commit dc73f7e): the two companion playbooks and `novadev test-result`

## Open questions

- No automated test covers `novadev test-result` or `src/test-results.ts`.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
