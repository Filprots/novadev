---
name: novadev-test
description: "Be the TESTER of a novadev test round: an agent that did not build the work takes an open round in .novadev/totest/, builds the testing tools it needs (harnesses, drivers, fixtures, scripts — kept in the project), runs every scenario itself, records results with evidence, escalates to the human only the scenarios it truly cannot run (the smallest ask), then reviews the round and closes the gate (ai_confirmed.md, follow-up todos for failures). Use when they say \"/novadev-test\", \"test it\", \"run the test round\", or when `novadev sync` lists WAITING ON A TESTER and you did not build that work."
---

<!-- adapter managed by `novadev deploy` — the canonical playbook lives at .novadev/skills/novadev-test.md -->

Read the canonical playbook at `.novadev/skills/novadev-test.md` in full, then execute it in this
project. That file is the single source of truth; this adapter only routes to it.
