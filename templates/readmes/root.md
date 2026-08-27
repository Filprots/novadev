# .novadev — structured development system

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

This folder is the project's **novadev** root: a framework/language/agent-agnostic
development system. Task briefs go in, work happens, exhaustive records and
distilled knowledge come out — all **tracked in git**, so the folder itself IS the
development history.

| Folder | What lives there |
|---|---|
| `todos/` | Task batches (`YYYY-MM-DD_N/`) with per-todo brief folders — human-authored, or filed by the agent from chat-initiated requests |
| `archive/` | Finished batches, moved here by year (`novadev archive --done`) |
| `postponed/` | Deferred work with explicit `do-when` / `discard-if` triggers |
| `sparks/` | Raw unshaped ideas — not yet tasks |
| `wiki/` | The project pre-context agents load before working (strict page set) |
| `memories/` | Hard-won gotchas, guides, decisions, guardrails + `INDEX.md` |
| `features/` | What the software DOES: one `FEAT-NNNN` file per capability, searchable, linked to the work that built it |
| `totest/` | Test tasks waiting on a **human** — stepped scenarios an agent could not verify itself |
| `skills/` | The agent playbooks that run this system (managed by deploy) |

**Agents:** the rule of the house is `skills/workflow.md` — always applied.
Start every substantive task by loading `wiki/INDEX.md` (create the wiki per
`skills/wiki-init.md` if missing) and scanning `memories/INDEX.md`.

**Humans:** drop task briefs into `todos/` (`novadev new` scaffolds a batch),
check progress with `novadev status`, see what needs your own testing with
`novadev totest` (then `/novadev-review-tests` once you have written up results),
search capabilities with `novadev features`, and validate structure and links with
`novadev doctor` / `novadev links`.
