---
type: Wiki Page
title: Overview
description: "What novadev is: a zero-dependency Bun CLI plus agent playbooks that deploy a git-tracked development system (.novadev/) into any project — and this repo is novadev's own source, managed by itself."
tags: [overview, purpose, users, capabilities, layout, dogfooding]
sources:
  - resource: repo:README.md
  - resource: repo:package.json
  - resource: repo:bin/novadev.ts
  - resource: repo:templates/skills/novadev-work.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-02-10T08:15:41+01:00
verified:
  - { by: claude-code/claude-opus-5-5, at: 2026-11-12T08:15:41+01:00 }
---

# Overview

## What it is

**novadev** is a framework-, language- and agent-agnostic *structured development system*.
One command (`novadev deploy`) puts a git-tracked folder tree, `.novadev/`, plus five agent
playbooks and thin agent adapters into any project. From then on a human writes task
briefs; an AI coding agent runs one fixed loop (ORIENT → … → CLOSE) that does the work,
writes records, keeps a features registry, hands untestable work to the human, keeps the
project's knowledge true, and archives what is finished. The folder becomes the project's
development history.

The project's knowledge (wiki, memories, features) is one **Open Knowledge Format (OKF
0.2)** bundle in `.novadev/knowledge/`: markdown + YAML frontmatter, each concept stamped
with who wrote it, who checked it, and when it is due for a re-check.

## Who uses it

- **The human** (a developer): writes todo briefs, walks the hand tests only a person can
  walk, answers decisions. Never has to remember a novadev command.
- **AI coding agents** (Claude Code first — it gets native skills — Cursor via a rule,
  anything else via `AGENTS.md`): run the loop and every novadev command.
- **Tools away from the repo** (a chat bot / phone-side plugin on the same computer):
  `status --json`, `totest --json`, `novadev todo …`, `file-todo`, `test-result`.

## This repository is novadev itself

This repo is the **source of the CLI** (`bin/`, `src/`, `templates/`, `tests/`) **and** a
project novadev manages (its own `.novadev/`, deployed 2026-11-10 at 0.15.0). The globally
linked `novadev` command runs straight from this working tree, so a change in `src/`
changes the tool doing this repo's bookkeeping at once — see [workflows](workflows.md).
`.novadev/skills/*.md` here are deployed **copies** of `templates/skills/*.md`; edit the
templates, never the copies.

## Capabilities (one line each — the features registry has the detail)

| Capability | Command(s) |
|---|---|
| Deploy the system + playbooks + agent adapters | `deploy` |
| Upgrade an older `.novadev/` layout, stepwise | `migrate-repo` |
| Scaffold batches/todos; stock-take of the tree | `new`, `status [--json]` |
| The close-out: derive, archive, validate, list what is left | `sync [--check]` |
| Structure validation | `doctor` |
| Archive finished work, after a grace period | `archive`, inside `sync` |
| The lock of a batch in work: waypoints, pause, resume | `work start/waypoint/pause/stop` |
| File a chat request as a todo, attachments included | `file-todo plan/file` |
| One todo at a time from outside the repo | `todo list/show/addendum/edit/cancel` |
| Human-testing queue, one living task per feature | `totest` |
| Record a human's test results (append-only) | `test-result tasks/write/review` |
| Features registry + record↔feature↔commit link graph | `features`, `links` |
| Knowledge bundle: search, trust, staleness, drift, change log | `knowledge`, `knowledge log` |
| Metrics hook, debt budget, wiki budgets block | inside `sync` (opt-in) |
| `## Placement` check against hubs; features per hub | inside `sync`/`doctor`, `features --hubs` |

## Top-level layout

```
bin/novadev.ts     the CLI entry: HELP text + one switch that lazy-imports a src/ module per command
src/               ~11k lines of TypeScript, one module per command or concern (see architecture)
templates/skills/  the five canonical playbooks deploy copies into a project's .novadev/skills/
templates/readmes/ the self-describing READMEs deploy writes into .novadev/ and its work folders
tests/             bun:test suites on throw-away fixture projects (~7k lines, 508 tests)
README.md          the user manual (~51 KB); tests/docs.test.ts keeps it true to the code
.novadev/          this repo's own novadev tree (todos, knowledge, …) — bookkeeping, not source
.claude/, .cursor/, AGENTS.md, CLAUDE.md   adapters written by `novadev deploy`
```

Distribution: a git clone + `bun link` (MIT, `github.com/Filprots/novadev`); not published
to a registry. UNVERIFIED: whether it has ever been published to npm — `package.json` has a
`files` list, but nothing in the history says it was.

## Read next

[architecture](architecture.md) for the module map and the data flow of `sync`;
[conventions](conventions.md) before writing code; [glossary](glossary.md) for novadev's
own words (batch, record, gate, hub, drift …).
