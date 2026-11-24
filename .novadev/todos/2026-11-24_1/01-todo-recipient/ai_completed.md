# ai_completed — todo-recipient

**Date:** 2026-11-24
**Feature:** FEAT-0024, FEAT-0015, FEAT-0009
**Commits:** c107377

## Prompt
A todo may name its recipient: only that recipient works it; a todo without one is anyone's (the board, in the IRRISketch headquarters session: a way for the company's agents to leave todos, notes and remarks for that session).

## What I did
- `"recipient"` in `todo.json`, beside `priority` and `after`: a team (`hq` — every actor `hq/…`) or one actor (`paperclip/tester`, `human:<id>`). `anyone` and its synonyms are refused as names.
- Filing: a part's `recipient`; `file-todo plan` answers the project's `recipients` when it names them.
- `novadev todo recipient <ref> [<recipient>] [<payload.json>] [--clear] [--by <actor>]`: address, re-address, make anyone's, or show; a change needs `by` and is written into the history with from, to and the reason.
- Lists: `for <recipient>` in `todo list` and `status`; `recipient` on every todo in `todo list --json`, `status --json` and `todo show`; `addressed` counts in `status --json`; `todo list --for <who>[,<who>…]` with `anyone` for the todos that have none.
- `work start` refuses anybody but the recipient (the `--agent` actor answers to it when it is that actor or an actor of that team); a start that names nobody is refused on an addressed todo; a person is never refused; a whole-batch start is refused while the batch holds another's open todo.
- sync: addressed todos still to be worked are listed under ADDRESSED TO A RECIPIENT, not NEXT ACTIONS; doctor and sync name an unreadable `"recipients"` (problem) and an open todo addressed to a name the list no longer has (action).
- `"recipients"` in novadev.json (optional, the main checkout's): the names that can be addressed, with what belongs to each.
- README (*Recipients*, the Upgrading note), CLI help, both playbooks (vocabulary, orient, intake, "Take only what is yours", the lock's refusals, the close-out), the todos folder README.

## Placement
Two new modules: `src/recipients.ts` (names, who answers to one, the `--for` filter, the setting — it imports no todo module, so `src/todo-meta.ts` can use its parser) and `src/todo-recipient.ts` (the rules several commands share, as `src/todo-links.ts` does for links). `src/todo.ts`, `src/todo-meta.ts`, `src/todo-filing.ts`, `src/work.ts`, `src/sync.ts`, `src/doctor.ts` and `src/status.ts` each got the few lines that call them. No hubs are configured.

## Verification
- `tests/todo-recipient.test.ts` (22 tests: the names, filing, the lists, the command, `work start`, sync and doctor, a project that addresses nothing prints as before); `tests/docs.test.ts` (the README's examples are read by the real readers, every command it shows runs, its sample list is what the CLI prints; the playbooks and the help carry the words).
- Full suite: 751 pass, 0 fail (41 files).
- Read-only comparison with the live CLI on IRRISketch (762 todos): `todo list`, `file-todo plan`, `totest --json` identical; `status` and `sync --check` differ only in "just now" / "1 min ago"; `todo list --json` and `status --json` only gain `"recipient": null` per todo and `"addressed": {}`; `doctor` adds two lines, "skills/novadev-work.md / novadev-file-a-todo.md: differs from installed novadev — run `novadev deploy`", until the project is deployed.

## Decisions
- **Who is the recipient at a start: the `--agent` actor, no second flag.** A team's name is the first part of its members' actors, so no setting lists members and a session only has to start as `hq/<name>`. Rejected: a `--as <recipient>` flag (two identities to keep in step) and a members list in novadev.json (model names in actors change).
- **A person is never refused.** The project is theirs; the lock records that they took it.
- **Re-addressing is anyone's, always with `by`.** novadev authenticates nobody, so the rule is the record, as with the lead. `after` allows no `by`; a re-addressing without an author is exactly the question "who took this from them", so here it is required.
- **Addressed todos are not NEXT ACTIONS.** sync does not know who runs it, and a company whose only open work is the other team's must come back clean.
- **No version bump** (the owner's standing rule, and a bump stops `novadev sync` in every open worktree of a consumer project until it merges the stamped default branch). No layout change, nothing to migrate; `novadev deploy` refreshes the playbooks.

## Notes
A filing still reuses the day's chat batch, so an addressed todo can land beside unaddressed ones, and a whole-batch start by somebody else is then refused until they name their todos. Todo `2026-11-12_1/05-file-todo-new-batch` (still open) is the way to keep them apart.
