# ai_completed — 11-history-metrics-debt-budget

**Date:** 2026-11-10
**Feature:** FEAT-0011
**Commits:** a33c803, 75f4cdc, 1d41920, c1c79af

## Prompt
Retroactive record: link FEAT-0011 (Metrics hook, debt budget and the wiki budgets block) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `a33c803` — 2026-10-01 novadev 0.10.0 — a metrics hook, a debt budget in sync, a budgets block in the wiki
- `75f4cdc` — 2026-10-01 fix(metrics): never rewrite hand-written wiki text, and close the budget's gaps
- `1d41920` — 2026-10-01 fix(metrics): a raise counts only in its own round, and a code fence never makes sync add a block twice
- `c1c79af` — 2026-10-01 fix(metrics): one verdict for one tree — the gate refuses an unwritten raise, and a raise line is judged against the last commit

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
