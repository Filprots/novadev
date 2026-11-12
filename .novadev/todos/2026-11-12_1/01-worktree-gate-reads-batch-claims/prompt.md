# prompt — worktree-gate-reads-batch-claims

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## The worktree gate also counts the claims added later with `novadev work claim`

Board (Filipp, 2026-11-12), on the proposal from IRR-147: "Yes do it!" — file it. Agreed scope: only the gate fix; no new `novadev worktree claim` command (once the gate reads both lists, `work claim` already does that job); no per-file ownership change (single-file claims and `--allow-overlap` on exact paths already work).

## Context from the conversation

Found by the IRRISketchV1 Paperclip team on task IRR-147 (batch 2026-11-11_1 in IRRIS _ecosystem, worktree irr-147-batch-2026-11-11-1, novadev 0.16.0); lead decisions IRR-151 and IRR-162.

What happened: the worktree was created with some claims; another worktree (IRR-148) held the whole folder irrippr:util/hydra-check, so 5 files there could not be claimed at creation. After the lead split that folder by file, Dev added them with `novadev work claim <batch> <paths> --allow-overlap` — accepted. `novadev worktree gate` still failed: "changed outside the claims (…)" for exactly those 5 files. The lead had to accept the gate failure by hand and quote it in the MR.

Cause: novadev keeps two claim lists — the worktree registry entry (`createWorktree`, src/worktree.ts ~line 224/295) and the batch lock's claims (`work claim`, `batchClaims` in src/registry.ts:340). The gate (src/worktree.ts ~line 365-367) checks changed files only against `entry.claims` (the worktree's creation-time list), not the claims of the batch in work in that worktree.

Expected: the gate accepts a changed file when it lies within the worktree's claims OR the claims of a batch locked in that worktree (the claimHolders data already has both). A test: create a worktree with claim A, `work claim` path B in its batch, change a file under B → gate passes; change a file under neither → gate still fails.

Related, out of scope here: the team will tell its developers to claim files rather than whole folders (their own worktree skill).
