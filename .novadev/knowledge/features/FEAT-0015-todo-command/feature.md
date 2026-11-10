---
type: Feature
id: FEAT-0015
title: "novadev todo: one todo at a time, away from the repository"
description: "Let a tool acting for a person who is away from the repository (a chat bot) list open todos, show one as JSON, append a dated chat addendum with attachments, edit a brief (keeping the old one), or cancel a todo — `novadev todo list|show|addendum|edit|cancel` — under the playbook's intake rules."
feature-status: shipped
status: stable
area: work
created: 2026-11-10
tags: [todo, remote, chat-bot, json, addendum, attachments, edit, brief-history, cancel, ref]
touches: [src/todo.ts, tests/todo-json.test.ts]
depends-on: [FEAT-0009, FEAT-0014]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:fb0170f
  - resource: commit:772a96c
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:44:33+01:00 }
stale_after: 2027-11-10T15:44:33+01:00
---

# FEAT-0015 — novadev todo: one todo at a time, away from the repository

## What it does

- `novadev todo list [--state open,progress,…] [--json]` — the open todos, titles and states.
- `novadev todo show <ref>` — one todo as JSON: its brief and its records.
- `novadev todo addendum <ref> <payload.json>` — `{ text, attachments }`: a dated *Chat
  addendum* appended to the brief; attachments (a screenshot sent later) are copied into the
  todo folder and named in it. Text is optional when files come.
- `novadev todo edit <ref> <payload.json>` — `{ title, request, context, reason }`: the
  brief changed where asked; the previous brief kept in the todo's `.brief-history/`, the
  change noted at the end, dated.
- `novadev todo cancel <ref> <payload.json>` — `{ reason }`: an `ai_failed.md` of the
  *cancelled* kind.
- A ref is `2026-10-16_2/02-router-…`, `2026-10-16_2/02`, or a word only one open todo's
  slug has. The writes refuse a todo with a terminal record or a test gate (that needs a
  new todo) and a batch in live work (a `working` lock whose holder is still there); a
  paused batch accepts them.

## How it works

`src/todo.ts`; attachment copying (`copyAttachments`) comes from `src/todo-filing.ts`
(FEAT-0009), the lock check (`readWorkLock`, `lockLiveness`) from `src/work.ts` (FEAT-0014). JSON in, JSON out, errors as
`{ "error": … }`.

## Progress

- 2026-10-25 — landed in 0.15.0 (commit fb0170f): `todo list/show/addendum/cancel`, with `status --json` and `totest --json`
- 2026-11-04 — (commit 772a96c): attachments on `addendum`, and `todo edit` — no version bump yet
- 2026-11-10 — `todo review` writes a reviewer's ai_review.md ([FEAT-0018](../FEAT-0018-review-and-team-mode/feature.md)); a todo waiting for its review or merge takes no addendum (`2026-11-10_1/06-review-record`)

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
