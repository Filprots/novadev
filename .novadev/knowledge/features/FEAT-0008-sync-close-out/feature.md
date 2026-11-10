---
type: Feature
id: FEAT-0008
title: "sync: the close-out, and its --check gate"
description: "Run `novadev sync` after every round to measure (if set), regenerate every derived file, archive what is finished, validate the tree, and get two lists — NEXT ACTIONS for the agent and WAITING ON THE HUMAN; `--check` writes nothing and fails, for a hook or CI."
feature-status: shipped
status: stable
area: close-out
created: 2026-11-10
tags: [sync, close-out, next-actions, waiting-on-the-human, check, gate, ci, hook, derived]
touches: [src/sync.ts, tests/sync.test.ts]
depends-on: [FEAT-0004, FEAT-0005, FEAT-0011, FEAT-0012, FEAT-0013, FEAT-0014]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:271ac00
  - resource: commit:a33c803
  - resource: commit:185be32
  - resource: commit:6655fee
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0008 — sync: the close-out, and its --check gate

## What it does

`novadev sync`, in order: refuses a project behind the installed version; runs the metrics
hook (FEAT-0011); regenerates derived content (features' `work.md`/`tests.md`, the metrics
snapshot and wiki budgets block, every knowledge `index.md`, each feature's OKF `status`);
archives what is finished (FEAT-0004); validates links, knowledge, placement and locks;
prints PROBLEMS, the batches *in work*, batches held for their grace period, then
**NEXT ACTIONS** (abandoned locks, knowledge to build or re-check, todos without records,
walked tests to review, link notes, postponed triggers, metrics growth, placement) and
**WAITING ON THE HUMAN** (tests to walk, paused batches). Exit 1 on problems.

`novadev sync --check` writes nothing and fails on problems, stale derived files, an
unreadable snapshot, a budget raise not yet written, an uncheckable or exceeded budget.

The agent works the list and re-runs sync — at most three passes (the playbook's rule).

## How it works

`src/sync.ts` only orchestrates; every judgement is an audit function shared with
`novadev doctor` (FEAT-0003). See the wiki's architecture page for the step-by-step flow.

## Progress

- 2026-08-29 — landed in 0.7.0 (commit 271ac00): one gateway loop closed out by `novadev sync`
- 2026-09-01 — 0.8.0 (commit 0910083): batches held for the grace period are listed
- 2026-10-01 — 0.10.0 (commit a33c803): the metrics step and the `--check` gate
- 2026-10-11 — 0.12.0 (commit 185be32): the knowledge audit and derived indexes
- 2026-10-25 — 0.14.0 (commit 6655fee): the "in work" block; abandoned and paused locks

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
