---
type: Wiki Page
title: Glossary
description: "novadev's own vocabulary as the code uses it — batch, todo, brief, record, gate, lock, waypoint, feature, concept, actor, trust tier, stale, drifted, test task and round, hub, known debt, debt budget, raise, placement, grace period, derived block — with the file or constant that defines each."
tags: [glossary, vocabulary, terms, records, knowledge, metrics]
sources:
  - resource: repo:src/lib.ts
  - resource: repo:src/work.ts
  - resource: repo:src/knowledge.ts
  - resource: repo:src/okf.ts
  - resource: repo:src/metrics.ts
  - resource: repo:src/debt-budget.ts
  - resource: repo:src/placement.ts
  - resource: repo:templates/skills/novadev-work.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:28:02+01:00 }
stale_after: 2027-02-08T15:28:02+01:00
---

# Glossary

The playbook's *Vocabulary* section (`templates/skills/novadev-work.md`) is the canonical
wording for agents; this page maps each word to the code.

## Work

- **Batch** — `todos/YYYY-MM-DD_N/` (`BATCH_RE`; `N` = same-day sequence, counting the
  archive). `novadev new` and `file-todo` pick the next free `N`.
- **Todo** — one folder in a batch, `NN-<slug>/`. A `00-program` todo is the batch's plan.
- **Brief** — the todo's input: a human's `.txt`/`.md` (+ screenshots), or `prompt.md`
  written by an agent/`file-todo` for a chat request. *Chat addendum*: a dated section a
  later message appends to a brief (`todo addendum`); `.brief-history/` keeps old briefs.
- **Ref** — how a todo is named: `2026-10-16_2/02-router`; `todo` also accepts
  `2026-10-16_2/02` or a slug word only one open todo has. Work is always cited by ref or
  id, never by path (archiving moves folders).
- **Record** — the agent's file in a todo: `ai_completed.md`, `ai_failed.md` (deferred,
  cancelled, merged, blocked), `ai_progress.md`. Its `**Feature:**`, `**Commits:**` and
  `**Date:**` lines are the authored links (`readField`).
- **Gate** — `ai_needstest.md`: work landed but a person must test it. Outranks every
  other record (`todoState`) and is *not* terminal, so the batch cannot archive. Closed by
  `ai_confirmed.md` after review.
- **Todo state** — `open · progress · completed · failed · needstest · confirmed`;
  terminal = completed, failed, confirmed (`TERMINAL_STATES`).
- **`.filed-from-chat`** — marker in a batch `file-todo` created; only such a batch, still
  untouched, is reused by later filings (`planBatch`).
- **Grace period** — a fully recorded batch gets `completed.md` and stays in `todos/` for
  `archiveGraceDays` (default 3) before `sync` archives it.
- **Archive** — `archive/<year>/todos/<batch>/` and `archive/<year>/totest/<task>/rev<N>-<date>/`.
- **Postponed** — `postponed/<slug>.md` with `do-when` / `discard-if`; **spark** — a raw idea
  in `sparks/`.

## The lock

- **Lock** — `todos/<batch>/working.md` (`WORK_LOCK_FILE`): state `working` or `paused`,
  holder (agent actor, host, pid, session), `started`, `updated` (the heartbeat), last todo
  and phase. While it exists the batch is *in work*: never complete or archived, and
  `file-todo` never reuses it (`todo` writes wait only while the holder is live).
- **Waypoint** — one entry of the lock's trail, newest first: todo, loop phase
  (`LOOP_PHASES`, 0 ORIENT … 10 CLOSE), what is done, what is next.
- **Pause** — the last, exhaustive waypoint (`work pause`, `/novadev-pause`): stopped at,
  next, done, how to resume, open questions, plus the git state novadev captures itself.
- **Abandoned** — a `working` lock whose process is gone (same host) or with no heartbeat
  for 120 min (`STALE_AFTER_MINUTES`); `work start` takes it over without `--take`.

## Human testing

- **Test task** — `totest/<task>/` (usually `FEAT-NNNN-<slug>`): `test-plan.md` with
  `## Scenario` sections (Expect (pass) / Watch for (fail)) and `test-results/`. One
  *living* task per feature, revised in place.
