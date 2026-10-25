# novadev

A **framework/language/IDE/agent/LLM-agnostic structured development system**.
One command deploys a git-tracked folder tree + one agent playbook into any project.
From then on you write task briefs; the agent runs a fixed loop that does the work,
records it, registers the feature, hands you what only a human can test, keeps the
knowledge true, and archives what is finished. The folder becomes the development history.

The project's knowledge — its wiki, its memories, its features — is one
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format)
(OKF 0.2) bundle from day 0: plain markdown files any agent or tool can read, each saying
who wrote it, who checked it, where it came from and when it is due for a re-check, with a
log of every change. See *Knowledge* below.

## Install

Requires [Bun](https://bun.sh) (>= 1.4: novadev reads YAML frontmatter with Bun's own parser, so it needs no dependencies).

```sh
git clone https://github.com/Filprots/novadev.git
cd novadev
bun link          # registers the `novadev` CLI globally
```

The CLI runs straight from the clone, so upgrading is just:

```sh
cd novadev
git pull          # then, in each project: `novadev migrate-repo`, then `novadev deploy`
```

## Use

```sh
cd your-project
novadev deploy    # creates .novadev/ — the knowledge bundle included — + the four playbooks + agent adapters
```

Then:

```sh
novadev new fix-login add-dark-mode   # scaffold todos/2026-08-16_1/{01-fix-login,02-add-dark-mode}/
novadev sync                          # the close-out: measure (if set), derive, archive, validate, list what's left
novadev totest                        # what needs YOUR hands-on testing
novadev status                        # is a work cycle on? then open todos + record states, postponed, health
novadev work start 2026-08-16_1       # take a batch's lock (agents do this; see Work in progress)
novadev features --touching src/auth  # which features already own this code (conflict pre-flight)
novadev features --hubs               # which features lean on each hub (see Placement)
novadev knowledge                     # what the knowledge bundle holds: types, trust, what is stale
novadev knowledge magic link --stale  # search it; --type, --tag, --tier, --stale and --drifted filter
novadev knowledge log events.json     # record changes: each concept's stamps + its log entry
novadev migrate-repo                  # upgrade an older .novadev/ layout to this version
```

Most of the time you do not type any of these — you talk to the agent, and it runs
them. Five slash commands come with the deploy: `/novadev-work` (do the work),
`/novadev-file-a-todo` (file what you just said), `/novadev-what-to-test` (walk the
queue with me), `/novadev-test-review` (write up testing you already did),
`/novadev-pause` (stop where we are; the next `/novadev-work` picks up from there).

## Upgrading

`.novadev/novadev.json` records the version the repo's layout is at. After pulling a
newer novadev, run `novadev migrate-repo`: it applies every migration the repo has not
reached yet, in order (a repo at 0.5.0 runs 0.5.0→0.6.0 then 0.6.0→0.7.0), and stamps
the new version. `--dry-run` previews the moves; it refuses to run on a dirty working
tree so the migration lands as a reviewable diff of its own. Then `novadev deploy` to
refresh the playbook, and `novadev sync`. Both `sync` and `doctor` tell you when a
repo is behind, and `deploy` refuses to run until `migrate-repo` has: deploy stamps the
new version, and a current stamp would make `migrate-repo` skip the migrations.

0.10.0 adds two settings to `novadev.json`, `metrics` and `debtBudget`. `migrate-repo` writes
both as `null`, which means off; see *Metrics and the debt budget* below to turn them on.
0.11.0 adds two more: `hubs`, written as `null` (off), and `placementSince`, set to the day
`migrate-repo` runs; see *Placement* below.

0.12.0 moves `wiki/`, `memories/` and `features/` into `.novadev/knowledge/`, one Open
Knowledge Format bundle. `migrate-repo` gives every page, memory and feature OKF
frontmatter: a memory's `kind` becomes its `type` (a kind outside the four is left for an
agent to choose), a feature's `status` becomes `feature-status`, and each old `INDEX.md`
one-liner becomes that file's `description` — the INDEX.md files go, because `index.md` is
derived now. Who wrote and checked the old content was never recorded, so its stamps say
`agent/unrecorded`; their dates come from the files and git. It also adds `"knowledge":
{ "reviewDays": … }` to `novadev.json` and starts `knowledge/log.md`. Then `novadev deploy`
and `novadev sync`, and let an agent work the list sync prints.

0.13.0 changes no layout: `migrate-repo` only stamps the version (and `novadev deploy` on a
0.12.0 repo stamps it too). A `novadev.json` from 0.12.0 means what it meant. The new
settings are opt-in: `"knowledge"` may give review days to any top-level folder of the
bundle, and to `"*"` for the rest, and `"folders"` gives a folder the project adds its line
in the map. One check is new for everyone: `novadev sync` lists a concept whose `repo:`
source changed after the concept was last checked. A bundle that cites no `repo:` source
sees nothing new. See *Knowledge* below.

0.14.0 changes no layout either: `migrate-repo` only stamps the version. It adds a fifth
playbook, `/novadev-pause`, and the lock of a batch in work, `todos/<batch>/working.md`,
which `novadev deploy` teaches the agents (see *Work in progress* below). A repo with no
lock behaves exactly as before; the one visible change is that `novadev status` starts
with whether a work cycle is on.

## The system

