---
type: Feature
id: FEAT-0009
title: "Filing a todo from chat"
description: "Turn what a person says in a chat (terminal or phone) into real todo folders — their words as a prompt.md brief, their screenshots copied in — with `/novadev-file-a-todo` and its command half, `novadev file-todo plan` and `file <payload.json>`."
feature-status: shipped
status: stable
area: work
created: 2026-11-10
tags: [file-todo, chat, intake, prompt-md, attachments, screenshots, filed-from-chat, batch-reuse]
touches: [src/file-todo.ts, src/todo-filing.ts, templates/skills/novadev-file-a-todo.md]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:5c9f453
  - resource: commit:dc73f7e
  - resource: commit:6655fee
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0009 — Filing a todo from chat

## What it does

- The playbook rule (phase 1, INTAKE): a chat request that changes the project and that no
  open todo covers becomes a todo before work starts.
- `/novadev-file-a-todo` (the companion playbook) shapes what the person said into one or
  more todos, shows the split, and waits for a yes.
- `novadev file-todo plan` answers (JSON) which batch the todos would land in and the next
  number: today's newest batch is reused only if a conversation created it (it carries
  `.filed-from-chat`), no todo in it has a record, and nobody holds its lock; otherwise a
  new batch.
- `novadev file-todo file <payload.json>` — `{ "parts": [ { slug, title, request,
  context?, attachments? } ] }`, at most 8 parts — creates the folders, writes each
  `prompt.md` brief, copies attachments in (never over a name novadev owns), and answers
  JSON (with `missingAttachments` when a file was not there).

## How it works

`src/file-todo.ts` is the thin CLI; `src/todo-filing.ts` owns the rules prose gets wrong:
batch reuse, numbering, slug normalising, the brief's shape, attachment names, and
**defanging** `**Feature:**`/`**Commits:**` lines quoted from an old record (an unknown
FEAT id in a brief is a hard `sync` failure). `src/todo.ts` (FEAT-0015) reuses its attachment
copying.

## Progress

- 2026-08-19 — 0.2.0 (commit 5c9f453): the chat-initiated work rule in the playbook
- 2026-09-09 — landed in 0.9.0 (commit dc73f7e): `novadev file-todo` and `/novadev-file-a-todo`
- 2026-10-25 — 0.14.0 (commit 6655fee): never files into a batch someone holds the lock of

## Open questions

- Only batch reuse versus the lock is tested (`tests/work.test.ts`); defanging, numbering, attachments and `MAX_PARTS` have no automated test.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
