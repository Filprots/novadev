---
type: Feature
id: FEAT-0020
title: Todo priority and order
description: "Give every todo a priority (urgent, high, normal, later) and 'do after' links to other todos — set when filing, changed by a person or the lead with who, when and why recorded — so every list is ordered, `work start` refuses a todo that still waits, and `todo priority --changed-since` reports every change for a digest."
feature-status: shipped
status: stable
area: todos
created: 2026-11-12
tags: [priority, urgent, order, after, links, waits-for, ready, lead, todo-json, history, digest]
touches: [src/todo-meta.ts, src/todo-links.ts, src/lead.ts, tests/todo-priority.test.ts, tests/todo-links.test.ts]
depends-on: [FEAT-0015, FEAT-0009, FEAT-0014]
supersedes: []
superseded-by: []
conflicts-with: []
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-12T15:39:48+01:00 }
stale_after: 2027-11-12T15:39:48+01:00
---

# FEAT-0020 — Todo priority and order

## What it does

- **Priority**: `urgent | high | normal | later` per todo, in `todos/<batch>/<todo>/todo.json` (no file = `normal`). Set
  when filing (`priority` per part of the `file-todo` payload) and with `novadev todo priority <ref> <level>
  [<payload.json>] [--by <actor>]`. A person may change it, and the lead (`"lead"` in novadev.json: one actor or a list);
  any other agent is refused. A lead's change needs a reason and is recorded with `"as": "lead"`.
- **Order**: `todo list`, `status`, `status --json` and sync's NEXT ACTIONS list urgent first, then the filing order;
  batches by their best open todo.
- **The report**: `novadev todo priority --changed-since <date> [--by-agent] [--json]` lists every recorded change (ref,
  from, to, by, person or agent, when, why) over open and archived todos — the source of the lead's morning digest.
- **"Do after" links**: `after` in the filing payload, `novadev todo after <ref> <ref…>` / `--clear` (recorded).
  `novadev work start` refuses a todo that still waits — there is no override flag: the link is cleared, on record. The
  lists say `ready` / `waits for …` once any todo has a link. sync and doctor: a link to no todo or a cycle is a PROBLEM,
  a link to a cancelled todo a NEXT ACTION.

## How it works

`src/todo-meta.ts` owns `todo.json` (`priority`, `after`, `history`; unknown keys kept), the order (`orderByPriority`,
`batchesByPriority`), `changePriority`, `priorityChanges` and the audit. `src/todo-links.ts` owns the links
(`refuseWaitingTodos`, called once per `work start` for all the todos it takes; `auditLinks`). `src/lead.ts` reads
`"lead"`. Neither module imports `src/todo.ts`. novadev does not authenticate callers: the lead is whoever passes that
actor; the rule holds through the record.

## Progress

- 2026-11-12 — built: priority (`2026-11-12_2/05-todo-priority`), links (`2026-11-12_2/06-todo-after-links`); the lead may change a priority, and the report (board's answer 1)

## Open questions

- In IRRIS the lead needs its own actor id (e.g. `paperclip/minifil`) before "the lead" means MiniFil only; the morning digest is a company instruction, not novadev's.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
