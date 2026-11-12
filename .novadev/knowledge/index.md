---
okf_version: "0.2"
---

<!-- DERIVED by `novadev sync` from the frontmatter of the concepts listed here. Do not edit: it is rewritten. Change a concept, then run `novadev sync`. -->

# Wiki

* [Overview](wiki/overview.md) - What novadev is: a zero-dependency Bun CLI plus agent playbooks that deploy a git-tracked development system (.novadev/) into any project — and this repo is novadev's own source, managed by itself.
* [Stack](wiki/stack.md) - Bun (>= 1.4) running TypeScript directly, zero runtime and dev dependencies, YAML via Bun's built-in parser, bun:test — and no tsconfig, linter, formatter or CI.
* [Architecture](wiki/architecture.md) - The module map (which src/ file owns which command or concern), the audit/fix pattern behind sync and doctor, the data flow of `novadev sync`, where state lives, and the read-only git boundary.
* [Conventions](wiki/conventions.md) - How code is written in novadev: zero dependencies, one exported function per command module, JSON-file payloads and JSON answers for agent-facing commands, Parsed<T>/refuse() for settings, marker-fenced derived files, read-only git questions and git writes only where a person asked, plain-English messages, fixture-only tests, and docs.test.ts keeping the README and playbooks honest.
* [Workflows](wiki/workflows.md) - Exact commands to install (bun link), run (bun bin/novadev.ts vs the linked novadev, which is this working tree), test (bun test, ~55 s, 625 tests), and release a version (the bump places, migrations, migrate-repo + deploy here and in consumer projects); no CI, no hooks, no secrets.
* [Glossary](wiki/glossary.md) - novadev's own vocabulary as the code uses it — batch, todo, brief, record, gate, lock, waypoint, feature, concept, actor, trust tier, stale, drifted, test task and round, hub, known debt, debt budget, raise, placement, grace period, derived block — with the file or constant that defines each.

# Memories

* [Memories](memories/index.md) - 2 lessons (2 gotchas) — open the ones whose line touches your task

# Features

* [Features](features/index.md) - 19 capabilities (19 shipped) — what the software does; search it before building anything new

# History

* [Knowledge log](log.md) - what changed in this knowledge, newest day first