- **Round** — one pass of testing on a task (`revision`); a reviewed round archives as
  `rev<N>-<date>`. Status `awaiting-test` → `reviewed`.
- **Scenario file / review** — `test-result write` appends to `scenario-<N>.txt`;
  `test-result review` appends a dated block to `review.md`. Never overwritten.

## Knowledge

- **Bundle** — `.novadev/knowledge/`, an Open Knowledge Format 0.2 directory.
- **Concept** — one markdown file with OKF frontmatter; its path is its identity. Types:
  `Wiki Page`, `Guardrail`/`Gotcha`/`Decision`/`Guide` (memories), `Feature`; derived
  `work.md`/`tests.md` and `index.md`s are not hand-written.
- **Actor** — `human:<id>`, `<tool>/<model>` (an agent), `process:<id>`; `agent/unrecorded`
  marks content migrated from before 0.12.0.
- **Stamps** — `generated {by, at}`, `verified` events, `stale_after`; written only by
  `novadev knowledge log`, together with a `log.md` entry (*recording a change*).
- **Trust tier** — unverified / machine-confirmed / human-reviewed, from `verified`.
- **Stale** — past `stale_after` (review days per folder in `novadev.json` `knowledge.reviewDays`).
- **Drifted** — a `repo:` source has a commit dated after the concept was last written
  or verified.
- **Feature** — `knowledge/features/FEAT-NNNN-<slug>/feature.md`: one capability, with
  `feature-status` (planned → in-progress → shipped → deprecated; OKF `status` is derived
  from it), `area`, `tags`, `touches` (owned paths) and relations (`depends-on`,
  `supersedes`, `superseded-by`, `conflicts-with`).
- **Link graph** — records name features and commits (authored); each feature's
  `work.md`/`tests.md` are derived from that (`novadev links --fix`, `sync`).

## Metrics and placement (opt-in)

- **Metrics command** — a shell command in `novadev.json` printing `{ debt, hubs }` JSON.
- **Snapshot** — `metrics/latest.json`, written by `sync`; compared with the last commit's.
- **Known debt** — `debt.known` in the snapshot: problems the project accepts for now.
- **Hub** — a file/folder that collects too much: from the snapshot's `hubs[].path`, else
  `hubs` in `novadev.json`.
- **Debt budget** — `debtBudget.maxKnown`; a **raise** (`**Raise:** 230 → 238` in a record's
  `## Debt` section, this round only) lifts it, and the ledger `debtBudget.raises` remembers it.
- **Budgets block** — the derived `## Budgets` block in a wiki page (default
  `architecture.md`) between `novadev:budgets` markers.
- **Placement** — a record's `## Placement` section: where new units went and why not on a
  hub; required (after `placementSince`) when the record's commits changed a hub file.

## Parallel work (0.16.0)

- **Default branch** — where work lands and the only branch that archives: `"defaultBranch"`
  in `novadev.json`, else `origin/HEAD`, else `init.defaultBranch` / `main` / `master`
  (`src/branch.ts`, `defaultBranch` in `src/git.ts`).
- **Sub-repo** — an independent repository nested in the project, listed by `"subrepos"`
  (`["repos/*"]`) and named by its folder; **`repo@hash`** — a record's way to name its commit
  (`irrippr@abc1234`); **`**Repos:**`** — the sub-repos a todo changed (`src/subrepos.ts`).

## Bookkeeping words

- **Derived block / file** — content novadev regenerates (`<!-- novadev:<name>:begin -->`
  … `end`, or a whole file); never hand-edited.
- **Managed file** — carries "managed by `novadev deploy`"; deploy overwrites it.
- **NEXT ACTIONS / WAITING ON THE HUMAN** — the two lists `sync` prints.
- **Adapter** — a thin per-agent pointer to a playbook (`.claude/skills/*/SKILL.md`,
  `.cursor/rules/novadev.mdc`, the marked sections of `AGENTS.md`/`CLAUDE.md`).
