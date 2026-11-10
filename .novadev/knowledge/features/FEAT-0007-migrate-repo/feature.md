---
type: Feature
id: FEAT-0007
title: "migrate-repo: version-aware layout migrations"
description: "After pulling a newer novadev, run `novadev migrate-repo` in a project to apply every layout migration it has not reached yet, in order, then stamp the new version (`--dry-run` previews, a dirty tree needs `--force`)."
feature-status: shipped
status: stable
area: setup
created: 2026-11-10
tags: [migrate-repo, migrations, upgrade, version, layout, dry-run, knowledge-migration]
touches: [src/migrations.ts, src/knowledge-migration.ts, tests/migrations.test.ts, tests/knowledge-migration.test.ts]
depends-on: [FEAT-0001]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: commit:72e0194
  - resource: commit:185be32
  - resource: commit:6f44665
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:18:33+01:00 }
stale_after: 2027-11-10T15:18:33+01:00
---

# FEAT-0007 — migrate-repo: version-aware layout migrations

## What it does

`novadev migrate-repo` reads the version in `.novadev/novadev.json`, runs every pending
migration in `MIGRATIONS` in order (a repo at 0.4.0 runs 0.5.0, then 0.6.0, …), and stamps
the installed version. When no migration is pending it only stamps. It refuses an
unreadable manifest, a project newer than the CLI, and a dirty working tree unless
`--force`; `--dry-run` prints what each step would do. Afterwards: `novadev deploy`, then
`novadev sync`. `sync` and `deploy` both refuse a project that still needs it.

Migrations so far: 0.5.0 living test tasks · 0.6.0 feature folders + namespaced archive ·
0.7.0 single gateway skill · 0.9.0 `novadev-*` skills · 0.10.0 metrics settings · 0.11.0
placement settings · 0.12.0 the knowledge bundle (`src/knowledge-migration.ts`: OKF
frontmatter, `INDEX.md` one-liners become descriptions, links kept, stamps say
`agent/unrecorded`).

## How it works

`src/migrations.ts` — each `Migration` is `{ to, title, run(ctx) }`, safe to re-run, and
honours `ctx.dryRun`. `tests/migrations.test.ts` pins the list's order and that
`package.json` and `NOVADEV_VERSION` agree.

## Progress

- 2026-08-28 — landed in 0.6.0 (commit 72e0194): version-aware, stepwise migrations
- 2026-10-01 — 0.10.0 / 0.11.0 (commits a33c803, 2974044): settings migrations
- 2026-10-11 — 0.12.0 (commit 185be32): the knowledge-bundle migration
- 2026-10-11 — fix (commit 6f44665): an old header's nested values kept exactly as written

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
