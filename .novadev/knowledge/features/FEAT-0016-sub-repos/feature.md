---
type: Feature
id: FEAT-0016
title: "Sub-repos: commits in nested repositories"
description: "A super-repo lists its nested repositories in \"subrepos\" (novadev.json); a record names a sub-repo's commit as `irrippr@abc1234` and the sub-repos it changed in `**Repos:**`, and links, work.md and the placement check resolve each commit in its own repository."
feature-status: shipped
status: stable
area: knowledge
created: 2026-11-10
tags: [subrepos, sub-repo, super-repo, nested-repository, repo-at-hash, commits, repos-line, multi-repo]
touches: [src/subrepos.ts, tests/subrepos.test.ts]
depends-on: [FEAT-0005, FEAT-0012]
supersedes: []
superseded-by: []
conflicts-with: []
sources:
  - resource: todo:2026-11-10_1/02-multi-repo-commits
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:28:02+01:00 }
stale_after: 2027-11-10T15:28:02+01:00
---

# FEAT-0016 — Sub-repos: commits in nested repositories

## What it does

- `"subrepos": ["repos/*", "vendor/engine"]` in `.novadev/novadev.json` names the nested
  repositories (a last `/*` = every repository in that folder). Each is named by its folder.
- A record writes `**Commits:** 4f2a9c1, irrippr@abc1234` (a bare hash is the project's own
  repository) and `**Repos:** irrippr` (the sub-repos the todo changed).
- `novadev links` / `sync` report a commit missing from the repository it names, a name that is
  not a sub-repo (in `**Commits:**` or `**Repos:**`), and a bare hash that really is a sub-repo's
  ("write it as irrippr@abc1234"); two sub-repos with one name are a problem.
- Each feature's `work.md` lists commits as written and the repos of each todo; the placement
  check asks the sub-repo which files its commit changed (paths come back with the sub-repo's
  folder in front, so a hub inside it matches).

## How it works

`src/subrepos.ts`: `parseSubreposSetting`, `listSubrepos(root)` (cached per run; a folder counts
when it is the top of a git work tree of its own — `isRepositoryTop` in `src/git.ts`),
`commitRefsIn` (the one parser of a `**Commits:**` value), `repoNamesIn`, and `commitChanges`
(project-relative paths per commit, for `src/placement.ts`). `src/links.ts` checks each ref in
its repository (`hasCommit(..., nested)`); `src/sync.ts` lifts those notes into NEXT ACTIONS.
Git is asked of a sub-repo without the variables a hook exports, so the sub-repo itself answers.

## Progress

- 2026-11-10 — built: `2026-11-10_1/02-multi-repo-commits`

---

The work that built it and the human test rounds that checked it: [work.md](work.md) ·
[tests.md](tests.md) — both derived by `novadev sync`.
