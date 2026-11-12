---
type: Feature
id: FEAT-0019
title: "novadev worktree: one worktree per task across repositories"
description: "Make a worktree per task across the project and the sub-repos it changes, on one branch, with claims; gate it, write its merge request, keep it in step, merge it all-or-nothing (then sync --after-merge) and remove it — `novadev worktree create|list|status|gate|mr|sync|merge|remove`."
feature-status: shipped
status: stable
area: work
created: 2026-11-10
tags: [worktree, git-worktree, parallel, branch, merge-request, mr, gate, claims, merge-tree, all-or-nothing, lead, irris-worktree, sub-repos]
touches: [src/worktree.ts, tests/worktree.test.ts]
depends-on: [FEAT-0014, FEAT-0016, FEAT-0017, FEAT-0004]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: todo:2026-11-10_1/07-worktree-command
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-12T14:42:34+01:00 }
stale_after: 2027-11-12T14:42:34+01:00
---

# FEAT-0019 — novadev worktree: one worktree per task across repositories

## What it does

- `create <name> [<sub-repo>…] [--todo <batch>/<todo>]… [--claim <path>]… [--allow-overlap]` — a worktree of the
  project at `<dir>/<name>` on branch `<branchPrefix><name>` (from the default branch), a
  worktree of each named sub-repo inside it on the same branch (from its default branch),
  links to the main checkout for the other sub-repos and the `share` folders (excluded in
  `info/exclude`); claims checked against every other worktree and batch in work; registered
  in `<git common dir>/novadev/worktrees/<name>.json`. Rolls back what it made on a failure.
- **The worktree's todos**: `create --todo` names them (a todo that is already another worktree's
  task is a notice, not a refusal — the todo's lock is the gate), `work start` inside the worktree
  adds the todos it locks; `list`/`status` show them and `mr` opens with `Todo:` lines.
- `claim <name> <path>… [--allow-overlap]` — more claims for an existing worktree, with create's
  overlap check (the batches locked in that worktree never block it); a path in a sub-repo the
  worktree has no worktree of is refused.
- `list [--json]`, `status <name>` — branches, sub-repos, claims, batches in work; per
  repository: ahead/behind, uncommitted, diffstat.
- `gate <name>` — per repository: clean tree, `git diff --check`, changes inside the claims —
  the worktree's and those of every batch locked in it (`work claim`) — (`.novadev/` aside), `novadev sync --check` (the project), and the `gate` commands of
  novadev.json (with NOVADEV_WORKTREE/BRANCH/BASE/CHANGED). Exit 1 on a failure.
- `mr <name>` — the merge request's text: commits per repository (`irrippr@hash`), claims,
  batches still in work, the gate line and the checklist.
- `sync <name>` — merge each default branch into the worktree, then always `sync --after-merge`
  (a run stopped by a sub-repo conflict regenerates on the next).
- `merge <name> [--yes]` — the lead, on the main checkout: refuses dirt, a main checkout off
  its default branch, an untracked file there the branch would write, and a batch still WORKING
  on the branch (a lock it added or changed; a paused one may go); `git merge-tree` pre-checks
  every repository and merges nothing unless all would go; sub-repos first, the project last,
  `--no-ff`; a merge that still fails late (a hook) undoes the ones this run made (`reset
  --keep`); then `novadev sync --after-merge`. Without `--yes`, a dry run.
- `remove <name> [--force]` — links, worktrees (sub-repos first), merged branches (`-d`;
  `--force` drops unmerged ones and uncommitted changes), its registry entries.

## How it works

`src/worktree.ts`: settings (`parseWorktreeSettings`, `"worktree"` in novadev.json), the
subcommands, and its own git runner (writes are this command's, never `src/git.ts`'s). The
main checkout is git's first worktree; the project must sit at the top of its repository.
Claims and the registry entry come from `src/registry.ts`; sub-repos from `src/subrepos.ts`;
the project's default branch from `src/branch.ts`.

## Progress

- 2026-11-10 — built: `2026-11-10_1/07-worktree-command`
- 2026-11-10 — fixes from the independent review of batch 2026-11-10_1, before the 0.16.0 release (`2026-11-10_1/07-worktree-command`)
- 2026-11-12 — the gate reads the claims of the batches locked in the worktree; `worktree claim` (`2026-11-12_1/01-worktree-gate-reads-batch-claims`, `2026-11-12_1/04-worktree-batch-claims-files-only`)
- 2026-11-12 — a worktree knows its todos: `create --todo`, `Todo:` lines in the merge request (`2026-11-12_2/02-todo-is-the-unit-of-work`)

## Open questions

- Not ported from `irris-worktree`: the main-checkout commit guard (hooks) and the hydra-check
  suggestions for `gate`/`mr` — IRRIS-specific; a project's `gate` commands cover the checks.

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
