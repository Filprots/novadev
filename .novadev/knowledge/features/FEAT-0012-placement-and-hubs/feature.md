---
type: Feature
id: FEAT-0012
title: "Placement check and hubs"
description: "Name a project's hubs (from the metrics snapshot or `hubs` in novadev.json) so that every record whose commits changed a hub must say in a `## Placement` section where its new code went, and see with `novadev features --hubs` which features lean on each hub."
feature-status: shipped
status: stable
area: metrics
created: 2026-11-10
tags: [placement, hubs, placementSince, record-section, features-hubs, god-files]
touches: [src/placement.ts, src/hubs.ts, src/feature-hubs.ts, tests/placement.test.ts, tests/features.test.ts]
depends-on: [FEAT-0005, FEAT-0011]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:2974044
  - resource: commit:262b3c7
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0012 — Placement check and hubs

## What it does

- **Hub paths** come from the metrics snapshot's `hubs[].path`, or else from
  `"hubs": ["src/editor/workbench/", …]` in `novadev.json` (off when absent, `null`, `[]`).
- **The check** (in `sync` and `doctor`): a work record of a todo still in `todos/`, dated
  on or after `placementSince`, whose `**Commits:**` name a commit that changed a file
  inside a hub, must carry a `## Placement` section that says something. Archived and older
  records are history, and are not checked. The playbook's PLAN phase asks the hub
  question before any code is written.
- `novadev features --hubs` lists, per hub, the features whose `touches:` overlap it,
  marking those with no path of their own off the hub.

## How it works

`src/hubs.ts` (where hub paths come from), `src/placement.ts` (`placementState`,
`auditPlacement`; asks git which files a commit changed via `commitPaths`),
`src/feature-hubs.ts` (the `--hubs` view, files only — the metrics command never runs).

## Progress

- 2026-10-01 — landed in 0.11.0 (commit 2974044): the `## Placement` section, the doctor/sync check, `hubs` and `placementSince`
- 2026-10-01 — (commit 262b3c7): `novadev features --hubs`

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
