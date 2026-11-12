# prompt — work-start-one-todo-claims

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## `work start` for one todo of a mixed batch: claims from that todo's features only

Board (Filipp, 2026-11-12), question card on IRR-180 (finding 2 of IRR-172): chose "File the novadev todo" for the proposal "a novadev todo for 'work start <batch> --todo <todo>' with claims only for that todo". No further notes.

## Context from the conversation

Found by the IRRISketchV1 Paperclip team on task IRR-172 (IRRIS _ecosystem, batch 2026-11-10_1, todo 06-bring-miga-into-ecosystem, worktree irr-172-miga-knowledge, novadev 0.16.0).

What happened: `novadev work start 2026-11-10_1` in worktree irr-172-miga-knowledge was refused: "Batch … claims paths another worktree's batch owns". `work start` (src/work.ts ~line 723) derives the batch's claims with `batchClaims` from the `touches:` of EVERY feature its todos link (here FEAT-0001 → repos/irrippr/ps, repos/irrippr/js, repos/irris/routes/project, …). Those overlapped worktrees irr-147-batch-2026-11-11-1 and irr-152-decoders, although todo 06 touches none of those paths. The team's rules forbid `--allow-overlap` without the lead, so the developer worked without the batch lock (only the worktree's own claims were registered and gate-checked).

Problem: the owner's batches are often mixed (unrelated todos in one batch), and the team runs several developers in parallel, one todo or part of a batch each. One todo cannot take the lock while other worktrees hold paths that only other todos of the same batch touch.

Wanted (proposal): `novadev work start <batch> --todo <nn|slug> [--todo …]` (or per-todo claims) that derives claims only from the named todos' linked features plus `--claim` paths, records in the lock which todos it covers, and lets another worktree start a different, non-overlapping todo of the same batch. `work stop`, `sync`, the gate and `/novadev-work` must understand a partly-locked batch. Test: batch with todo A (feature touching X) and todo B (feature touching Y); worktree 1 holds Y; `work start <batch> --todo A` passes; `--todo B` is refused as today.
