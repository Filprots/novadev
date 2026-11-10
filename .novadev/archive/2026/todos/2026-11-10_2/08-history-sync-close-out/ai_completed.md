# ai_completed — 08-history-sync-close-out

**Date:** 2026-11-10
**Feature:** FEAT-0008
**Commits:** 271ac00, a33c803, 185be32, 6655fee

## Prompt
Retroactive record: link FEAT-0008 (sync: the close-out, and its --check gate) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `271ac00` — 2026-08-29 novadev 0.7.0 — one gateway skill driving one loop, closed out by `novadev sync`
- `a33c803` — 2026-10-01 novadev 0.10.0 — a metrics hook, a debt budget in sync, a budgets block in the wiki
- `185be32` — 2026-10-11 novadev 0.12.0 — the project's knowledge becomes one Open Knowledge Format bundle, .novadev/knowledge/
- `6655fee` — 2026-10-25 novadev 0.14.0 — the work lock: working.md, `novadev work start/waypoint/pause/stop`, the /novadev-pause playbook, "in work" in status and sync

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
