# .novadev — structured development system

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

This folder is the project's **novadev** root: a framework/language/agent-agnostic
development system. Task briefs go in, work happens, exhaustive records and
distilled knowledge come out — all **tracked in git**, so the folder itself IS the
development history.

| Folder | What lives there |
|---|---|
| `todos/` | Task batches (`YYYY-MM-DD_N/`) with per-todo brief folders — human-authored, or filed by the agent from chat-initiated requests |
| `archive/` | Finished work by year: `<year>/todos/<batch>/` and `<year>/totest/<task>/<round>/` — batches land here after a few days' grace |
| `postponed/` | Deferred work with explicit `do-when` / `discard-if` triggers |
| `sparks/` | Raw unshaped ideas — not yet tasks |
| `wiki/` | The project pre-context agents load before working (strict page set) |
| `memories/` | Hard-won gotchas, guides, decisions, guardrails + `INDEX.md` |
| `features/` | What the software DOES: one `FEAT-NNNN/` folder per capability (`feature.md` + derived `work.md`/`tests.md`) |
| `totest/` | The active queue of tests waiting on a **human** — stepped scenarios an agent could not verify itself |
| `skills/` | The four playbooks that run this system, `novadev-*.md` (managed by deploy) |

**Agents:** the rule of the house is `skills/novadev-work.md` — the always-applied
playbook. It defines the loop; start every substantive task by loading `wiki/INDEX.md`
(create the wiki per the playbook if it is missing), and close every round with
`novadev sync`. Three companion playbooks sit beside it for the human's own entry
points: `novadev-file-a-todo.md`, `novadev-what-to-test.md`, `novadev-test-review.md`.

**Humans:** you do not have to run any of this. Say what you want built and the agent
files it (`/novadev-file-a-todo`); say you want to test and it shows you the queue
(`/novadev-what-to-test`); say what you found after testing and it writes the round up
(`/novadev-test-review`). By hand if you prefer: drop task briefs into `todos/`
(`novadev new` scaffolds a batch), check progress with `novadev status`, see what needs
your own testing with `novadev totest`, search capabilities with `novadev features`,
and validate structure and links with `novadev doctor` / `novadev links`.
