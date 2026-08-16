# novadev wiki-init — create the project wiki (strict structure)

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

The wiki at `.novadev/wiki/` is the **project pre-context**: what any agent must
know before touching the project — how it is built, with which languages and
frameworks, how the parts connect, how it is run, tested, and deployed. It is
written FOR agents (and humans), lives in git, and is loaded at the start of every
substantive task.

**Trigger:** `wiki/INDEX.md` does not exist (or the wiki folder is empty). Creating
the wiki then is MANDATORY and comes before any todo work.

## The strict page set

Create exactly these pages. Do not invent other top-level pages; a topic that fits
nowhere goes into the closest page under its own heading.

| Page | Contains |
|---|---|
| `INDEX.md` | Load-first map: 1–3 sentence project summary + one line per page saying what is in it. Nothing else. |
| `overview.md` | What the product/system IS: purpose, users, main capabilities, repository layout at the top level. |
| `stack.md` | Languages, frameworks, runtimes, package managers, key dependencies and why they were chosen, version constraints. |
| `architecture.md` | The parts and how they connect: modules/services/packages, boundaries, data flow, integration points, where state lives. |
| `conventions.md` | How code is written HERE: style, naming, patterns to follow, patterns that are banned, review/verification gates, i18n/theming/etc. rules if any. |
| `workflows.md` | How to build, run, test, debug, and deploy: exact commands, environments, infrastructure, secrets handling (where they live — never the values), CI. |
| `glossary.md` | Domain vocabulary: the project's own terms an outsider would not know, each with a one-line definition. |

Every page starts with frontmatter:

```markdown
---
updated: <YYYY-MM-DD>
---
```

## How to fill them (investigate, don't guess)

1. **Probe the repository**: manifests (`package.json`, `pyproject.toml`,
   `Cargo.toml`, …), lockfiles, build/CI configs, container/deploy files, entry
   points, top-level folders, existing docs and agent-instruction files
   (`README`, `AGENTS.md`, `CLAUDE.md`, `docs/`).
2. **Run what is safe**: list scripts/tasks, run the build or test command if it is
   obviously non-destructive, to confirm the commands you document actually work.
3. **Mine the history**: recent commits and any `.novadev/archive/` records reveal
   how work is actually done here.
4. Write each page from evidence. Where you could not verify something, write
   `UNVERIFIED:` before the claim — never present a guess as fact.
5. Anything important you could not determine at all gets an explicit
   `TODO(wiki): <question>` line so the next session can close the gap.

## Size discipline

- A page is a briefing, not a book: target well under ~150 lines; link to in-repo
  files (paths) instead of duplicating their content.
- The INDEX must stay skimmable in seconds — one line per page, no prose blocks.

## Finish

- All seven pages exist, frontmatter stamped with today's date.
- INDEX one-liners accurately describe each page.
- Commit the new wiki (it is git-tracked like everything in `.novadev/`).
