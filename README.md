# novadev

A **framework/language/IDE/agent/LLM-agnostic structured development system**.
One command deploys a git-tracked folder tree + a set of agent playbooks into any
project; from then on, task briefs go in, work happens, and exhaustive records +
distilled knowledge come out — the folder itself becomes the project's development
history.

## Install

Requires [Bun](https://bun.sh) (>= 1.0).

```sh
git clone https://github.com/Filprots/novadev.git
cd novadev
bun link          # registers the `novadev` CLI globally
```

The CLI runs straight from the clone, so upgrading is just:

```sh
cd novadev
git pull          # then re-run `novadev deploy` in each project to refresh it
```

## Use

```sh
cd your-project
novadev deploy    # creates .novadev/ + skills + agent adapters (idempotent, upgrade-safe)
```

Then:

```sh
novadev new fix-login add-dark-mode   # scaffold todos/2026-08-16_1/{01-fix-login,02-add-dark-mode}/
novadev status                        # open todos + record states, postponed triggers, wiki/features health
novadev features --touching src/auth  # which features already own this code (conflict pre-flight)
novadev links --fix                   # regenerate derived backlinks + features/INDEX.md
novadev archive --done                # move fully-recorded batches to archive/<year>/
novadev doctor                        # validate structure + link graph (CI-friendly non-zero exit)
```

## The system

```
.novadev/
  todos/       task batches YYYY-MM-DD_N/<todo>/ — briefs: human-authored (.txt/.md + screenshots) or agent-filed prompt.md (chat-initiated)
  archive/     finished batches by year — the browsable development history
  postponed/   deferred work with do-when / discard-if triggers
  sparks/      raw unshaped ideas
  wiki/        project pre-context agents load first (strict page set; agent creates via wiki-init)
  memories/    gotchas/guides/decisions/guardrails, auto-written during work + INDEX.md
  features/    what the software DOES — one FEAT-NNNN file per capability, searchable + linked
  skills/      the canonical agent playbooks (markdown, agent-agnostic; managed by deploy)
```

**Records.** When an agent concludes a todo it writes `ai_completed.md`
(what/verification/date) or `ai_failed.md` (deferred/cancelled/merged/blocked +
why) into the todo folder; long-running work carries `ai_progress.md`. One record
per todo, updated in place if status changes.

**Chat-initiated work.** When the human asks an agent in chat to
implement/fix/change something that no open todo already covers, the agent must
file it as a todo itself, before starting (a matching postponed item or spark
graduates into that todo's brief): create the batch/todo folder, transcribe the
request as a `prompt.md` brief, then conclude
with the normal record — `ai_completed.md`/`ai_failed.md`, or `ai_progress.md` if
still in flight — plus a `## Thinking` section capturing the reasoning and
decisions that would otherwise evaporate with the chat. Nothing project-changing
happens off the books.

**Wiki.** `wiki/INDEX.md` + six mandated pages (overview, stack, architecture,
conventions, workflows, glossary). Its absence is the signal: an agent MUST create
it (per `skills/wiki-init.md`) before doing todo work.

**Memories.** The moment work stumbles on something non-obvious that cost time,
the agent writes a memory file (frontmatter: title/created/kind/verified) and
indexes it — guardrails that stop future time-wasting.

**Features + links.** `features/` registers every capability as
`FEAT-NNNN-<slug>.md` (status, area, tags, the code it `touches:`, and
`depends-on`/`supersedes`/`conflicts-with` relations). Before anything new is
designed, it is searched — `novadev features --touching src/auth` answers "what
already owns this code?" — so duplicates and conflicts get caught at proposal
time rather than in review.

Records and features are cross-linked, and the graph is maintainable because each
edge has **one authored direction and one derived direction**: the record names
its feature (`**Feature:** FEAT-0007`, `**Commits:** abc1234`), and
`novadev links --fix` regenerates the feature's `## Work` / `## Commits` sections
and `features/INDEX.md` from it. Nothing is written twice, so backlinks cannot
rot. All references are **stable IDs, never relative paths** (`FEAT-0007`,
`2026-08-24_1/01-magic-link`) — archiving moves todo folders, and paths would
break where IDs keep resolving. `novadev links` validates the whole graph;
`novadev doctor` includes it.

**Skills** (canonical markdown in `.novadev/skills/`, single source of truth):

| Playbook | Purpose |
|---|---|
| `workflow.md` | The always-applied core rule: pre-context ritual, todo execution, chat-initiated filing, records, auto-memories, postponing |
| `wiki-init.md` | Create the wiki with the strict page structure (investigate, don't guess) |
| `wiki-update.md` | Keep the wiki true after landed work; full audit on request |
| `wiki-compact.md` | Shrink the wiki; keep pre-context cheap to load |
| `memories-review.md` | Verify/rewrite/prune memories; resync the index |
| `debt-scan.md` | Sweep for tech debt and file findings as a new todo batch |
| `feature-init.md` | Build the features registry by reverse-engineering the current capabilities |
| `feature-check.md` | Pre-flight a proposed feature: duplicate / overlap / conflict / supersession |
| `feature-update.md` | Keep the registry true after work lands; full audit on request |
| `links-audit.md` | Validate and repair the whole link graph; fix what tooling cannot |

## Agent integration (canonical + adapters)

The playbooks are plain markdown any agent can follow. `novadev deploy`
additionally generates thin native adapters that just route to them:

- `.claude/skills/novadev-*/SKILL.md` — Claude Code slash-command skills
- `.cursor/rules/novadev.mdc` — Cursor always-applied rule
- managed marker sections in `AGENTS.md` and `CLAUDE.md` (created if missing;
  re-deploy updates between the markers without touching your text)

Everything under `.novadev/` is meant to be **committed**. Only transient junk
should be git-ignored.
