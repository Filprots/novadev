# ai_completed — 01-tester-agent-testing

**Date:** 2026-11-24
**Feature:** FEAT-0006, FEAT-0010

## Prompt

The owner: move away from manual human testing. The agent that builds a feature writes what
must be tested for a TESTER; the tester (an agent) goes through it and reviews the testing;
only when the tester cannot run a test itself does it reach out to the human. The tester's
main task is to build the testing tools, utils and platforms it needs to test thoroughly, and
to ask the human only for small things. Then update every project that uses novadev.

## What I did

- **Who a round waits on** — new `src/test-queue.ts` (`roundState`, `testQueue`, `askLines`,
  `testerLine`, `roundJson`): scenarios without a result → a tester (`test`); every scenario
  with a result or skipped → the tester closes it (`close`); only escalated scenarios left →
  the human. `novadev sync` prints a new **WAITING ON A TESTER** list; WAITING ON THE HUMAN now
  holds only the tester's open asks (and paused batches); the builder's NEXT ACTIONS no longer
  carry `REVIEW totest/…`. `novadev status`, `novadev totest` (+ `--json`), `status --json` and
  `test-result tasks` say the same (`tester`, `untested`, `needsHuman`; `readyForReview` =
  every scenario has a result).
- **`novadev test-result escalate`** (`src/test-results.ts` `escalate`/`escalations`,
  `src/test-result.ts`): `{ taskId, scenarios, by, ask, tried }` → `test-results/needs-human.md`
  (`ESCALATIONS_FILE` in `src/lib.ts`). `by` must be an agent; a scenario with a result or
  skipped is refused. Open until each scenario has a result or is skipped. Not a result:
  `hasResults` and `recordedVerdicts` ignore the file.
- **`by` on `test-result write` / `review`** → `**Tested by:**` (after the verdict line);
  `"human"` resolves to git's user.name.
- **Playbooks**: new `templates/skills/novadev-test.md` (the tester's: orient, take the round
  and lock the gated todo, build the tools — filed as their own todo, documented in the wiki —
  run every scenario with evidence, escalate the smallest ask, review and close by phase 6);
  `novadev-work` phases 5 and 6 rewritten (plan written for a tester; `**Built by:**` on the
  gate; builder never tests its own round; `ai_confirmed.md` gains **Tested by**, **Tools built
  for it**, **Escalated to the human**), the intro, folder map, playbook table and vocabulary;
  `novadev-what-to-test` now walks the tester's asks; `novadev-test-review` notes the tester
  closes the round; `SKILLS` (6), the deployed CLAUDE.md/AGENTS.md block and Cursor rule
  (`src/deploy.ts`), `templates/readmes/totest.md` and `root.md`, `totest`'s plan skeleton
  (**Why this needs a tester**, **Tools**) and results guide, help text, link/doctor wording.
- README: *Testing* section, sync sample, companion playbooks, the 2026-11-24 upgrade note.
- `tests/tester-testing.test.ts` (9 tests).

## Placement

- `src/test-queue.ts` — new, 0 → 70 lines: who a round waits on, read by sync, status, totest
  and test-result. Its own module so neither `src/lib.ts` (the hub) nor `src/test-results.ts`
  carries it; it imports both, and nothing imports it back but the four commands.
- `escalate` / `escalations` / `testedBy` — `src/test-results.ts`, 443 → 576 lines: the file
  that already owns every write into `test-results/` and the verdict reader they need.
- `ESCALATIONS_FILE` — `src/lib.ts` (+5 lines), beside `TEST_RESULTS_DIR`, because
  `listTestTasks` (in lib) must exclude it from results; nothing else was added to the hub.
- `src/sync.ts` 382 → 380, `src/status.ts` 320 → 321, `src/totest.ts` 386 → 398,
  `src/test-result.ts` 193 → 222: their own output only.

## Verification

- `bun test`: 776 pass, 0 fail (42 files) — was 767 before; the 9 new ones are
  tests/tester-testing.test.ts (sync/status/totest routing, `by`, `escalate` refusals, the ask
  closing on a result or a skip, `work start` on a gated todo, deploy of the new skill).
- `novadev deploy` here: created `.novadev/skills/novadev-test.md` and
  `.claude/skills/novadev-test/SKILL.md`; the managed CLAUDE.md block reads as intended.

## Decisions

- **Keep the `totest/` layout** (task per feature, `test-plan.md`, `test-results/`,
  `ai_needstest.md` → `ai_confirmed.md`): open rounds in consumer projects go to a tester as
  they are, with no migration and no version bump. Only who walks it changed.
- **The tester reviews and closes the round** (the owner: "tester goes through this and
  reviews the testing"), not the builder.
- **Builder ≠ tester is a playbook rule, not a code check**: actors are `<tool>/<model>`, so a
  fresh session or sub-agent of the same model has the same actor (memory
  `builder-is-not-tester-by-session`). Traceability instead: `**Built by:**`, `**Tested by:**`.
- **An escalation is tied to scenarios** and ends when they have a result (the person's, or the
  tester's after the person supplied what was missing) or are skipped — no separate "answered"
  command. A tester never skips; skipping stays the owner's decision.
- **Tooling is filed as its own todo** by the tester, so tool changes are recorded like any work.
- **Not changed**: the text derived into `tests.md` ("Human test rounds") — changing derived
  text fails `sync --check` (the worktree gate) in every open consumer worktree until it syncs.
  Postponed to the next bump (`postponed/tests-md-wording.md`).
- **No version bump** (still 0.18.0), as for 2026-11-24_1: a bump stops `novadev sync` in every
  open consumer worktree until it merges the stamped default branch.

## Notes

- Roll-out: `novadev deploy` in each consumer project's main checkout (their worktrees get the
  playbooks when they merge). Committing there waits for the owner's word (default branches).
