# ai_completed — 01-history-deploy-and-adapters

**Date:** 2026-11-10
**Feature:** FEAT-0001
**Commits:** bc17f04, 271ac00, dc73f7e, 6655fee

## Prompt
Retroactive record: link FEAT-0001 (Deploy: the novadev tree, the playbooks and the agent adapters) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `bc17f04` — 2026-08-16 novadev 0.1.0 — structured development system (deploy/new/status/archive/doctor + canonical playbooks + agent adapters)
- `271ac00` — 2026-08-29 novadev 0.7.0 — one gateway skill driving one loop, closed out by `novadev sync`
- `dc73f7e` — 2026-09-09 novadev 0.9.0 — four novadev-* skills: the loop, plus the human's three entry points
- `6655fee` — 2026-10-25 novadev 0.14.0 — the work lock: working.md, `novadev work start/waypoint/pause/stop`, the /novadev-pause playbook, "in work" in status and sync

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
