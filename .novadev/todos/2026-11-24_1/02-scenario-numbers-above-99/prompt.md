# prompt — scenario-numbers-above-99

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-24

## `novadev test-result write` refuses a scenario number above 99

Reported by the IRRISketch company's Tester through the board (2026-11-24, novadev 0.18.0): "novadev 0.18.0 does not record scenario numbers above 99 (\"Scenario number must be 1-99, got '460'\"). Scenarios 460–465 of FEAT-0001 passed, but novadev has no record of them. Their results are only in this task." — "Until novadev changes, 460–465 show as not tested."

Wanted: `novadev test-result write` records a result for any scenario number a test plan can have (IRRISketch's FEAT-0001 plan has scenarios numbered above 460), and everything that reads test-results/ (the queue, the review, the links) reads those files.

## Context from the conversation

The limit is in src/test-results.ts (writeResult): `scenario < 1 || scenario > 99`.