```
.novadev/
  knowledge/   the project's KNOWLEDGE — one Open Knowledge Format bundle (see Knowledge):
    index.md     the load-first map, derived by `novadev sync`
    log.md       every change to the knowledge, newest day first
    wiki/        project pre-context agents load first (strict page set; the agent creates it)
    memories/    guardrails, gotchas, decisions and guides, written the moment they cost time
    features/    what the software DOES — FEAT-NNNN/ folders: feature.md + derived work.md/tests.md
  todos/       task batches YYYY-MM-DD_N/<todo>/ — briefs: human-authored (.txt/.md + screenshots) or agent-filed prompt.md (chat-initiated);
               a batch in work carries working.md, its lock (see Work in progress)
  archive/     finished work by year — <year>/todos/<batch>/ and <year>/totest/<task>/<round>/
  postponed/   deferred work with do-when / discard-if triggers
  sparks/      raw unshaped ideas
  totest/      the ACTIVE queue of tests waiting on a human (rounds archive once reviewed)
  metrics/     latest.json — the newest snapshot of the project's own numbers (when a metrics command is set)
  skills/      the five canonical playbooks, novadev-*.md (agent-agnostic; managed by deploy)
```

**Archiving has a grace period.** A batch whose todos are all recorded gets an
autogenerated `completed.md` at its root and **stays in `todos/` for three days**
(`archiveGraceDays` in `.novadev/novadev.json`) before moving to
`archive/<year>/todos/`. Recent work stays where you look for it, agents read the
marker and know the batch is finished, and — because the day's batches remain
visible — you never hand-create a `2026-09-01_1` whose name the archive already
claimed. `novadev doctor` catches that collision anyway, and tells you the next free
number.

**Records.** When an agent concludes a todo it writes `ai_completed.md`
(what/verification/date) or `ai_failed.md` (deferred/cancelled/merged/blocked +
why) into the todo folder; long-running work carries `ai_progress.md`. One record
per todo, updated in place if status changes. Every record also says where its new
code went, in a `## Placement` section (see *Placement* below).

**Human testing.** Agent-verified is not human-verified. When work lands that an
agent could not check itself — how it renders, how it feels, a real device, a
third-party sandbox — it does not say "please double-check this" in chat, where the
hand-off scrolls away. It files a task in `totest/` with a stepped `test-plan.md`
(every scenario carrying an explicit **Expect (pass)** and **Watch for (fail)**) plus
an empty `test-results/` for your notes and screenshots, and gates the todo with
`ai_needstest.md`.

Tasks are named after the feature (`totest/FEAT-0007-magic-link/`), one per feature,
and `totest/` holds only **open** rounds — so everything in it is genuinely waiting on
you. A reviewed round archives to `archive/<year>/totest/<task>/rev<N>-<date>/` with
its plan and your evidence intact, and the feature's `tests.md` lists it with its
verdict.

When later work changes that feature, the agent revives the task from its last
archived round and revises the plan: rewriting scenarios whose expectations moved,
deleting ones the change made irrelevant, adding ones for the new behaviour, and
logging what changed under `## Revisions` so you know what is different since you last
tested. That rule exists because a scenario describing behaviour that no longer exists
is worse than no scenario — you would walk it, hit the old expectation, and report a
failure that is really just a stale plan.

That gate is **not terminal**: `novadev sync` refuses to archive the batch while it is
open, so a pending test cannot be forgotten. `novadev totest` (and the top of
`novadev status`) shows what is waiting on you. You test and write results into the
folder — that is your whole part. The next `novadev sync` sees them and puts the
review on the agent's list: it reads your notes and screenshots, judges each scenario
against its written expectation, writes `ai_confirmed.md` with the verdict on every
todo the round gated, and files follow-up todos for whatever failed. An agent never
reviews a task with an empty results folder — silence is never read as a pass.

