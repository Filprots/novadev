---
type: Wiki Page
title: Conventions
description: "How code is written in novadev: zero dependencies, one exported function per command module, JSON-file payloads and JSON answers for agent-facing commands, Parsed<T>/refuse() for settings, marker-fenced derived files, read-only git questions and git writes only where a person asked, plain-English messages, fixture-only tests, and docs.test.ts keeping the README and playbooks honest."
tags: [conventions, style, errors, payloads, derived-files, tests, docs, messages]
sources:
  - resource: repo:src/lib.ts
  - resource: repo:src/file-todo.ts
  - resource: repo:src/work.ts
  - resource: repo:src/hubs.ts
  - resource: repo:src/okf.ts
  - resource: repo:tests/helpers.ts
  - resource: repo:tests/docs.test.ts
  - resource: repo:tests/migrations.test.ts
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:50:53+01:00 }
stale_after: 2027-02-10T08:15:41+01:00
verified:
  - { by: claude-code/claude-opus-5-5, at: 2026-11-12T08:15:41+01:00 }
---

# Conventions

## Shape of the code

- **No dependencies.** Bun + `node:fs`/`node:path`/`node:child_process`/`node:os` only;
  YAML through `Bun.YAML` (wrapped in `src/okf.ts`). Adding a package is the human's call.
- **One command, one module, one exported entry.** `bin/novadev.ts` lazy-imports
  `src/<command>.ts` and calls one function (`deploy()`, `sync(args)`, `work(args)` …).
  When a command has real rules, the CLI layer is thin and the *mechanics* sit in their
  own module (`file-todo.ts` → `todo-filing.ts`, `test-result.ts` → `test-results.ts`,
  `knowledge-cmd.ts` → `knowledge-log.ts`) whose header says why the rule lives in code
  rather than in playbook prose.
- **Module header comment.** Every `src/` file opens with `//` lines naming the command
  or concern, its usage, and the rules it enforces. Exports carry JSDoc. Comments explain
  *why* ("It lives in the CLI rather than in the playbook's prose because…").
- **Shared model in `src/lib.ts`.** File names (`ai_completed.md`, `working.md` …),
  regexes (`BATCH_RE`, `FEATURE_DIR_RE`), status lists and readers live there as named
  constants — import them rather than re-typing the literal. `as const` tables plus derived
  types (`FeatureStatus`). No classes; plain functions and object types. No `any`.
- **Formatting** (by hand, no formatter): 2-space indent, single quotes, semicolons,
  trailing commas; long lines are tolerated (many over 120 columns).
- **Deterministic output.** Sort with `byCodePoint` (locale-independent — a few older
  readers in `lib.ts`/`links.ts` still use `localeCompare`), write JSON with
  `writeManifest` (2-space, trailing newline), keep CRLF files CRLF (`writeBlock`).

## Errors and refusals

- **Human-facing commands** stop with `fail(message)` from `src/lib.ts`: `novadev: …` on
  stderr, exit 1. Unknown options are refused by name, with the usage line.
- **Agent-facing commands** (`file-todo`, `test-result`, `todo`, `work`, `knowledge log`)
  take their input as a **JSON payload file, never shell arguments** (a backtick in a note
  would run a command), answer **JSON on stdout**, and report errors as `{ "error": … }`
  with exit 1. Internally they `throw new Error(…)` and one top-level `try/catch` turns
  it into that JSON. (An unknown subcommand prints the usage to stderr and exits 2 in
  `file-todo`, `work` and `test-result`; `todo` answers it as JSON with exit 1.)
- **Parsing settings or command output** returns `Parsed<T>` (`{ ok: true, value } |
  { ok: false, error }`) built with `refuse(error)` — it never throws and never exits
  (`parseHubsSetting`, `parseBudget`, `parsePlacementSince`, `normalizeMetrics`,
  `parseKnowledgeSettings`). A broken setting is reported as a problem and treated as off.
- **All-or-nothing writes.** `knowledge log` checks every event before writing any;
  `deploy` and `migrate-repo` refuse an unreadable `novadev.json` ("Nothing was changed.")
  rather than replacing it; `migrate-repo` refuses a dirty tree without `--force`.
- **Settings are opt-in**: absent or `null` in `novadev.json` means off.

## Derived files

- One side of every link is authored, the other derived. Derived regions are fenced by
  `<!-- novadev:<name>:begin -->` / `<!-- novadev:<name>:end -->` (`blockBegin`/`blockEnd`),
  counted only on a line of their own outside fenced code, so a page may quote a marker.
  Whole-file derived outputs (`index.md`s, `completed.md`, `metrics/latest.json`) are
  rewritten entirely. Never hand-edit either; change the source and run `novadev sync`.
- A derived file is produced as a `Fix` and applied by `applyFix`, so `sync --check` can
  report exactly what is stale without writing.

## Git

Questions are read-only and answer `null` when git cannot tell; callers then fall back to the
working tree. `src/git.ts` is the shared home for them (a sub-repo is asked with `nested`, without
a hook's GIT_* variables); UNVERIFIED: whether new ones must go there — five modules still call
git directly (see [architecture](architecture.md)). A git WRITE lives only in the module of the
command a person runs to get it, never in `src/git.ts`: `src/merge-rules.ts` (deploy's driver
config, `sync --after-merge`'s commit of `.novadev/`) and `src/worktree.ts` (worktrees, their
branches, the lead's merge). No other command commits, stages, branches or resets, and none
pushes.

## Prose: messages, comments, docs

The maintainer is not a native English speaker, and agents in other projects act on this
text. Write **plain English in full sentences**: say what happened, why it matters, and
the exact next step, with commands in backticks ("… is not a valid JSON object (a merge
conflict?) — fix it, then run `novadev migrate-repo` again. Nothing was changed."). The
em dash `—` is the house punctuation. No jargon where a plain word works. Status marks are
fixed: `✓ ✗ → ⧗ ·` in lists, `○ ◐ ● ⊘` for feature status.

## Tests

- `bun:test`, one file per command or theme (`tests/<area>.test.ts`), each opening with a
  `//` comment saying what it covers. Describe blocks and test names are sentences.
- **Fixtures only**: every test builds a throw-away project with `tests/helpers.ts`
  (`project()`, `todo()`, `feature()`, `wikiPage()`, `setManifest()`, `metricsProject()`,
  `commitAll()`), runs the **real CLI** with `run(root, …args)`, and uses `git()` with a
  fixed identity, no hooks, no signing, and no `GIT_*` variables. Nothing touches a real
  repository. Temp folders are removed by `tests/setup.ts`.
- Assertions compare **whole messages**, so changing a message means changing its test.
- **Review findings become tests kept as written**: `tests/review31-*.test.ts` (reviews of
  0.10.0) and `tests/review-okf-findings.test.ts` (0.12.0) — one test per finding.
- **Docs are tested**: `tests/docs.test.ts` checks that the README documents every setting
  the code reads, that its examples parse with the real parsers, that its sample outputs
  are what the CLI prints line for line, and that the playbooks contain the sections and
  words the code points agents to. Change behaviour → update README + templates in the
  same change, or this suite fails.
- `tests/migrations.test.ts` pins `package.json` `version` = `NOVADEV_VERSION` and the
  migration list order.

## Commits

One commit per release, subject `novadev X.Y.Z — <what it gives, in words>`; between
releases `fix(<area>): …`, `feat(<area>): …`, `docs: …`, `chore: …`. Subjects are long
and descriptive (a sentence or more). A release commit carries code, tests, README,
templates and the version bump together (see [workflows](workflows.md)).
