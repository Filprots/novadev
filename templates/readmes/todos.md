# todos — task batches

<!-- managed by `novadev deploy`. -->

One batch = one folder `YYYY-MM-DD_N/` (`N` = same-day sequence, 1-based; `novadev
new` computes it). One todo = one folder inside the batch, optionally
order-prefixed (`01-…`); a `00-program` todo, when present, is the batch's owner
plan and is read first.

Inside a todo folder:
- **the brief** — human-authored `.txt`/`.md` files + optional screenshots; for a
  chat-initiated todo, the agent-transcribed `prompt.md`;
- **the record** — written by the agent when work concludes: `ai_completed.md`
  (implemented + verified) or `ai_failed.md` (deferred / cancelled / merged /
  blocked — which case and why), or `ai_progress.md` while long-running work is
  still in flight.

Todos are not only human-authored: when the human asks an agent in chat to
implement/fix/change something that no open todo covers, the agent must FILE it
here itself — transcribe the request as `prompt.md`, do the work, record the
outcome (plus its Thinking) — so chat-driven work is documented like any other.

Record formats and all rules: `../skills/workflow.md`. When every todo in a batch
has a terminal record, `novadev archive --done` moves the batch to `../archive/`.