**Chat-initiated work.** When the human asks an agent in chat to
implement/fix/change something that no open todo already covers, the agent must
file it as a todo itself, before starting (a matching postponed item or spark
graduates into that todo's brief): create the batch/todo folder, transcribe the
request as a `prompt.md` brief, then conclude
with the normal record — `ai_completed.md`/`ai_failed.md`, or `ai_progress.md` if
still in flight — plus a `## Thinking` section capturing the reasoning and
decisions that would otherwise evaporate with the chat. Nothing project-changing
happens off the books.

**Wiki.** Six mandated pages in `knowledge/wiki/` (overview, stack, architecture,
conventions, workflows, glossary). Their absence is the signal: an agent MUST build
them (loop phase 9) before doing todo work.

**Memories.** The moment work stumbles on something non-obvious that cost time,
the agent writes a memory — a `Guardrail`, `Gotcha`, `Decision` or `Guide` in
`knowledge/memories/`, its one-line `description` saying when it applies and its
`sources` saying where it was learned — and records it. Guardrails that stop future
time-wasting.

**Features + links.** `knowledge/features/` registers every capability as a folder
`FEAT-NNNN-<slug>/` — you write `feature.md` (its `feature-status`, area, tags, the code it
`touches`, and `depends-on`/`supersedes`/`conflicts-with` relations), and `work.md` (every todo,
record and commit that built it) plus `tests.md` (every human test round and its
verdict) are generated beside it. Before anything new is designed, the registry is
searched — `novadev features --touching src/auth` answers "what already owns this
code?" — so duplicates and conflicts get caught at proposal time rather than in review.
`novadev features --hubs` lists the features that lean on each hub (see *Placement*).

Records and features are cross-linked, and the graph is maintainable because each
edge has **one authored direction and one derived direction**: the record names
its feature (`**Feature:** FEAT-0007`, `**Commits:** abc1234`), and
`novadev links --fix` regenerates the feature's `work.md` and `tests.md`
from it, and `novadev sync` the registry's `index.md`. Nothing is written twice, so backlinks cannot
rot. All references are **stable IDs, never relative paths** (`FEAT-0007`,
`2026-08-24_1/01-magic-link`) — archiving moves todo folders, and paths would
break where IDs keep resolving. `novadev links` validates the whole graph;
`novadev doctor` includes it.

## The loop

The playbook for the work itself is `.novadev/skills/novadev-work.md`, and it defines
a single loop the agent runs for every round of work:

```
0 ORIENT   load knowledge/index.md, then the wiki, memories and features it maps; the queue —
           a paused or abandoned batch in it is where the session most likely continues
1 INTAKE   any chat request that changes the repo becomes a todo, before work starts
2 PLAN     batch waves + decisions up front; pre-flight new capabilities for duplicates;
           name the unit that will own a change to a hub
3 WORK     take the batch's lock (`novadev work start`), then do it by the project's own
           conventions, writing a waypoint whenever the work moves
4 RECORD   ai_completed / ai_failed / ai_progress, with **Feature:**, **Commits:** and
           a ## Placement section
5 VERIFY   what an agent cannot check → a totest task + the ai_needstest gate
6 REVIEW   the human left results → judge them, close the gate, file follow-ups
7 REGISTER feature status, progress, touches — recorded with `novadev knowledge log`
8 REMEMBER memories for what cost real time — recorded; postponed for what is blocked
9 DOCUMENT the wiki, if reality moved — recorded
10 CLOSE   `novadev sync`, then `novadev work stop` — or `/novadev-pause` when work remains
```

`novadev sync` is the close-out and the engine: it runs the project's metrics command
(when one is set), regenerates every derived file, archives finished batches and reviewed
test rounds, validates the tree, the link graph and the knowledge bundle, and prints two
lists — **NEXT ACTIONS** (the agent's) and **WAITING ON THE HUMAN**. The agent works its list and re-runs
until it reports clean:

```
$ novadev sync
derived: regenerated 3 file(s)

NEXT ACTIONS — you (1):
  → REVIEW totest/FEAT-0001-login — the human left results (results.md); judge them,
    close the gate, file follow-ups (loop phase 6)

WAITING ON THE HUMAN (1):
  ⧗ totest/FEAT-0002-export — 3 scenario(s) to walk; write what happens into its test-results/
```

**You write todo briefs and walk the tests only a person can walk. That is the whole
job.** No command to remember, no skill to pick, no archive step to run — if
something needs doing and an agent can do it, `sync` says so and the agent does it.

## Work in progress — the lock, waypoints and pauses

Is a work cycle on? Which batch, who is on it, where did they get to — and if the session
died, or you said "pause" last night, where exactly does the next one pick up? novadev
answers that from one file: **a batch in work carries `todos/<batch>/working.md`, its
lock.** An agent writes it when it starts on the batch, adds a waypoint as the work moves,
and either releases it when the round is over or pauses it. Like everything in `.novadev/`
it is tracked, so a pause is development history, and a session on another machine finds it
where it was left.

```sh
novadev work start 2026-10-24_1 --agent claude-code/claude-opus-5-5   # take the lock, or resume it
novadev work waypoint 2026-10-24_1 waypoint.json   # { todo?, phase?, note }: where the work is now
novadev work pause 2026-10-24_1 pause.json         # { todo?, phase?, stopped, next, done?, resume?, open? }
novadev work stop 2026-10-24_1                     # the round is over: release it
```

The file is flat frontmatter novadev reads — the state (`working` or `paused`), the holder
(the agent as an OKF actor, the host, the process, the session), when it was taken, the
last heartbeat, the todo and loop phase of the last waypoint — and a markdown trail a
person reads, **newest first**, so the top section is where the work resumes:

```markdown
---
state: paused
agent: claude-code/claude-opus-5-5
host: fil-desktop
pid: 3702151
session: b424d984-bff7-4b80-9486-e4da99d5edd5
started: 2026-10-24T18:02:11+02:00
updated: 2026-10-24T22:49:30+02:00
todo: 02-dark-mode
phase: 3
---

# Working — 2026-10-24_1

## PAUSED — waypoint 4 — 2026-10-24 22:49 · 02-dark-mode · phase 3 WORK

**By:** claude-code/claude-opus-5-5 on fil-desktop

**Tree at the pause:** branch `master`, HEAD `e19b61a` — 2 uncommitted path(s):
- ` M` src/theme.ts
- `??` src/toggle.ts

### Stopped at

In `src/theme.ts`, `applyTheme()` reads the tokens; the toggle in `Header.tsx` is wired but
the body class never flips. `bun test` is green except `theme.test.ts` (2 failures: the toggle).

### Next

1. Check whether `useTheme` is called outside the provider — that is the likely cause.
2. Finish `ai_progress.md` for 02-dark-mode, then `novadev sync`.

### Done

01-fix-login: `ai_completed.md`, commit abc1234. Test task FEAT-0003-login revised (rev 2).

### To resume

`bun install && bun dev`; the theme page is /settings.

### Todos at the pause

- ✓ 01-fix-login — completed
- · 02-dark-mode — open

## Waypoint 3 — 2026-10-24 20:10 · 02-dark-mode · phase 3 WORK

Tokens in src/theme.ts done; wiring the toggle next.
```

**Start** takes the lock and answers in JSON: the batch's todos and their states, and, when
the lock already existed, its last waypoint. A lock that is paused, or whose holder is gone,
is RESUMED — the same session (the same session id, or the same process on the same host)
simply refreshes it. A lock held by a *live* session is refused, naming the holder; `--take`
takes it over when you know that session is gone. A finished batch (`completed.md`) is
refused: a new request gets a new batch. `--agent` is the agent's OKF actor (`human` means
the person git knows); without it the lock says `agent/unknown`.

**Liveness.** On the holder's own host the process decides, when the lock names one: alive
means working, gone means abandoned. Elsewhere the heartbeat decides: a `working` lock
with no waypoint for two hours reads as abandoned. Claude Code names its process and its
session in the shell (`CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`), so an agent there is
identified without doing anything; otherwise the harness is the grandparent of the
`novadev` process, and another harness may pass `--session <id>`.

**Waypoint** adds an entry — the todo, the loop phase, a few lines on what is done and
what is next — and refreshes the heartbeat. The playbook asks for one whenever the work
moves: each todo picked up, each phase entered, each commit. **Pause** is the command half
of `/novadev-pause`: it writes the exhaustive stop — `stopped` (exactly where), `next` (the
steps, in order), `done`, `resume`, `open` — and adds what it can see on its own: the
branch, the last commit, every uncommitted path, and each todo's state at that moment, so
the resumer can tell what moved in between. **Stop** removes the file; it says which todos
are not recorded as finished, because a stop drops the resume point and a pause keeps it.
Payloads are JSON files, never shell arguments, like every other novadev payload.

**A lock is a gate.** While it exists the batch is in work: `novadev sync` never marks it
complete, nothing archives it (`novadev archive <batch>` says so), and `/novadev-file-a-todo`
never files into it — a batch somebody is working is not where a phone's bug report lands.
So the playbook's rule is firm: never end a session on a locked batch without a
`novadev work stop` (the round is over) or a `/novadev-pause` (work remains).

**What you see.** `novadev status` begins with it:

```
in work — 2 batch(es)
  ● 2026-10-24_1 — WORKING: claude-code/claude-opus-5-5 on fil-desktop (process 3702151, alive), last waypoint 5 min ago — at 02-dark-mode · phase 3 WORK: "Tokens in src/theme.ts done; wiring the toggle next."
  ‖ 2026-10-23_2 — PAUSED 2026-10-23 22:49 by claude-code/claude-opus-5-5 — at 03-export · phase 4 RECORD: "The CSV writer is done and tested; ai_completed.md needs its Verification section."
  → a paused batch resumes with `/novadev-work`; it reads the PAUSED section of working.md first
```

A third kind is `✗ … — ABANDONED`: the process is gone, or there has been no waypoint for
two hours. `novadev sync` prints the same block, lists a paused batch under WAITING ON THE
HUMAN (you stopped it; you say when it goes on) and an abandoned one under NEXT ACTIONS
(resume it, or release it). A lock novadev cannot read — a merge conflict, a broken header
— is a problem for `sync`, `sync --check` and `doctor`; `novadev work stop` removes it
anyway, because releasing it is what you asked for. `doctor` also notes a lock whose last
waypoint names a todo the batch does not have.

## Knowledge — an Open Knowledge Format bundle

Knowledge rots when nobody can tell a fresh fact from an old guess. novadev keeps the
project's knowledge as infrastructure instead: versioned, typed, validated on every
`novadev sync`, and honest about how far each piece can be trusted.

`.novadev/knowledge/` is an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format)
(OKF 0.2) bundle — the open, vendor-neutral format Google Cloud published in 2026 for
knowledge that people and agents maintain together: a folder of markdown files with YAML
frontmatter. novadev deploys it on day 0 and keeps it conformant, so anything that reads OKF
— an agent loading files into context, a search index, an OKF graph viewer — can read the
project, and the project's knowledge never depends on novadev to stay readable.

