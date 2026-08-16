# todos — task batches

<!-- managed by `novadev deploy`. -->

One batch = one folder `YYYY-MM-DD_N/` (`N` = same-day sequence, 1-based; `novadev
new` computes it). One todo = one folder inside the batch, optionally
order-prefixed (`01-…`); a `00-program` todo, when present, is the batch's owner
plan and is read first.

Inside a todo folder:
- **the brief** — human-authored `.txt`/`.md` files + optional screenshots;
- **the record** — written by the agent when work concludes: `ai_completed.md`
  (implemented + verified) or `ai_failed.md` (deferred / cancelled / merged /
  blocked — which case and why), or `ai_progress.md` while long-running work is
  still in flight.

Record formats and all rules: `../skills/workflow.md`. When every todo in a batch
has a terminal record, `novadev archive --done` moves the batch to `../archive/`.
