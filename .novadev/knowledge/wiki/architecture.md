---
type: Wiki Page
title: Architecture
description: "The module map (which src/ file owns which command or concern), the audit/fix pattern behind sync and doctor, the data flow of `novadev sync`, where state lives, and the read-only git boundary."
tags: [architecture, modules, sync, audit, state, git, derived-files]
sources:
  - resource: repo:bin/novadev.ts
  - resource: repo:src/sync.ts
  - resource: repo:src/lib.ts
  - resource: repo:src/doctor.ts
  - resource: repo:src/git.ts
  - resource: repo:src/knowledge.ts
  - resource: repo:src/links.ts
  - resource: repo:src/work.ts
generated: { by: claude-code/claude-fable-5-2, at: 2026-11-12T15:39:48+01:00 }
stale_after: 2027-02-10T15:39:48+01:00
---

# Architecture

A single-process CLI. `bin/novadev.ts` holds the HELP text and a `switch` that
lazy-imports (`await import`) one `src/` module per command and calls its one exported
function. Every command except `deploy` (which works on the cwd) finds the project by
walking up from the cwd to the folder that contains `.novadev/` (`requireProjectRoot` in
`src/lib.ts`).

## Module map

| Command / concern | Module(s) |
|---|---|
| shared model: folder names, record names, todo states, batch/feature/test-task readers, markers, `Parsed<T>`, `fail()` | `src/lib.ts` (the hub: ~1,000 lines, imported by every module but `okf.ts` and `git.ts`) |
| `deploy` | `src/deploy.ts` (+ `templates/`) |
| `migrate-repo` | `src/migrations.ts` (ordered `MIGRATIONS` list); the 0.12.0 step in `src/knowledge-migration.ts` |
| `new` | `src/new.ts` |
| `status [--json]` | `src/status.ts` |
| `sync [--check]` | `src/sync.ts` — orchestration only; the logic lives in the audits below |
| `doctor` | `src/doctor.ts` — folder-shape checks + the same audits as sync |
| `archive` (+ the sweep sync runs) | `src/archive.ts` (`sweepDone`, `sweepBatches`); where it may move things: `src/branch.ts` |
| `work …` (the lock on a todo, or on a whole batch) | `src/work.ts` (also `auditWork`); the registry every worktree reads, and claims: `src/registry.ts` |
| `file-todo …` | `src/file-todo.ts` (CLI) → `src/todo-filing.ts` (mechanics) |
| `todo …` | `src/todo.ts` (reuses `todo-filing.ts` and the lock from `work.ts`) |
| `totest` | `src/totest.ts` |
| `test-result …` | `src/test-result.ts` (CLI) → `src/test-results.ts` (mechanics) |
| `features` (`--touching`, `--new`) / `--hubs` | `src/features.ts` / `src/feature-hubs.ts` |
| `links [--fix]`, derived `work.md`/`tests.md` | `src/links.ts` (`auditLinks`) |
| knowledge bundle: format layer | `src/okf.ts` (OKF 0.2 only — imports no novadev module) |
| knowledge bundle: novadev's profile, indexes, staleness, drift | `src/knowledge.ts` (`auditKnowledge`) |
| `knowledge …` / `knowledge log` | `src/knowledge-cmd.ts` / `src/knowledge-log.ts` |
| metrics hook, snapshot, deltas | `src/metrics.ts`; the debt budget in `src/debt-budget.ts`; file-only judgements + wiki budgets block in `src/metrics-audit.ts` |
| hub paths / the `## Placement` check | `src/hubs.ts` / `src/placement.ts` |
| sub-repos (`"subrepos"`, `repo@hash` commits, `**Repos:**`) | `src/subrepos.ts` — used by links and placement |
| merge rules (`.gitattributes` block, driver) and `sync --after-merge` | `src/merge-rules.ts` |
| the review record and team mode (`todoState`'s review gate) | `src/review.ts` — imported by `lib.ts` |
| `worktree …` (one worktree per task across repositories; `queue …`, the merge queue) | `src/worktree.ts`; the queue's state and its one-at-a-time lock: `src/queue.ts` |
| what an overlapping claim means (`"claims"`, `"protectedPaths"`), who shares what | `src/claim-policy.ts` |
| a todo's priority, its "do after" links, the lead | `src/todo-meta.ts`, `src/todo-links.ts`, `src/lead.ts` — none imports `todo.ts` |
| area owners and required reviewers (`"owners"`, `owners …`) | `src/owners.ts` |
| the work-in-progress limit (`"wipLimit"`) | `src/wip.ts` (counts; `work.ts` refuses) |
| git (read-only questions) | `src/git.ts` — but see *The git boundary* |

Dependency direction: command modules → audits/mechanics → `lib.ts` → `okf.ts`. `okf.ts`
and `git.ts` import nothing of novadev's.

## The audit pattern

Checks are pure-ish functions that read files (and git) and return lists, never print:
`auditLinks`, `auditKnowledge`, `auditMetrics`, `auditPlacement`, `auditWork`. They return
some of `problems` (broken: sync exits 1, `--check` fails), `actions` (NEXT ACTIONS for the
agent), `waiting` (the human's), `notes` (informational) and `fixes` — `Fix = { path,
label, next }`, the new content of a derived file (`next: null` deletes it), applied by
`applyFix`. `sync` and `doctor` call the same audits, so they agree; `sync --check` computes
the fixes and reports them as "stale" instead of writing.

## Data flow of `novadev sync` (`src/sync.ts`)

1. **Version gate** — a project whose `novadev.json` version is older than the CLI stops
   here: run `migrate-repo`, then `deploy`.
2. **Metrics** — `refreshMetrics` runs the project's command (if set), compares with the
   last commit's snapshot, applies budget raises; then `auditMetrics` and
   `auditPlacement` judge the tree *before* anything moves.
3. **Derived content** — fixes from `auditLinks` (each feature's `work.md`/`tests.md`),
   metrics (`metrics/latest.json`, the wiki budgets block) and `auditKnowledge` (every
   `index.md`, each feature's OKF `status`) are written (or, with `--check`, listed).
4. **Archive** — `sweepDone`: reviewed test rounds move to `archive/<year>/totest/…`;
   finished batches get `completed.md` and move to `archive/<year>/todos/` once the grace
   period passes — on the default branch only (`archivePlace`, `src/branch.ts`); on any
   other branch the moves are listed as "not archived here". Skipped under `--check`.
5. **Validate** — links and knowledge are audited again on the moved tree; `auditWork`
   reads the locks. Prints PROBLEMS, *in work*, batches held for grace.
6. **Lists** — NEXT ACTIONS (locks, knowledge, todos without records, review of walked
   tests, link notes, postponed triggers, metrics growth, placement) and WAITING ON THE
   HUMAN (tests to walk, paused batches). Exit 1 on problems (or, with `--check`, on any
   stale file, unwritten raise, uncheckable or exceeded budget).

## Where state lives (in a deployed project)

| State | Where | Written by |
|---|---|---|
| version + settings (`archiveGraceDays`, `defaultBranch`, `subrepos`, `team`, `metrics`, `debtBudget`, `hubs`, `placementSince`, `knowledge`) | `.novadev/novadev.json` | `deploy`, `migrate-repo`, `sync` (budget raises); hand-edited settings |
| briefs and records | `.novadev/todos/<batch>/<todo>/` | human / agent / `file-todo`, `todo` |
| the lock + waypoint trail | `.novadev/todos/<batch>/<todo>/working.md` (a todo); `.novadev/todos/<batch>/working.md` (the whole batch, and 0.17.0 locks) | `work` only |
| finished marker | `.novadev/todos/<batch>/completed.md` | `sync` only |
| test queue | `.novadev/totest/<task>/test-plan.md`, `test-results/` | agent, `totest`, `test-result` |
| archive | `.novadev/archive/<year>/{todos,totest}/` | `sync`, `archive` |
| knowledge | `.novadev/knowledge/` (concepts, derived `index.md`s, `log.md`) | agent + `knowledge log`; `sync` derives |
| metrics snapshot | `.novadev/metrics/latest.json` | `sync` only |
| the registry (every worktree's batches in work with their claims; the worktrees novadev made) | `<git common dir>/novadev/locks/<batch>.<todo>.json` (a todo), `<batch>.json` (the whole batch; a 0.17.0 lock on part of a batch: `<batch>@<worktree hash>.json`), `…/worktrees/<name>.json`, `queue.json` and `queue.lock` (the merge queue) — inside `.git`, never committed | `work`, `worktree` (`src/registry.ts`) |

All of it is meant to be committed, except the registry: it is a mirror of the locks for the
other worktrees of the same clone. Work files
(`working.md`, `completed.md`, test plans, postponed items) use flat `key: value`
frontmatter read as text by `readFrontmatter` (`src/lib.ts`); knowledge concepts are real
YAML read by `src/okf.ts`.

## The git boundary

novadev **writes to git in named places only**: `novadev deploy` defines the
`novadev-derived` merge driver in the clone's config, and `novadev sync --after-merge` commits
what it regenerated in `.novadev/` (both in `src/merge-rules.ts`); `novadev worktree` makes and
removes worktrees and branches and merges them (`src/worktree.ts`). Everything else is
read-only and answers `null` when git cannot tell, and callers then fall back to
the working tree. `src/git.ts` is the shared home of those questions (`lastCommitDate`,
`headSummary`, `dirtyPaths`, `fileAtHead`, `unchangedSinceHead`, `commitPaths`).
`lastCommitDate` alone asks the repository that *holds* the path (possibly one nested in
the project) and strips `GIT_DIR`-style variables to do so; the rest ask the project's repo.
**But it is not the only caller**: `src/knowledge.ts`, `src/links.ts` (`cat-file
--batch-check`), `src/migrations.ts` (`status --porcelain`), `src/knowledge-log.ts`
(`config user.name`) and `src/knowledge-migration.ts` (`log`) each have a private
`execFileSync('git', …)`, all read-only. TODO(wiki): is consolidating them into `git.ts`
wanted?

## Templates

`templates/skills/*.md` are the five playbooks; `templates/readmes/*.md` the folder
READMEs. `deploy` copies them (from `packageDir()`, the clone the CLI runs from) and
generates the adapters from `SKILLS` in `src/lib.ts`. Every managed file carries
"managed by `novadev deploy`"; a README without that line is the project's own and is kept.
