# ai_completed — 05-history-features-and-links

**Date:** 2026-11-10
**Feature:** FEAT-0005
**Commits:** 2ec3236, 72e0194, 01411ee, 185be32

## Prompt
Retroactive record: link FEAT-0005 (Features registry and the link graph) to the commits that built it, from before novadev tracked
this repository.

## What I did
Read the history of the feature's code (`git log`) and named the commits that built or reshaped it.
No code changed. The commits:

- `2ec3236` — 2026-08-24 novadev 0.3.0 — features registry + link graph
- `72e0194` — 2026-08-28 novadev 0.6.0 — feature folders, namespaced archive, and version-aware migrations
- `01411ee` — 2026-08-30 fix(links): judge only the LATEST test round's verdict for the shipped-feature warning
- `185be32` — 2026-10-11 novadev 0.12.0 — the project's knowledge becomes one Open Knowledge Format bundle, .novadev/knowledge/

## Placement
Nothing new placed — a record of past work.

## Verification
Each hash is a commit in this repository (`novadev links` resolves them). The suite at 772a96c: `bun test`, 508 pass, 0 fail.

## Notes
Reconstructed from git history on 2026-11-10 (batch 2026-11-10_1 needed the registry first). The
feature's own `## Progress` says what each release added.
