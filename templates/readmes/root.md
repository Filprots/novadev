# .novadev — structured development system

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

This folder is the project's **novadev** root: a framework/language/agent-agnostic
development system. Task briefs go in, work happens, exhaustive records and
distilled knowledge come out — all **tracked in git**, so the folder itself IS the
development history.

| Folder | What lives there |
|---|---|
| `todos/` | Task batches (`YYYY-MM-DD_N/`) with per-todo brief folders — human-authored, or filed by the agent from chat-initiated requests |
| `archive/` | Finished work by year: `<year>/todos/<batch>/` and `<year>/totest/<task>/<round>/` (`novadev archive --done`) |
| `postponed/` | Deferred work with explicit `do-when` / `discard-if` triggers |
| `sparks/` | Raw unshaped ideas — not yet tasks |
| `wiki/` | The project pre-context agents load before working (strict page set) |
| `memories/` | Hard-won gotchas, guides, decisions, guardrails + `INDEX.md` |
| `features/` | What the software DOES: one `FEAT-NNNN/` folder per capability (`feature.md` + derived `work.md`/`tests.md`) |
| `totest/` | The active queue of tests waiting on a **human** — stepped scenarios an agent could not verify itself |
| `skills/` | The agent playbooks that run this system (managed by deploy) |

**Agents:** the rule of the house is `skills/novadev.md` — the single always-applied
Start every substantive task by loading `wiki/INDEX.md` (create the wiki per
playbook. It defines the loop; close every round with `novadev sync`.

**Humans:** drop task briefs into `todos/` (`novadev new` scaffolds a batch),
check progress with `novadev status`, see what needs your own testing with
`novadev totest` (write your results into the task folder — the agent picks them up),
search capabilities with `novadev features`, and validate structure and links with
`novadev doctor` / `novadev links`.
