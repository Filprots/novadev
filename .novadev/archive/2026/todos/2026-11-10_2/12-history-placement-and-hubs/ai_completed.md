# ai_completed — 12-history-placement-and-hubs

**Date:** 2026-11-10
**Feature:** FEAT-0012
**Commits:** 2974044, 262b3c7

## Prompt
Retroactive record: link FEAT-0012 (Placement check and hubs) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `2974044` — 2026-10-01 novadev 0.11.0 — a "## Placement" section in records, a doctor check, a hub question in the PLAN phase
- `262b3c7` — 2026-10-01 feat(features): `novadev features --hubs` — which features lean on each hub, and which have no folder of their own

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