```
knowledge/
  index.md     derived: okf_version, then the load-first map — wiki pages, memories, features, log
  log.md       every change, newest day first
  wiki/        index.md + overview.md, stack.md, architecture.md, conventions.md, workflows.md, glossary.md
  memories/    index.md + one file per lesson
  features/    index.md + FEAT-NNNN-<slug>/ { feature.md, work.md, tests.md }
  <yours>/     index.md + concepts of any type — a folder the project adds, at any depth
```

**One concept per file.** Every markdown file in the bundle except `index.md` and `log.md` is
a *concept*; its path is its identity. It opens with frontmatter:

```markdown
---
type: Gotcha
title: bun test -t takes a JavaScript regular expression
description: When filtering tests by name — write a|b, never a\|b, which runs nothing.
tags: [testing, bun]
created: 2026-10-03
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T14:05:00+02:00 }
verified:
  - { by: human:filipp-protsenko, at: 2026-10-11T10:00:00+02:00 }
stale_after: 2027-04-09T10:00:00+02:00
sources:
  - id: found
    resource: todo:2026-10-03_1/02-filter
    title: The mutation check that passed with zero tests
---
```

OKF asks only for `type`. novadev asks more of every hand-written concept: a `title`, a
one-line `description` (the derived indexes show it, so an agent decides from one line
whether to open a file), and a `generated` stamp — who wrote the current content, in OKF's
actor form (`human:<id>`, `<tool>/<model>`, `process:<id>`), and when, as an ISO 8601
timestamp with its offset. The types are fixed per folder: `Wiki Page` in `wiki/`;
`Guardrail`, `Gotcha`, `Decision` or `Guide` in `memories/`; `Feature` for `feature.md`
(its OKF `status` — draft, stable, deprecated — is derived from `feature-status`). A folder
the project adds may hold any type (see *Folders the project adds*).

**Trust and freshness are in the file.** `verified` lists who re-checked a concept, one
event per actor: none makes it *unverified*, agents or processes only *machine-confirmed*,
a person *human-reviewed*. `stale_after` says when it is due for a re-check. novadev sets it
each time a concept is recorded, from the review days in `novadev.json` for the top-level
folder the concept sits in:

```json
"knowledge": {
  "reviewDays": { "wiki": 90, "memories": 180, "features": 365, "references": null, "*": 180 }
}
```

