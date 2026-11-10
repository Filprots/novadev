---
type: Feature
id: FEAT-0013
title: "The knowledge bundle (OKF) and the knowledge log"
description: "Keep a project's wiki, memories and features as one Open Knowledge Format 0.2 bundle in .novadev/knowledge/ — every concept stamped with who wrote and who checked it and when it is due, every change recorded by `novadev knowledge log`, derived index.md maps, and `novadev knowledge` to search it and list what is stale, drifted or unverified."
feature-status: shipped
status: stable
area: knowledge
created: 2026-11-10
tags: [knowledge, okf, open-knowledge-format, wiki, memories, concept, log, provenance, trust, stale, drift, review-days, index]
touches: [src/okf.ts, src/knowledge.ts, src/knowledge-log.ts, src/knowledge-cmd.ts, tests/okf.test.ts, tests/knowledge.test.ts, tests/knowledge-drift.test.ts, tests/knowledge-folders.test.ts, tests/review-okf-findings.test.ts]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:bc17f04
  - resource: commit:185be32
  - resource: commit:089c71d
  - resource: https://github.com/GoogleCloudPlatform/open-knowledge-format
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0013 — The knowledge bundle (OKF) and the knowledge log

## What it does

- `.novadev/knowledge/` is an OKF 0.2 bundle: `wiki/` (a strict set of six `Wiki Page`s),
  `memories/` (`Guardrail`, `Gotcha`, `Decision`, `Guide`), `features/` (FEAT-0005), and any
  folder a project adds. Each concept has YAML frontmatter: `type`, `title`, a one-line
  `description`, `tags`, `sources` (`repo:`, `todo:`, `commit:`, URLs, other concepts).
- `novadev knowledge log <payload.json>` records changes — `create`, `update`, `verify`,
  `deprecate`, `remove` — writing each concept's stamps (`generated`, `verified`,
  `stale_after`) and its `log.md` entry together, all events or none. `"by": "human"`
  takes the person's id from git.
- `novadev sync` derives every `index.md` (the load-first map), each feature's OKF
  `status`, and checks that `log.md` knows every change; it lists as NEXT ACTIONS a missing
  wiki or registry, concepts past `stale_after`, concepts whose `repo:` source has a newer
  commit (**drift**, asked of the repository that holds the path), unrecorded edits, and
  sources that are gone.
- `novadev knowledge [words]` summarises or searches the bundle; `--type`, `--tag`,
  `--tier unverified|machine-confirmed|human-reviewed`, `--stale`, `--drifted` filter.
- Review days per top-level folder (`knowledge.reviewDays` in `novadev.json`, default wiki
  90 / memories 180 / features 365, `"*"` for the rest, `null` = never due) and one-line
  folder descriptions for the map (`knowledge.folders`).

## How it works

`src/okf.ts` is the format layer only (frontmatter, YAML via `Bun.YAML`, actors,
timestamps, index and log rendering) and imports nothing of novadev's. `src/knowledge.ts`
is novadev's profile on top: concept roles, required keys, settings, `derivedIndexes`,
`auditKnowledge`, `sourceDrift`. `src/knowledge-log.ts` writes the stamps and the log;
`src/knowledge-cmd.ts` is the CLI.

## Progress

- 2026-08-16 — 0.1.0 (commit bc17f04): `wiki/` and `memories/` folders with hand-kept INDEX.md files
- 2026-10-11 — landed in 0.12.0 (commit 185be32): one OKF bundle, the stamps, `novadev knowledge` and `knowledge log`, derived indexes
- 2026-10-12 — 0.13.0 (commit 089c71d): review days for any folder, folder descriptions in the map, source drift

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
