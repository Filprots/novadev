---
type: Feature
id: FEAT-0002
title: "Batches and the stock-take: novadev new and novadev status"
description: "Scaffold today's next batch of todo folders with `novadev new`, and see at a glance — or as JSON for a tool — what is in work, which todos are open and in what state, what is postponed, and how the knowledge and metrics stand with `novadev status`."
feature-status: shipped
status: stable
area: work
created: 2026-11-10
tags: [new, status, batch, todo, stock-take, json, records, todo-state]
touches: [src/new.ts, src/status.ts, tests/doctor-deploy-status.test.ts, tests/todo-json.test.ts]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:bc17f04
  - resource: commit:5c9f453
  - resource: commit:fb0170f
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:38:47+01:00 }
stale_after: 2027-11-10T15:38:47+01:00
---

# FEAT-0002 — Batches and the stock-take: novadev new and novadev status

## What it does

- `novadev new [slug…]` creates `todos/YYYY-MM-DD_N/` for today with the next free `N` —
  counting same-day batches already in the archive, so a name is never reused — and
  optional numbered todo folders (`01-<slug>`, `02-<slug>` …).
- `novadev status` prints the stock-take without an agent: the batches in work first (who
  holds each lock, since when, paused or abandoned), then every open batch with each todo's
  state (open, progress, completed, failed, needstest, confirmed), postponed items, sparks,
  the knowledge bundle's counts and trust, the features registry, metrics, the archive.
- `novadev status --json` gives the same as data, for a chat bot answering a person who is
  away from the repository.

## How it works

`src/new.ts` and `src/status.ts`; todo states come from `todoState` in `src/lib.ts` (the
record files present in the folder, `ai_needstest.md` outranking the rest). `statusData`
builds the JSON view; the lock lines come from `src/work.ts`.

## Progress

- 2026-08-16 — landed in 0.1.0 (commit bc17f04): `new` and `status`
- 2026-08-19 — 0.2.0 (commit 5c9f453): the batch number skips same-day batches already archived
- 2026-10-25 — 0.14.0 (commit 6655fee): status opens with whether a work cycle is on
- 2026-10-25 — 0.15.0 (commit fb0170f): `status --json`
- 2026-11-10 — `status` lists the repository's worktrees with each one's branch and batches in work; `status --json` has `worktrees` (`2026-11-10_1/01-worktree-visible-locks`)

## Open questions

- `novadev new` has no automated test; `status` is covered in `tests/doctor-deploy-status.test.ts`, `tests/work.test.ts` and (`--json`) `tests/todo-json.test.ts`.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
