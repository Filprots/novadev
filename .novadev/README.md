# .novadev — structured development system

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

This folder is the project's **novadev** root: a framework/language/agent-agnostic
development system. Task briefs go in, work happens, exhaustive records and
distilled knowledge come out — all **tracked in git**, so the folder itself IS the
development history.

| Folder | What lives there |
|---|---|
| `knowledge/` | The project's **knowledge**, as one [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) (OKF 0.2) bundle — see below |
| `todos/` | Task batches (`YYYY-MM-DD_N/`) with per-todo brief folders — human-authored, or filed by the agent from chat-initiated requests |
| `archive/` | Finished work by year: `<year>/todos/<batch>/` and `<year>/totest/<task>/<round>/` — batches land here after a few days' grace |
| `postponed/` | Deferred work with explicit `do-when` / `discard-if` triggers |
| `sparks/` | Raw unshaped ideas — not yet tasks |
| `totest/` | The active queue of tests waiting on a **human** — stepped scenarios an agent could not verify itself |
| `metrics/` | `latest.json` — the newest snapshot of the project's own numbers (known debt, the biggest hubs), written by `novadev sync` when `novadev.json` sets a `metrics` command |
| `skills/` | The five playbooks that run this system, `novadev-*.md` (managed by deploy) |

**The knowledge bundle.** `knowledge/` holds what is TRUE about the project; everything
else here is the work it is drawn from. Every file in it is a markdown *concept* with YAML
frontmatter — its `type`, `title`, one-line `description`, who wrote it and when
(`generated`), who checked it (`verified`), when it is due for a re-check (`stale_after`),
and where it came from (`sources`) — so any agent or OKF tool can read it, and trust it as
far as it says it can be trusted.

| In `knowledge/` | |
|---|---|
| `index.md` | The load-first map — derived by `novadev sync`, never edited |
| `log.md` | What changed in the knowledge, newest day first — written by `novadev knowledge log` |
| `wiki/` | The project pre-context agents load before working: overview, stack, architecture, conventions, workflows, glossary (`type: Wiki Page`) |
| `memories/` | Hard-won lessons — `Guardrail`, `Gotcha`, `Decision`, `Guide` |
| `features/` | What the software DOES: one `FEAT-NNNN-<slug>/` folder per capability — `feature.md` + derived `work.md` / `tests.md` |
| any other folder | Knowledge the project keeps beside those three, of any type; `"knowledge"` in `novadev.json` gives it its line in the map (`"folders"`) and its review days (`"reviewDays"`) |

No README lives inside it: a file there is a concept, an index, or the log. Search it with
`novadev knowledge <words>`; `novadev knowledge` alone says what it holds, how much of it is
human-reviewed, and what is stale. If the wiki or the features are missing, an agent builds
them first — `novadev sync` says so.

**Agents:** the rule of the house is `skills/novadev-work.md` — the always-applied
playbook. It defines the loop; start every substantive task by loading `knowledge/index.md`
(build the wiki per the playbook if it is missing), take the batch's lock before the first
change (`novadev work start`), record every knowledge change with `novadev knowledge log`,
and close every round with `novadev sync` and `novadev work stop` — or `/novadev-pause`
when work remains. Four companion playbooks sit beside it: `novadev-file-a-todo.md`,
`novadev-what-to-test.md`, `novadev-test-review.md` for the human's own entry points, and
`novadev-pause.md` for stopping the loop where it is.

**Humans:** you do not have to run any of this. Say what you want built and the agent
files it (`/novadev-file-a-todo`); say you want to test and it shows you the queue
(`/novadev-what-to-test`); say what you found after testing and it writes the round up
(`/novadev-test-review`); say "pause" and it writes down exactly where things stopped
(`/novadev-pause`), so the next `/novadev-work` picks up from there. By hand if you
prefer: drop task briefs into `todos/` (`novadev new` scaffolds a batch), see whether a
work cycle is on and where it is with `novadev status` (a batch in work carries
`todos/<batch>/working.md`, its lock), see what needs your own testing with
`novadev totest`, search capabilities with `novadev features` and everything the project
knows with `novadev knowledge`, and validate structure and links with `novadev doctor` /
`novadev links`.
