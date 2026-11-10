---
type: Feature
id: FEAT-0003
title: "Doctor: a read-only structure check"
description: "Run `novadev doctor` to validate a project's whole .novadev/ tree without changing anything — batch and todo naming, records, test tasks, the link graph, the knowledge bundle, metrics settings, placement, the locks, the deployed version — exiting 1 on problems."
feature-status: shipped
status: stable
area: close-out
created: 2026-11-10
tags: [doctor, validate, check, structure, read-only, version]
touches: [src/doctor.ts, tests/doctor-deploy-status.test.ts]
depends-on: [FEAT-0005, FEAT-0011, FEAT-0012, FEAT-0013, FEAT-0014]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:bc17f04
  - resource: commit:5c9f453
  - resource: commit:2974044
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0003 — Doctor: a read-only structure check

## What it does

`novadev doctor` reports PROBLEMS (exit 1) and notes, and writes nothing:

- batch names (`YYYY-MM-DD_N`), a batch whose name the archive already claimed (with the
  next free number), todos without a brief, stale `ai_progress.md`, archive year folders;
- `totest/` task names and folder shapes, archived round names, postponed headers;
- the deployed version against the installed CLI, in both directions, and playbook copies
  that are missing or differ from the installed ones (`novadev deploy` fixes both);
- everything the shared audits find: the link graph (FEAT-0005), the knowledge bundle
  (FEAT-0013), metrics settings and the wiki budgets block (FEAT-0011), the placement check
  (FEAT-0012), unreadable or abandoned locks (FEAT-0014). A stale derived file is reported,
  not rewritten — `novadev sync` writes it.

## How it works

`src/doctor.ts` runs its own folder-shape checks, then calls `auditLinks`,
`auditKnowledge`, `auditMetrics`, `auditPlacement` and `auditWork` — the same functions
`novadev sync` uses — so the two never disagree.

## Progress

- 2026-08-16 — landed in 0.1.0 (commit bc17f04)
- 2026-08-19 — 0.2.0 (commit 5c9f453): flags stale `ai_progress.md`; version-direction-aware
- 2026-10-01 — 0.11.0 (commit 2974044): the placement check
- 2026-10-11 — 0.12.0 (commit 185be32): the knowledge audit

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
