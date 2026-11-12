# prompt — worktree-batch-claims-files-only

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## A batch started inside a worktree claims only that worktree's files; `novadev worktree claim` adds a file claim the gate sees

Board (Filipp, 2026-11-12), question card on IRR-194 (finding 1 of IRR-174): chose "File it in novadev's repo" for the proposal "a batch started in a worktree claims only files (the worktree's claims / `--claim`), and a `novadev worktree claim <name> <path> [--allow-overlap]` the gate sees". No further notes.

Note for whoever runs this: it overlaps two todos of this batch. 01 (gate reads the batch's `work claim` claims) — and the board's scope there said "no new `novadev worktree claim` command"; this later yes asks for one, so settle with the owner whether 01's gate fix already covers it. 03 (`work start --todo` claims only from the named todos' features) — this todo goes further: inside a worktree, no claims derived from features' `touches:` at all.

## Context from the conversation

Found by the IRRISketchV1 Paperclip team on task IRR-174 (IRRIS _ecosystem, batch 2026-11-07_3, worktree irr-174-ai-credits-rest, novadev 0.16.0).

What happened: `novadev work start 2026-11-07_3` in that worktree was refused, both at the start and again after another worktree (IRR-147) merged: "Batch 2026-11-07_3 claims paths another worktree's batch owns — repos/irris/routes/account overlaps …/account.js (irr-152); repos/irris/models overlaps …/models/account.js (irr-152); repos/irrippr/js/ui/zoneFacts.js (irr-152); repos/irrippr/util/hydra-check/info-mail.js (irr-152)". The batch derives FOLDER claims from its features' `touches:` (most likely FEAT-0007 / FEAT-0023), although the task changed none of those files and every file claim of the worktree had been granted at `worktree create`.

Oddity: `novadev work claim 2026-11-07_3 <file>` DID add files to the batch's PAUSED lock (ask.js, tutorials-ask-site.js, routes/tutor.js) while `work start` stayed refused. Effect: no live batch lock; files the lead allowed with `--allow-overlap` later (19 paths) are not among the worktree's claims, so the gate listed them as "changed outside the claims" and the lead had to accept a red gate by hand.

Wanted (proposal):
1. `work start <batch>` run inside a worktree claims only the worktree's own claims plus any `--claim` paths — not the folders derived from the features' `touches:`.
2. `novadev worktree claim <name> <path…> [--allow-overlap]` adds file claims to an existing worktree's registry entry, with the same overlap check as `worktree create`, and the gate reads them.
3. `work claim` on a paused lock and `work start` agree (both refuse or both accept).

Test: worktree W2 holds file F in folder D; worktree W1's batch has a feature touching D; `work start` in W1 (claims not including F) passes; `worktree claim W1 F` is refused without `--allow-overlap` and accepted with it; after that a change to F in W1 passes the gate.