Any top-level folder may have its days: novadev's three, or one the project adds. `"*"`
gives its days to every concept that no entry names, the concepts at the bundle root too.
A folder set to `null` is never due, whatever `"*"` says: novadev writes no date there, and
removes one it finds. Days are whole numbers, 1 to 36500. Without `"*"`, a folder that is not
named gets no date, and no `"knowledge"` at all means no dates. `novadev sync` lists what is
past its date. A setting novadev cannot read is a problem in `novadev sync`, and
`novadev knowledge log` records nothing until `"reviewDays"` can be read: it would date
nothing, and remove the dates already written. A mistake in `"folders"` never stops it.

`sources` says what a concept was drawn from — a todo (`todo:<batch>/<todo>`, wherever the
archive moved it), a commit (`commit:<hash>`), a file or folder of the project
(`repo:<path>`), a URL — and sync checks the todos exist and tells you when a `repo:` path is
gone, because the concept may describe code that moved.

**Code that moved on.** A `repo:` source also tells sync when a concept may be out of date.
For each one, `novadev sync` asks git for the newest commit that changed the path. When that
commit is dated after the day the concept was last written or verified, the concept is a
NEXT ACTION: "its source repo:src/auth.ts changed on 2026-10-12, after the concept was last
checked (2026-10-01)" — re-check it against the code, then record a `verify` if it still
holds, or an `update`. Whole days are compared, each in its own offset: a round commits its
code after it records the knowledge, on the same day, and that never counts. Git is asked in
the folder of the path (a symbolic link is followed first), so the repository that holds it
answers — even one nested inside the project that the project's own repository ignores, like
the clones a super-repo keeps under `repos/`. Each path is asked about once per run, and only
back to the day of the oldest check.

Commit dates decide, so know what they say:

- Only the first-parent line counts: a merge is dated the day it was made, so a side branch's
  change shows up on the day it was merged. A fast-forward pull keeps the dates the commits
  were made on: what someone else committed before your last check, and you pulled after it,
  does not count.
- A concept that cites code not committed yet is checked again once that code is committed
  on a later day: it shows as drifted then, and a `verify` settles it.
- A folder source drifts with any file in it, so a concept should cite the files it really
  describes. A folder that holds only other repositories (`repo:repos`) never drifts: no
  repository tracks it.
- A path that is gone is reported as gone, and a path inside `.novadev/` is never asked about
  (every round commits there; `novadev doctor` notes it — cite a todo as
  `todo:<batch>/<todo>`, a concept by its relative path). A deprecated concept is never
  asked about, and a shallow clone's oldest commit does not count (its parent was not
  fetched, so it seems to add every file).

Five are listed, then a count; `novadev knowledge --drifted` lists them all, with every
source that changed. Like a stale concept, it never fails `novadev sync --check`.

**Folders the project adds.** A folder beside `wiki/`, `memories/` and `features/` may hold
concepts of any type, at any depth, and gets a derived `index.md` of its own. The root map
shows it as one line, so give that line a meaning: say what the folder holds, and an agent
can decide from the map whether to open it. `"folders"` sits beside `"reviewDays"`, in the
same `"knowledge"` — keep both:

```json
"knowledge": {
  "reviewDays": { "wiki": 90, "memories": 180, "features": 365, "planner": 90 },
  "folders": {
    "planner": "What a planner user can do, stage by stage.",
    "references/tutorials": "Step-by-step guides from the vendors."
  }
}
```

The map then reads `* [planner](planner/index.md) - What a planner user can do, stage by
stage. (12 concepts)`, and a folder with no line keeps `- 12 concepts`. A folder inside
another is described by its path, in the index of the folder above it. The folders
`"folders"` names come first, in its order, then the others by name; a folder named like a
whole number (`2026`) comes before them all, in number order, because that is how a JSON
object keeps such keys. A description is one line of text; novadev writes the lines of its
own three folders itself. `novadev doctor` notes a folder that `"reviewDays"` or `"folders"`
names but that holds no concept — one still to come, or a typo (novadev's own three may
wait for their first concept) — and a `"knowledge"` with no `"reviewDays"` at all, which
dates nothing: write `"reviewDays": null` to mean it.

**Every change is recorded.** A change is two writes — the stamps in the concept, and an
entry in `log.md` — and one command makes both, for a whole batch of events or for none of
them:

```sh
novadev knowledge log events.json
```

```json
{ "events": [
  { "path": "wiki/architecture.md", "event": "update", "by": "claude-code/claude-opus-5-5",
    "note": "The kit registry moved out of the Workbench.", "ref": "2026-10-11_1/01-kits" },
  { "path": "memories/bun-test-t-is-a-regex.md", "event": "verify", "by": "human",
    "note": "The human re-ran the example." }
] }
```

