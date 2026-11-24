---
title: The derived tests.md still speaks of human testing ("Human test rounds", "awaiting the human")
postponed: 2026-11-24
do-when: the next version bump (consumer worktrees re-sync then anyway), or a quiet moment with few open consumer worktrees
discard-if: tests.md is no longer derived, or its wording was changed in another todo
---
Batch 2026-11-24_3 moved testing to a tester agent but left the text that `src/links.ts`
derives into every feature's `tests.md` as it was: the heading `Human test rounds`
(`derivedScaffold`), the description `The human test rounds of …` (`derivedHeader`), and in
`renderTests` "The human testing of …", "(none — nothing is waiting on a human right now)",
"awaiting the human", "(no human testing has been completed …)", "not tested by a human".

Changing derived text makes every feature's `tests.md` stale at once, and `novadev sync
--check` — which `novadev worktree gate` runs — fails in every open worktree of a consumer
project until it syncs (IRRISketch had ~20). Do it together with a bump: say "test rounds",
"waiting on a tester", and add the open round's `tester` state (`roundState` in
`src/test-queue.ts`). Update the assertions in tests that read tests.md.
