---
type: Gotcha
title: Bumping NOVADEV_VERSION stops this repository's own novadev until it is migrated
description: When you work on novadev itself and are about to change NOVADEV_VERSION (src/lib.ts) or package.json's version — do it last in the batch, then migrate-repo and deploy here at once.
tags: [release, version, bump, dogfooding, migrate-repo, deploy, linked-cli]
created: 2026-11-10
sources:
  - id: found
    resource: todo:2026-11-10_1/07-worktree-command
    title: the 0.16.0 release of batch 2026-11-10_1
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T16:13:34+01:00 }
stale_after: 2027-05-09T16:13:34+01:00
---
The `novadev` on the PATH is `bun link`ed to THIS working tree, and this repository is itself a
novadev project. The moment `NOVADEV_VERSION` changes, every `novadev sync` here stops with
"repo is at X, installed novadev is Y — run migrate-repo", and the batch's bookkeeping (records,
`knowledge log`, the close-out) runs against a CLI that refuses it.[^found]

**Why:** the version gate in `sync` (and `deploy`) compares `.novadev/novadev.json` with the code,
and here both are the same checkout.

**How to apply:** land every todo first; bump the version in the last commit of the release; in the
same step run `novadev migrate-repo` (`--force` when the tree is dirty — a layout-free release only
stamps), `novadev deploy` (it refreshes `.novadev/skills/` from `templates/`), then `novadev sync`.
A broken `src/` breaks the bookkeeping the same way — run `bun test` before trusting the CLI.
