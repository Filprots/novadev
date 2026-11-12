---
type: Wiki Page
title: Stack
description: "Bun (>= 1.4) running TypeScript directly, zero runtime and dev dependencies, YAML via Bun's built-in parser, bun:test — and no tsconfig, linter, formatter or CI."
tags: [stack, bun, typescript, dependencies, yaml, versions]
sources:
  - resource: repo:package.json
  - resource: repo:bunfig.toml
  - resource: repo:src/okf.ts
  - resource: repo:src/lib.ts
  - resource: repo:.gitignore
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-02-10T08:15:41+01:00
verified:
  - { by: claude-code/claude-opus-5-5, at: 2026-11-12T08:15:41+01:00 }
---

# Stack

| Part | What | Notes |
|---|---|---|
| Language | TypeScript (ES modules, `"type": "module"`) | `.ts` files run directly by Bun; imports carry the `.ts` extension (`'./lib.ts'`) |
| Runtime | **Bun >= 1.4.0** (`engines.bun` in `package.json`) | 1.4.2 on the maintainer's machine. The floor exists for `Bun.YAML` |
| Standard library | `node:fs`, `node:path`, `node:child_process`, `node:os` | the only imports besides the project's own modules |
| YAML | `Bun.YAML` (Bun's built-in parser) | wrapped in `src/okf.ts` (`parseYaml`); an older Bun gets a clear "upgrade Bun" error instead of a crash |
| Tests | `bun:test` | preload `tests/setup.ts` via `bunfig.toml` |
| Package manager | Bun (`bun link` to install the CLI) | no lockfile, no `node_modules` (`.gitignore` lists it only defensively) |
| Licence | MIT | `package.json` |

## Dependencies: none, on purpose

`package.json` has no `dependencies` and no `devDependencies`. `src/lib.ts` opens with
"Zero dependencies — Bun + node:fs only", and the README's install section says the YAML
choice is what keeps it that way. A new dependency is a deliberate decision for the human
(the playbook does not authorise dependency changes) — prefer Bun's built-ins.

External programs the CLI calls (all optional — every caller has a fallback when they are
missing):

- **git** — read-only questions (see [architecture](architecture.md), *The git boundary*).
  novadev expects to live in a git repo; `deploy` warns when it is not at a repo root.
- **ps** — `src/work.ts` asks it for the grandparent process id (the agent harness), on
  non-Windows only.
- **the project's own metrics command** — a shell command from `novadev.json`, run by
  `src/metrics.ts` with a timeout (default 300 s); off in this repo.
- On Windows, `taskkill` stops a timed-out metrics command's process tree.

## Type checking

There is **no `tsconfig.json` and no `@types/bun`**. Bun strips types without checking
them, so type errors are not caught by any command in this repo. The code is nonetheless
written strictly typed (no `any` in `src/`, `Parsed<T>` unions, `as const` tables).
UNVERIFIED: whether the maintainer type-checks out of band (an editor's language server).
TODO(wiki): should a `tsc --noEmit` step (with a `tsconfig.json`) exist?

## Lint / format

No linter or formatter config (no eslint, biome, prettier, editorconfig). The house style
is consistent by hand — see [conventions](conventions.md).

## Version constraints worth knowing

- `NOVADEV_VERSION` in `src/lib.ts` must equal `version` in `package.json` — a test
  (`tests/migrations.test.ts`) fails otherwise.
- A project's `.novadev/novadev.json` records the version its layout is at; `sync` refuses
  to run on a project older than the installed CLI, and `deploy`/`migrate-repo` refuse a
  project newer than it (see [workflows](workflows.md), *Releasing*).
- Agent-harness specifics are confined to optional environment variables read by
  `src/work.ts`: `CLAUDE_PID` and `CLAUDE_CODE_SESSION_ID` (Claude Code); any other harness
  passes `--session`.
