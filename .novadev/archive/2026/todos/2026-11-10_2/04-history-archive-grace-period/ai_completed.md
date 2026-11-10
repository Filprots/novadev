# ai_completed — 04-history-archive-grace-period

**Date:** 2026-11-10
**Feature:** FEAT-0004
**Commits:** bc17f04, 72e0194, 0910083

## Prompt
Retroactive record: link FEAT-0004 (Archive with a grace period) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `bc17f04` — 2026-08-16 novadev 0.1.0 — structured development system (deploy/new/status/archive/doctor + canonical playbooks + agent adapters)
- `72e0194` — 2026-08-28 novadev 0.6.0 — feature folders, namespaced archive, and version-aware migrations
- `0910083` — 2026-09-01 novadev 0.8.0 — archive grace period, so recent work stays in todos/

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
