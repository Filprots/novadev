# novadev

A **framework/language/IDE/agent/LLM-agnostic structured development system**.
One command deploys a git-tracked folder tree + a set of agent playbooks into any
project; from then on, task briefs go in, work happens, and exhaustive records +
distilled knowledge come out — the folder itself becomes the project's development
history.

## Install

```sh
cd novadev
bun link          # registers the `novadev` CLI globally
```

## Use

```sh
cd your-project
novadev deploy    # creates .novadev/ + skills + agent adapters (idempotent, upgrade-safe)
```

Then:

```sh
novadev new fix-login add-dark-mode   # scaffold todos/2026-08-16_1/{01-fix-login,02-add-dark-mode}/
novadev status                        # open todos + record states, postponed triggers, wiki health
novadev archive --done                # move fully-recorded batches to archive/<year>/
novadev doctor                        # validate structure (CI-friendly non-zero exit)
```

## The system

```
.novadev/
  todos/       task batches YYYY-MM-DD_N/<todo>/ — human-authored briefs (.txt/.md + screenshots)
  archive/     finished batches by year — the browsable development history
  postponed/   deferred work with do-when / discard-if triggers
  sparks/      raw unshaped ideas
  wiki/        project pre-context agents load first (strict page set; agent creates via wiki-init)
  memories/    gotchas/guides/decisions/guardrails, auto-written during work + INDEX.md
  skills/      the canonical agent playbooks (markdown, agent-agnostic; managed by deploy)
```

**Records.** When an agent concludes a todo it writes `ai_completed.md`
(what/verification/date) or `ai_failed.md` (deferred/cancelled/merged/blocked +
why) into the todo folder; long-running work carries `ai_progress.md`. One record
per todo, updated in place if status changes.

**Wiki.** `wiki/INDEX.md` + six mandated pages (overview, stack, architecture,
conventions, workflows, glossary). Its absence is the signal: an agent MUST create
it (per `skills/wiki-init.md`) before doing todo work.

**Memories.** The moment work stumbles on something non-obvious that cost time,
the agent writes a memory file (frontmatter: title/created/kind/verified) and
indexes it — guardrails that stop future time-wasting.

**Skills** (canonical markdown in `.novadev/skills/`, single source of truth):

| Playbook | Purpose |
|---|---|
| `workflow.md` | The always-applied core rule: pre-context ritual, todo execution, records, auto-memories, postponing |
| `wiki-init.md` | Create the wiki with the strict page structure (investigate, don't guess) |
| `wiki-update.md` | Keep the wiki true after landed work; full audit on request |
| `wiki-compact.md` | Shrink the wiki; keep pre-context cheap to load |
| `memories-review.md` | Verify/rewrite/prune memories; resync the index |
| `debt-scan.md` | Sweep for tech debt and file findings as a new todo batch |

## Agent integration (canonical + adapters)

The playbooks are plain markdown any agent can follow. `novadev deploy`
additionally generates thin native adapters that just route to them:

- `.claude/skills/novadev-*/SKILL.md` — Claude Code slash-command skills
- `.cursor/rules/novadev.mdc` — Cursor always-applied rule
- managed marker sections in `AGENTS.md` and `CLAUDE.md` (created if missing;
  re-deploy updates between the markers without touching your text)

Everything under `.novadev/` is meant to be **committed**. Only transient junk
should be git-ignored.
