# prompt — totest-skip-scenarios-and-close-round

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## Skip testing: mark scenarios (or a whole round) skipped and close the round without confirming the todos

Board (Filipp) on IRR-184, 2026-11-12, on the pace of the FEAT-0001 backlog rounds (443 scenarios, 30-60 min each for the agent tester): "Close all scenarios and mark them as skipped. If needed add such a feature to novadev (to skip testing (mostly if the result is not very important))"

## Context from the conversation

Today a totest round closes only through review in /novadev-work: an agent judges each scenario, writes ai_confirmed.md on every originating todo ("Confirmed means human verification"), sets the task reviewed and sync archives it to archive/<year>/totest/<task>/rev<N>-<date>/. The results guide already allows **Verdict:** skipped per scenario, but nothing closes a round whose scenarios were skipped on purpose: for IRRIS FEAT-0001-planner-drawer (rev 59, ~300 todos in `todos:`, 445 scenarios, 4 passed) closing it by hand would mean writing ai_confirmed on todos nobody verified.
Wanted (proposal): a command, e.g. `novadev totest --skip <task> [--scenarios <n,…|rest>] --reason "…"`, that records the skipped scenarios as `skipped` with who decided and why, keeps the real verdicts already recorded (pass/fail), closes and archives the round like a review, links it from the feature's tests.md as "skipped by the owner", and marks the originating todos as not tested by a human (a distinct record, not ai_confirmed) so nothing claims a verification that did not happen. The /novadev-work and /novadev-what-to-test playbooks should know the skipped state.
First user: IRRIS FEAT-0001 (skip every scenario except 1, 2, 5, 11, which passed by the board's word on IRR-184).