`create` and `update` stamp `generated`; `verify` adds a `verified` event; `deprecate` sets
`status: deprecated` (a feature's `feature-status` too); `remove` deletes the file — never a
feature, never a page of the wiki's set. Each moves `stale_after` by the folder's review
days (a deprecated concept has none), and each appends a `**Creation**`, `**Update**`,
`**Verification**`, `**Deprecation**` or `**Removal**` line under today's date in `log.md`,
with the note, the actor and the todo. An entry is about the concept its first link names;
a note may link others. `"by": "human"` takes the person's id from git's `user.name`
(`human:filipp-protsenko`). The payload is a JSON file because a note is prose, and a
backtick in a shell argument runs a command. Every file is staged first and replaced only
when all of them are written, so a refused or failed call changes nothing. The answer is
JSON too.

**What `novadev sync` checks.** That every file in the bundle is a valid OKF concept with
the keys above; that `index.md` files are current (it rewrites them, and each feature's
derived `status`); and that the log knows every change — a concept whose `generated` or
`verified` day is newer than its newest log entry is a problem, and so is a concept that is
gone while the log still lists it as current. Changes made on or before the day of the log's
`**Initialization**` entry are covered by it. As NEXT ACTIONS it lists the concepts past
`stale_after` (five, then a count), the concepts whose `repo:` sources changed after they
were last checked (five, then a count), a concept changed since the last commit whose
`generated` stamp did not move, stamps changed since the last commit with no new log entry
(a hand-written stamp claims a check nobody recorded), a concept deleted since the last
commit without a removal, and a `repo:` source that is gone. An `index.md` sync wrote for a
folder that has no concepts left is removed. `novadev sync --check` fails on the problems, as on any.

**Links.** Concepts link to each other with plain relative markdown links — the bundle is a
graph as well as a tree — and cite work only by stable id in `sources`, because todos move
into the archive. A relative link that reaches nothing — a concept not written yet, or code
that moved — is reported by `novadev doctor` as a note: OKF allows links to knowledge not
yet written.

## Metrics and the debt budget

novadev can watch the numbers a project measures about itself: how much known debt it
carries, and how big its largest files or modules ("hubs") are. It does this without knowing
anything about the stack. You give it ONE command, and it reads the JSON that command prints.
Both settings live in `.novadev/novadev.json`, and both are off (`null`) until you set them:

```json
{
  "metrics": "bun scripts/novadev-metrics.ts",
  "debtBudget": { "maxKnown": 230 }
}
```

The command runs from the project root. It must print ONE JSON object on stdout and nothing
else. Send logs to stderr.

```json
{
  "debt": { "known": 230, "new": 0 },
  "hubs": [
    { "name": "Workbench", "measure": 11019, "over": ["loc", "publicVerbs"], "path": "src/editor/workbench/" }
  ]
}
```

| Field | Meaning |
|---|---|
| `debt.known` | findings the project has accepted as known debt — a whole number |
| `debt.new` | optional: findings nobody has accepted yet |
| `hubs[].name` | the hub's name; unique, because changes are compared by name |
| `hubs[].measure` | its size, in the project's own unit (lines, members, …) |
| `hubs[].over` | optional: the budgets it is over, e.g. `["loc"]` |
| `hubs[].path` | optional: the path of its file or folder, inside the project and relative to its root — the placement check uses it (see *Placement*) |

`debt` and `hubs` are both optional, but at least one must be there. Other keys are ignored.
Names, `over` entries and paths must each be one line of text. A path printed with
backslashes is stored with `/`, and `./` parts are dropped, so Windows and Linux give the same
snapshot. An absolute path is refused, because it would differ from one machine to the next,
and so is a path with `..`, because it would leave the project.

**Every `novadev sync`** runs the command and stores the result in
`.novadev/metrics/latest.json`. The file is tracked, so each commit shows how the numbers
moved. sync compares the numbers with the snapshot of the LAST COMMIT, so it shows everything
that changed in this round:

```
$ novadev sync
metrics: running `bun scripts/novadev-metrics.ts` …
metrics: snapshot updated — .novadev/metrics/latest.json
  since the last commit:
  ↑ known debt 230 → 238 (+8) — explained in 2026-10-01_1/01-kits
  ↓ hub Stage3D 3,304 → 3,280 (-24)
  ↑ hub Workbench 11,019 → 11,140 (+121) — explained in 2026-10-01_1/01-kits
  debt budget raised 230 → 238 by 2026-10-01_1/01-kits
  debt budget: known debt 238 of 238 ✓
```

What GREW is a NEXT ACTION, and it stays on the list on every sync until a record explains it
in a `## Debt` section, in lines this round wrote — lines the last commit does not hold. A
section explains the debt when it says why: a bare "None.", "No new debt." or "n/a" explains
nothing, and neither does a raise line with no reason. A hub is explained when the section
names it. So an old record that only gets a **Commits:** line or a note never explains new
growth. What shrank is only reported. Without git (or before the first snapshot is
committed), sync compares with the stored snapshot, any reason in a `## Debt` section counts,
and a change is listed once.

A missing or failing command — a non-zero exit, a timeout, output that is not the agreed
JSON — is a warning, never a sync failure. The stored snapshot then stays as it was, and
the checks use it; when none is stored (it was deleted after a merge conflict, say), they use
the last commit's. Output that stops printing `debt` while the snapshot has a count — or, with
a `debtBudget`, while the last commit's snapshot has one — is treated the same way: novadev
keeps the count and checks the budget against it. The command runs in a process group of its
own: on a timeout, novadev stops it and every process it started, and so does Ctrl+C. The
timeout is for the command itself. When it exits but leaves a process behind that keeps its
output open, novadev waits 2 seconds, reads the output, and stops that process. (A process
that leaves the group on purpose, like a daemon, is out of reach — and on Windows, so is a
process whose parent has already exited.)

`novadev sync --check` writes nothing. It is the gate for hooks and CI: it fails on any
problem, on a stale derived file — the snapshot and the wiki block included, each one named —
on a snapshot nobody can read, on a budget raise that plain `sync` has not written yet, on a
debt budget it cannot check, and on known debt over its budget.

**The debt budget** is the most known debt the project accepts. Debt can only go above it
on purpose. When `debt.known` is over `maxKnown`, `novadev sync` lists it as a NEXT ACTION,
and `novadev sync --check` fails. There are two ways out:
reduce the debt, or raise the budget in this round's record of the work that caused it, with
a reason. That record is `ai_completed.md`, or `ai_progress.md` / `ai_failed.md` when the
round ends with the work still in flight or set aside:

```markdown
## Debt
**Raise:** 230 → 238
The kit registry adds eight known findings. Todo 19 removes them again.
```

The raise line is `**Raise:** <the budget now> → <the new budget>`, in whole numbers
(`1,238` is fine; `1 238` and `1.238` are not, because they read differently by country).
The reason may also follow the numbers on the same line. The line may be a list item
(`- **Raise:** …`, `1. **Raise:** …`). A raise line in a quote (`> **Raise:** …`) is never
read, because a quote may hold someone else's raise; one inside an HTML comment or a code
block does not count at all. A record has at most one raise line: when a raise falls short,
sync tells you to change its numbers, not to add a second line. In a project with a
`debtBudget`, a raise line that sync cannot read for certain is a problem, and it is not
applied. Without a `debtBudget`, a `## Debt` section is free text.

Plain `sync` writes the new value into `debtBudget.maxKnown` and adds the raise to
`debtBudget.raises`: the record, its two numbers, and the date. Keep that list. Until sync has
written the raise, `sync --check` fails: run `novadev sync`, then commit `novadev.json` with
the record. Four rules keep the budget honest:

- **A raise counts only in the round it is written in.** With git, the round is everything
  since the last commit. A raise line the last commit already holds — the same two numbers,
  in any of the todo's records — is from an earlier round, even when other lines of the
  record changed since (a **Commits:** line, a note, `ai_progress.md` becoming
  `ai_completed.md`). Once a raise is committed, sync no longer reads it. Growth in a later
  round needs a raise in that round's own record. Without git, sync cannot tell one round
  from the next: a raise that is not needed when sync first sees it is used up then, and the
  list notes it with `"applied"` equal to the budget it found.
- **A raise starts at the current budget.** One written against an older budget is not
  applied, and sync says so — a raise never overrides a change someone made since.
- **A raise stops at the measured debt.** `**Raise:** 230 → 100000` with 238 known findings
  sets 238, and the list notes `"applied": 238`. One record cannot switch the gate off.
- **A raise counts once.** The list knows it by its record and its two numbers, so an old
  record never raises a budget that someone lowered later. Edit the numbers, and it is a new
  request.

Sync reads raises only from records still in `todos/`, never from the archive. The budget
goes down only by hand: when known debt is under the budget, sync lists a NEXT ACTION to
lower `maxKnown` to it, so the gain is kept. Lowering it by hand is always allowed.

**The wiki budgets block.** sync also keeps a generated block in `wiki/architecture.md`,
between `<!-- novadev:budgets:begin -->` and `<!-- novadev:budgets:end -->`: the known debt,
the budget, and the hub table. The first time, it adds a `## Budgets` section at the end of
the page. You can move the block anywhere in the page; sync rewrites it where it is. Only
marker LINES count — each marker on a line of its own, outside code — so the page can quote
the markers in a sentence or a code example. Broken markers (one missing, or two of one) are
a problem, and sync does not touch the page until they are repaired. So is a code fence that
is never closed: everything after it is code, the block too. Sync then names the line where
the fence opens and leaves the page alone, instead of adding the block again on every run.

Two more settings, both optional:

| Setting | Default | |
|---|---|---|
| `metricsWikiPage` | `"architecture.md"` | the wiki page that carries the block; `false` for no block |
| `metricsTimeoutSeconds` | `300` | how long the command may run |

`novadev doctor` checks the settings, the snapshot, the raises and the block, and never runs
the command. On a merge conflict in `latest.json`, keep either side, or delete the file, and
run `novadev sync`: it writes the file again once the command works. On a merge conflict in
`novadev.json`, keep the higher `maxKnown` and the raises of both sides, then run
`novadev sync`. `novadev deploy` and `novadev migrate-repo` refuse a `novadev.json` they
cannot read, so its settings are never replaced by fresh ones. `novadev deploy` writes a
README into `metrics/`, unless the folder already holds one of the project's own (a README
without the "managed by `novadev deploy`" line); then it keeps that one.

