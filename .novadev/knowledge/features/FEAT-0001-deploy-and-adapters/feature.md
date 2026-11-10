---
type: Feature
id: FEAT-0001
title: "Deploy: the novadev tree, the playbooks and the agent adapters"
description: "Run `novadev deploy` in any project to create or refresh .novadev/ (folders, READMEs, manifest, knowledge bundle seed), the five novadev-* playbooks, and the adapters that route Claude Code, Cursor and AGENTS.md-reading agents to them."
feature-status: shipped
status: stable
area: setup
created: 2026-11-10
tags: [deploy, playbooks, skills, adapters, claude-code, cursor, agents-md, templates, managed-files]
touches: [src/deploy.ts, templates/skills/novadev-work.md, templates/readmes/root.md, templates/readmes/todos.md, templates/readmes/postponed.md, templates/readmes/sparks.md, tests/doctor-deploy-status.test.ts, tests/docs.test.ts]
depends-on: []
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:bc17f04
  - resource: commit:271ac00
  - resource: commit:dc73f7e
  - resource: commit:6655fee
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0001 — Deploy: the novadev tree, the playbooks and the agent adapters

## What it does

`novadev deploy` (idempotent) sets a project up for the novadev loop, or upgrades it after
`migrate-repo`:

- creates `.novadev/` with its work folders (`todos/`, `archive/`, `postponed/`, `sparks/`,
  `totest/`, `metrics/`), each with a self-describing README;
- seeds the knowledge bundle (`knowledge/index.md`, `knowledge/log.md`) but deliberately
  NOT the wiki or the features registry — their absence tells an agent to build them;
- writes or merges `novadev.json` (never clobbers settings; first deploy writes the opt-in
  settings as `null` and `placementSince` as today);
- copies the five canonical playbooks (`novadev-work`, `-file-a-todo`, `-what-to-test`,
  `-test-review`, `-pause`) into `.novadev/skills/`, and removes superseded ones;
- writes adapters: `.claude/skills/novadev-*/SKILL.md`, `.cursor/rules/novadev.mdc`, and a
  marker-fenced managed section in `AGENTS.md` and `CLAUDE.md` (text outside it is kept).

It refuses an unreadable `novadev.json`, a project newer than the CLI, and a project with
pending migrations; it warns when the folder is not a git repo root.

## How it works

`src/deploy.ts` reads `templates/` from the clone the CLI runs from (`packageDir()`), and
the skill list and descriptions from `SKILLS` in `src/lib.ts`. A file is novadev's to
overwrite only when it carries "managed by `novadev deploy`" (`isNovadevManaged`). The
canonical playbook `templates/skills/novadev-work.md` is the product's core document;
`tests/docs.test.ts` keeps it, the README and the folder READMEs in step with the code.

## Progress

- 2026-08-16 — landed in 0.1.0 (commit bc17f04): deploy, folder READMEs, canonical playbooks, Claude Code and Cursor adapters, AGENTS.md/CLAUDE.md sections
- 2026-08-19 — 0.2.0 (commit 5c9f453): YAML-safe skill adapters
- 2026-08-29 — 0.7.0 (commit 271ac00): twelve playbooks collapsed into one gateway skill; legacy files and adapters removed on deploy
- 2026-09-09 — 0.9.0 (commit dc73f7e): the loop plus three companion skills, all named `novadev-*`
- 2026-10-25 — 0.14.0 (commit 6655fee): the fifth playbook, `/novadev-pause`
- 2026-11-10 — deployed into novadev's own repository at 0.15.0

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
