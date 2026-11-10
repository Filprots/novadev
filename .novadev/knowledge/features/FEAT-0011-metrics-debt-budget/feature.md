---
type: Feature
id: FEAT-0011
title: "Metrics hook, debt budget and the wiki budgets block"
description: "Let a project plug in one metrics command whose JSON (known debt, hubs) `novadev sync` stores in metrics/latest.json, compares with the last commit, lists every growth until a record explains it, and gates with a debt budget that only a `## Debt` raise in this round can lift."
feature-status: shipped
status: stable
area: metrics
created: 2026-11-10
tags: [metrics, debt, debt-budget, maxKnown, raise, snapshot, latest-json, hubs, budgets-block, check]
touches: [src/metrics.ts, src/metrics-audit.ts, src/debt-budget.ts, templates/readmes/metrics.md, tests/metrics-unit.test.ts, tests/metrics-audit.test.ts, tests/sync-metrics.test.ts, tests/record-history.test.ts, tests/review31-findings.test.ts, tests/review31-round2.test.ts, tests/review31-round3.test.ts]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:a33c803
  - resource: commit:75f4cdc
  - resource: commit:1d41920
  - resource: commit:c1c79af
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0011 — Metrics hook, debt budget and the wiki budgets block

## What it does

Opt-in through `novadev.json` (all off when absent or `null`; off in this repository):

- `"metrics": "<shell command>"` — sync runs it first (timeout `metricsTimeoutSeconds`,
  default 300) and reads `{ "debt": { "known", "new" }, "hubs": [ { name, measure, over,
  path } ] }` from its stdout. The result is stored in `.novadev/metrics/latest.json`
  (tracked, derived). Whatever GREW since the last commit's snapshot is a NEXT ACTION until a
  record of this round explains it. A missing or failing command is only a warning.
- `"debtBudget": { "maxKnown": N }` — known debt over the budget fails `sync --check`. A
  record's `## Debt` section with `**Raise:** <current> → <new>` and a reason raises it, in
  its own round only; sync writes the raise into `novadev.json` and remembers it in
  `debtBudget.raises`. Debt under the budget asks to lower `maxKnown`.
- A derived `## Budgets` block in a wiki page (`metricsWikiPage`, default
  `architecture.md`; `false` turns it off), between `novadev:budgets` markers, never
  touching hand-written text around it.

## How it works

`src/metrics.ts` (settings, running the command, the snapshot, deltas, `refreshMetrics`);
`src/debt-budget.ts` (raise syntax, the round rule via git, the ledger);
`src/metrics-audit.ts` (everything judged from files alone — shared by sync and doctor —
and the budgets block). The hub paths it reports feed FEAT-0012.

## Progress

- 2026-10-01 — landed in 0.10.0 (commit a33c803): metrics hook, debt budget, budgets block
- 2026-10-01 — fixes from three external reviews (commits 75f4cdc, 1d41920, c1c79af): never rewrite hand-written wiki text; a raise counts only in its own round; one verdict for one tree

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
