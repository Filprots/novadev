---
type: Feature
id: FEAT-0005
title: "Features registry and the link graph"
description: "Register each capability as knowledge/features/FEAT-NNNN-<slug>/feature.md, search the registry before building (`novadev features`, `--touching <path>` for overlap, `--new <slug>` to scaffold), and get each feature's work.md and tests.md derived from the records and test rounds that name it (`novadev links [--fix]`)."
feature-status: shipped
status: stable
area: knowledge
created: 2026-11-10
tags: [features, registry, feature-md, touches, overlap, links, link-graph, work-md, tests-md, commits, derived]
touches: [src/features.ts, src/links.ts, tests/features.test.ts]
depends-on: [FEAT-0013]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:2ec3236
  - resource: commit:72e0194
  - resource: commit:01411ee
  - resource: commit:185be32
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0005 — Features registry and the link graph

## What it does

- `novadev features [query]` searches the registry (id, title, description, area, tags,
  touches, body); `--status` and `--area` filter; `--touching <path>` lists the features
  whose `touches:` overlap a path — the pre-flight against duplicates and conflicts;
  `--new <slug>` allocates the next `FEAT-NNNN` and scaffolds `feature.md` (also
  `--title`, `--tags`, `--touches`). `--hubs` is FEAT-0012.
- The link graph: a record's `**Feature:**` and `**Commits:**` lines are the authored side;
  each feature's `work.md` (its todos, records, commits) and `tests.md` (its human test
  rounds and verdicts) are the derived side, rewritten between `<!-- novadev:work:… -->`
  and `<!-- novadev:tests:… -->` markers. `novadev links` validates it — unknown FEAT ids,
  one-way supersession, records with no `**Feature:**`, commits git does not know,
  "shipped" with no completed work or with a failed latest round, "planned" with
  completed work — and `--fix` regenerates the derived files (sync does too).

## How it works

`src/features.ts` (search, scaffold via `featureSkeleton`); `src/links.ts` (`auditLinks`
returns problems, notes and the derived-file fixes). Features are concepts of the
knowledge bundle (FEAT-0013): `feature-status` is novadev's lifecycle key and OKF `status`
is derived from it. All references are stable ids, never paths, because archiving moves
folders.

## Progress

- 2026-08-24 — landed in 0.3.0 (commit 2ec3236): features registry + link graph
- 2026-08-28 — 0.6.0 (commit 72e0194): a feature becomes a folder, with derived work.md and tests.md
- 2026-08-30 — fix (commit 01411ee): only the latest test round's verdict counts for "shipped"
- 2026-10-11 — 0.12.0 (commit 185be32): the registry moves into the knowledge bundle; `feature-status`, YAML lists

## Open questions

- `novadev links` has no direct CLI test; its audit runs in every `sync`/`doctor` test.
- A project that adopts novadev with history but no records gets one NEXT ACTION per "shipped" feature ("no completed todo links to it") — true of this repository's own registry.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
