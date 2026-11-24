---
type: Feature
id: FEAT-0024
title: Todo recipients
description: "Address a todo to a recipient — a team like `hq` (every actor `hq/…`) or one actor — when filing or with `novadev todo recipient`, so that only the recipient works it: the lists say `for <recipient>`, `novadev todo list --for <who>` is a recipient's own list, `work start` refuses anybody else, and sync lists addressed todos apart; a todo without one is anyone's."
feature-status: shipped
status: stable
area: todos
created: 2026-11-24
tags: [recipient, addressed, for, team, actor, hq, handover, note, todo-json, history, anyone, recipients-setting]
touches: [src/recipients.ts, src/todo-recipient.ts, src/todo-meta.ts, tests/todo-recipient.test.ts]
depends-on: [FEAT-0020, FEAT-0015, FEAT-0009, FEAT-0014]
supersedes: []
superseded-by: []
conflicts-with: []
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-24T13:28:32+01:00 }
stale_after: 2027-11-24T13:28:32+01:00
---

# FEAT-0024 — Todo recipients

## What it does

One team leaves work, a note or a remark for another in the same todo queue, and nobody else takes it by mistake.

- **A recipient per todo**: `"recipient"` in `todos/<batch>/<todo>/todo.json` (no value = anyone's, as before). It is a
  **team** (`hq`, `paperclip` — every actor of that producer: `hq/<anything>`) or **one actor** (`paperclip/tester`,
  `human:filipp`). `anyone` and its synonyms are not names.
- **Set** when filing (`recipient` per part of the `file-todo` payload) and with `novadev todo recipient <ref>
  [<recipient>] [<payload.json>] [--clear] [--by <actor>]`: a name addresses, `--clear` makes it anyone's, neither shows
  it (with who addressed it and when). A change needs `by` (any actor) and may carry a `reason`; both go into the todo's
  history (`"change": "recipient"`, `from`, `to`). Refused on a finished todo; not refused behind a lock.
- **The lists**: `todo list` and `status` print `for <recipient>` on an addressed todo that is not finished; `todo list
  --json`, `status --json` and `todo show` carry `recipient` on every todo (`null` = anyone); `status --json` counts in
  `addressed` the addressed todos still to be worked, per recipient. `novadev todo list --for <who>[,<who>…]` keeps the
  todos addressed to `<who>`, to the team `<who>` is an actor of, or — when `<who>` is a team — to one of its actors (a
  lead's view); `anyone` stands for the ones with no recipient.
- **`novadev work start` refuses anybody but the recipient** and says whose the todo is, who addressed it and when. Who
  starts is the `--agent` actor; a start without one is refused on an addressed todo; a person (`human:<id>`) is never
  refused. A start covering several todos judges each one still to be worked, so a whole-batch start is refused while
  the batch holds somebody else's open todo.
- **sync** lists addressed todos still to be worked under ADDRESSED TO A RECIPIENT, not in NEXT ACTIONS; a tree whose only
  open work is addressed comes back clean ("everything left is addressed to its recipient"). One that a lock in this
  worktree holds stays a NEXT ACTION (`(for hq, in work here)`): its recipient's round is not over while it is open. A
  todo that waits for an addressed one is told "its recipient does that first".
- **`"recipients"` in novadev.json** (optional, read from the main checkout): the names that can be addressed, each with
  what belongs to it (`{ "hq": "…" }`, or a list of names). With it, a filing or re-addressing to a name outside the list
  (and not an actor of a listed team) is refused with the list, the project's spelling is stored, and `file-todo plan`
  and `todo recipient <ref>` answer the list. A setting novadev cannot read is a PROBLEM; an open todo addressed to a
  name the list no longer has is a NEXT ACTION (a note in doctor).

## How it works

`src/recipients.ts` owns the names (`parseRecipient`, `answersTo`: an actor answers to itself and to the team whose name
is the first part of its actor), the `--for` filter (`parseForFilter`, `matchesFor`) and the setting (`readRecipients`,
`resolveRecipient`); it imports no todo module. `src/todo-meta.ts` reads and writes `recipient` in `todo.json` beside
`priority` and `after` (every writer passes it on; unknown keys are still kept). `src/todo-recipient.ts` holds the rules
several commands share: `changeRecipient`, `refuseOthersTodos` (called once per `work start`, before the "do after"
check), `addressedTodos` (sync's list) and `auditTodoRecipients` (sync, doctor). `src/todo.ts` adds `recipientTodo`, the
`recipient` field of `TodoItem` and `--for`; `src/todo-filing.ts` resolves every part's recipient before anything is
written. No layout change: nothing to migrate, and the version did not change.

novadev does not authenticate callers: the recipient is whoever passes that actor. The rule holds through the record —
the lock says who took an addressed todo, the history says who addressed it.

## Progress

- 2026-11-24 — built (`2026-11-24_1/01-todo-recipient`), on the board's word in the IRRISketch headquarters session
- 2026-11-24 — the independent review before the merge: nothing important, eleven edge cases, all fixed with one test
  each (`describe('review of 2026-11-24')`): the recipient's own in-flight todo keeps its sync round open; a payload file
  or a todo's ref is never taken for a recipient; the refusal on a batch-root lock names the way on that works; an
  unreadable `recipient` value is kept by every writer and replaced only by `todo recipient`; a `todo.json` that cannot
  be read and names a recipient blocks the start; a long description in `"recipients"` is no problem and a bad one does
  not drop the name; team names are lower case and `addressed` counts once per recipient; `human` and `process` are no
  teams; a `recipient` beside `parts` addresses every part; `--for=hq` works; sync never says "do that first" about
  another's todo

## Open questions

- A whole-batch start is refused while the batch holds another's open todo. `file-todo` still reuses the day's chat
  batch, so an addressed todo can land beside unaddressed ones; todo `2026-11-12_1/05-file-todo-new-batch` (a way to ask
  for a new batch) would let a filing keep them apart.
- sync does not know who runs it, so a recipient finds its own todos in the ADDRESSED list (or with `todo list --for`),
  never in NEXT ACTIONS.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
