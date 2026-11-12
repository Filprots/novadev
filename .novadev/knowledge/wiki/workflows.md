---
type: Wiki Page
title: Workflows
description: "Exact commands to install (bun link), run (bun bin/novadev.ts vs the linked novadev, which is this working tree), test (bun test, ~55 s, 625 tests), and release a version (the bump places, migrations, migrate-repo + deploy here and in consumer projects); no CI, no hooks, no secrets."
tags: [workflows, install, run, test, release, version, deploy, dogfooding]
sources:
  - resource: repo:package.json
  - resource: repo:bunfig.toml
  - resource: repo:tests/setup.ts
  - resource: repo:tests/helpers.ts
  - resource: repo:src/migrations.ts
  - resource: repo:src/sync.ts
  - resource: repo:src/deploy.ts
  - resource: repo:README.md
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-12T14:42:34+01:00 }
stale_after: 2027-02-10T14:42:34+01:00
---

# Workflows

## Install (development machine)

```sh
git clone https://github.com/Filprots/novadev.git && cd novadev
bun link            # puts `novadev` on PATH (~/.bun/bin/novadev → this clone's bin/novadev.ts)
```

No build step, no install step: there are no dependencies. Bun >= 1.4 is required.

## Run

- `novadev <command>` — the linked CLI. **It runs this working tree's `src/`**, so an
  edit takes effect immediately, in every project on the machine that uses the linked
  command — including this repo's own `.novadev/` bookkeeping. A half-finished change in
  `src/` can break `novadev sync` / `novadev knowledge log` for the round you are in;
  keep the tree runnable, or run bookkeeping commands from a clean checkout.
- `bun bin/novadev.ts <command>` — the same entry point, explicitly. Run from inside a
  project: the CLI finds `.novadev/` by walking up from the cwd.
- `novadev help` / `novadev --version`.

## Test

```sh
bun test                     # the whole suite: 625 tests in 33 files, ~55 s (verified 2026-11-12, branch robust-work)
bun test tests/work.test.ts  # one file
bun test -t "novadev work stop"   # by test name
```

`bunfig.toml` preloads `tests/setup.ts`, which removes this run's fixture folders
(`$TMPDIR/novadev-test-<pid>-*`) after the last file. Tests build fixture projects with
`tests/helpers.ts` and run the real CLI as a subprocess — they never touch this repo's
`.novadev/`. `package.json`'s `test` script is just `bun test`.

There is no type-check, lint or format command (see [stack](stack.md)).

## Debug

- `novadev doctor` — read-only structure check, exit 1 on problems.
- `novadev sync --check` — writes nothing; names every stale derived file and every
  problem. Use it to see what `sync` *would* change.
- `novadev status`, `novadev links`, `novadev knowledge --stale|--drifted`,
  `novadev features --touching <path>`.
- To reproduce a bug, write a fixture test: `project()` + `run(root, 'sync')` from
  `tests/helpers.ts` is the quickest harness.

## Release a version

Read off the release commits (`git log --oneline`: `novadev 0.14.0 — …`). Up to 0.15.0
everything landed in **one commit**; 0.16.0 landed as one commit per todo, each with its code,
tests and docs, and the bump in a last `novadev 0.16.0 — …` commit (the owner's choice for a
large batch). Either way:

1. Code + tests + `README.md` + the affected `templates/` (playbooks, folder READMEs).
2. Bump the version in **both** `package.json` `version` and `NOVADEV_VERSION` in
   `src/lib.ts` (`tests/migrations.test.ts` fails if they differ).
3. If the `.novadev/` layout or `novadev.json` settings change, append a `Migration`
   (`to`, `title`, `run`) to `MIGRATIONS` in `src/migrations.ts`, in version order; it
   must be safe to re-run and honour `dryRun`. A version with no layout change needs no
   migration — `migrate-repo` then only stamps the version.
4. Add a paragraph for the version to the README's *Upgrading* section (what changed for
   an existing project). Keep `bin/novadev.ts` HELP in step.
5. `bun test` green.
6. Commit as `novadev X.Y.Z — <what it gives>`.

Then, in **this repo** and in every project that uses novadev: `novadev migrate-repo`
(applies pending migrations, refuses a dirty tree without `--force`; `--dry-run` previews)
→ `novadev deploy` (refreshes playbooks, adapters, READMEs, and since 0.16.0 the
`.gitattributes` merge block and the clone's `novadev-derived` merge driver; refuses while
migrations are pending) → `novadev sync`. Deploying into the other projects changes them: it
waits for the owner's go-ahead. Until then `novadev sync` in an older project stops with
"repo is at X, installed novadev is Y".

UNVERIFIED: which consumer projects exist besides this one — the tests name a
`thph-consumer-test` batch (`tests/review31-findings.test.ts`).
Releases are not tagged (`git tag` lists none, 2026-11-10).
Commit `772a96c` (2026-11-04) added `todo edit` and attachments to `todo addendum`
without a version bump; the README's 0.15.0 paragraph already describes them.
A feature commit between releases waits for the next bump (772a96c waited for 0.16.0; so did
the commits of batch 2026-11-10_1).

## Editing the playbooks

Edit `templates/skills/*.md` (canonical), never `.novadev/skills/*.md` or
`.claude/skills/*/SKILL.md` (deployed copies, overwritten by the next `novadev deploy`).
Run `novadev deploy` here afterwards so this repo's copies match, and `bun test` —
`tests/docs.test.ts` asserts sections and phrases of the playbooks.

## CI, hooks, environments, secrets

- **No CI** (no `.github/`, no other pipeline config) and **no git hooks** installed.
  `novadev sync --check` is designed as the hook/CI gate for consumer projects.
- No environments, no services, no secrets. The only environment variables read are
  optional: `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID` (`src/work.ts`), and `GIT_*` handling.
- Pushing, merging, tagging and publishing are the human's decision (the playbook does
  not authorise them).