## Placement — where new code goes

Hubs grow when every change lands on them by default. So the loop asks "where does this go?"
twice. In the PLAN phase, before any code is written: does this todo touch a hub? Then the agent
names the smaller unit that will own the change. And in the record, after the work: every record
has a `## Placement` section.

```markdown
## Placement
- the kit registry → `src/kits/registry.ts` (new, 140 lines). Workbench 11,019 → 10,880:
  the Workbench only calls the registry now.
```

For each new unit of state or behaviour, the section names its owner, its size before → after
(in lines, or the measure the project uses), and why it is not on a hub. A record that adds
nothing new says "nothing new placed".

**The check.** `novadev doctor` and `novadev sync` report a problem when a record changed a hub
and its `## Placement` section is missing or empty; `novadev sync --check` then fails. A record
changed a hub when a commit on its `**Commits:**` line changed a file inside a hub path. novadev
asks git which files each commit changed. A move counts its old path and its new path, and a
merge counts what it brought in over its first parent. A commit that several records name
counts for each of them. A commit git does not know (another repository's, say) is skipped. So
the check sees a record once its `**Commits:**` line is written: run `novadev sync` again after
you add it, as the playbook says. A `**Placement:**` line elsewhere in the record does not
count: the section is a `## Placement` heading of its own.

**Hub paths** come from the metrics snapshot: the `path` of each hub. When the snapshot names no
hub path — there is no `metrics` command, or its hubs have no paths — they come from `hubs` in
`novadev.json`:

```json
"hubs": ["src/editor/workbench/", "src/editor/stage3d.ts"]
```

A hub path is a file or a folder, relative to the project root, without `..`. A changed file
counts when it is the hub path, or is inside it. `novadev sync` lists a hub path that is not in
the project as a NEXT ACTION, because a typo there switches the check off for that hub.

**Which records.** The work records (`ai_completed.md`, `ai_progress.md`, `ai_failed.md`) of
todos still in `todos/`, dated (`**Date:**`) on or after `placementSince` in `novadev.json`.
A record whose `**Date:**` line names no day is checked too. Archived records are not checked. `migrate-repo` sets `placementSince` to the day it runs, and a
first `novadev deploy` to the day of the deploy, so records written before the section existed
are left alone. `null` checks every record in `todos/`. If you turn on hub paths later, and the
records of the days in between should not be checked, set `placementSince` to that later day.

**CI needs the history.** The check asks git about the commits that records name. A shallow
clone (many CI systems fetch only the newest commit) does not have them, and the check then
skips them. Fetch the full history where `novadev sync --check` runs (for GitHub Actions:
`fetch-depth: 0`).

**Which features lean on a hub.** `novadev features --hubs` lists, for each hub path, the
features whose `touches:` name it — the same matching as `--touching`. The hub with the most
features comes first. It is the worklist for moving code off a hub, one feature at a time:

```
$ novadev features --hubs
features --hubs — 2 hub paths (from the metrics snapshot); features that touch them: 4 of 5

Workbench (src/editor/workbench/) — 3 features
  ● FEAT-0003  [shipped]  Copy and paste  (hub paths: 1 of 2)
  ◐ FEAT-0007  [in-progress]  Selection filter  (hub paths: 1 of 1)  ← only hub paths
  ● FEAT-0011  [shipped]  Undo history  (hub paths: 0 of 2; its path src/editor/ holds this hub)

Stage3D (src/editor/stage3d.ts) — 2 features
  ● FEAT-0011  [shipped]  Undo history  (hub paths: 0 of 2; its path src/editor/ holds this hub)
  ● FEAT-0012  [shipped]  Camera controls  (hub paths: 1 of 2)

← only hub paths: every path in the feature's `touches:` is on a hub. A search by folder
  finds it only together with all the other features on that hub. When its code moves off
  the hub, add the new path to its `touches:`, and remove the hub path once none of its
  code is left there.
```

Each line counts the paths in the feature's `touches:` that are on a hub: a hub path, or a path
inside one. A feature whose every path is on a hub is marked "only hub paths": it has no folder
of its own. A feature that is listed only because one of its paths holds the hub (a folder above
it) says so, because none of its code needs to be in the hub. A feature leaves a hub's list once
no path in its `touches:` is in the hub or holds it. `--status`, `--area`, `--touching` and
search words narrow the list, and `--touching <hub path>` shows that one hub. The hub paths are
the ones the placement check uses: the stored snapshot's, or else `hubs` in `novadev.json`. The
command only reads files. It never runs the metrics command. With no hub paths, it says how to
set them and exits with 1.

## The four companion playbooks

The loop above is what an agent runs. Four more playbooks cover the moments when YOU
start the conversation — or end it — and each deploys as a slash command of the same name:

| You say | Playbook | What it does |
|---|---|---|
| "file this", a bug from your phone, "we should…" | **`/novadev-file-a-todo`** | turns what you just said into real todo folders — your words verbatim, your screenshots copied in — shows you the split, and waits for a yes before writing |
| "what should I test?" | **`/novadev-what-to-test`** | shows the queue, helps you pick, walks you through one scenario, and writes the verdict down |
| "I tested the selection thing — 3 broke, here is a shot" | **`/novadev-test-review`** | takes a whole round of testing you already did, in any order and any words, and files it as a formed review in that task's `test-results/` with every file attached |
| "pause", "stop here", "let's continue tomorrow" | **`/novadev-pause`** | records the work that landed, then writes into the batch's lock exactly where things stopped — the step, the state of the tree, what is next, how to resume — and offers a commit of the work in progress; the next `/novadev-work` resumes from it |

They share the loop's mechanics rather than re-deriving them, through three commands
that exist for exactly this:

```sh
novadev file-todo plan                  # which batch a chat request lands in, and the next number
novadev file-todo file payload.json     # write the folders, the briefs, and the attachments

novadev test-result tasks [query]       # resolve "16" / "the selection one" against the real queue
novadev test-result write payload.json  # one scenario's verdict → scenario-<N>.txt   (APPENDS)
novadev test-result review payload.json # a whole round → review.md                   (APPENDS)

novadev work pause <batch> payload.json # the pause record, newest entry of the batch's lock
```

All take a JSON **file**, because the content is a person's own multi-line words and
quoting that through a shell is how it gets mangled; all answer in JSON, so the agent
reads the outcome instead of guessing. The rules they own are the ones prose gets
wrong: which batch to reuse, the next `NN`, defanging a `**Feature:**` line quoted
from an old record (an unknown id there is a hard `sync` failure), what a pause must
say and what the command captures on its own, and above all **appending** — a second
walk of a scenario must never erase the first.

## Agent integration (canonical + adapters)

The playbooks are plain markdown any agent can follow. `novadev deploy`
additionally generates thin native adapters that just route to them:

- `.claude/skills/novadev-{work,file-a-todo,what-to-test,test-review,pause}/SKILL.md` —
  the five Claude Code skills. They share the `novadev-` prefix on purpose: typing
  `/novadev` offers the whole set
- `.cursor/rules/novadev.mdc` — Cursor always-applied rule
- managed marker sections in `AGENTS.md` and `CLAUDE.md` (created if missing;
  re-deploy updates between the markers without touching your text) — they send every
  agent to `.novadev/knowledge/index.md` first

Everything under `.novadev/` is meant to be **committed**. Only transient junk
should be git-ignored.
