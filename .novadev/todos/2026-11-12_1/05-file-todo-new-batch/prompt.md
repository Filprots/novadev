# prompt — file-todo-new-batch

**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — 2026-11-12

## `novadev file-todo` can start a new batch (`--new-batch` or a `batch` field), and the 8-per-filing limit is in the playbook

Board (Filipp, 2026-11-12), question card on IRR-215 (finding F4 of IRR-176): chose "Yes, file it (recommended)" for the proposal: a `--new-batch` option for `novadev file-todo` (or a `batch` field in the payload), and a note about the limit of 8 todos for each filing in the playbook. No further notes.

Wanted:
1. `novadev file-todo plan --new-batch` and `novadev file-todo file <payload> --new-batch` (or a top-level `"batch": "new"` in the payload) file into a fresh batch (`nextBatchName`), even when `planBatch` would reuse the most recent conversation batch.
2. The /novadev-file-a-todo playbook names the limit: at most 8 parts per filing (`MAX_PARTS` in `src/todo-filing.ts`), and what to do with more (file in two calls; with `--new-batch` only on the first).

Test: with a reusable conversation batch present, `plan --new-batch` answers `reused: false` and the next batch name; `file --new-batch` creates it; a second `file` without the flag reuses that new batch.

## Context from the conversation

Found by the IRRISketchV1 Paperclip team on task IRR-176 (IRRIS _ecosystem, novadev 0.16.0). Dev filed the nine AI-connector todos (a separate project of 8 stages plus two findings) with `novadev file-todo`. `plan` answered `reused: true` for batch 2026-11-12_2, which already held an unrelated todo 01 (driver fix, IRR-184), and there is no way to ask for a new batch. So the connector project now shares a batch with unrelated work, and the owner's "run batch 2026-11-12_2" would start both together; until this is fixed MiniFil hands that batch's todos one by one. The 8-parts limit (`MAX_PARTS = 8`) is not named in the playbook, so a filing of nine parts has to be split by trial.
