---
type: Gotcha
title: A project root is not a worktree top — compare by containment, never by equality
description: When code compares a project root (where .novadev/ is) with paths from `git worktree list`, `git rev-parse --show-toplevel` or a registry entry — the project may sit below its repository's top.
tags: [worktree, registry, git, paths, project-root, toplevel, realpath]
created: 2026-11-10
sources:
  - id: found
    resource: todo:2026-11-10_1/01-worktree-visible-locks
    title: the independent review of batch 2026-11-10_1, finding 1
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T16:13:34+01:00 }
stale_after: 2027-05-09T16:13:34+01:00
---
`git worktree list` gives each worktree's TOP; novadev's project root is the folder holding
`.novadev/`, which can be `repo/app/`. The first registry compared the two with equality, so in a
nested project every other worktree's lock looked "gone", was pruned, and the cross-worktree
refusal and the claims did nothing — while every test passed, because every fixture had
`.novadev/` at the top.[^found]

**Why:** a check that silently treats everything as absent fails open: nothing errors, the
protection just vanishes.

**How to apply:** ask "is this root INSIDE that worktree top" (realpath both, then equal or
prefix + "/"), and when several tops match take the deepest (a worktree may live inside the main
checkout's folder) — `insideWorktree` in `src/registry.ts`. Add a nested-project fixture to any
test of worktree-aware code (`tests/review016-findings.test.ts` has one).
