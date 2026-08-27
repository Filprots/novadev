# novadev workflow — the core rule (always applied)

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy.
     Project-specific rules belong in the wiki (conventions page), not here. -->

This project uses **novadev**, a structured development system living in `.novadev/`.
Everything in it is **tracked in git** — task briefs, completion records, the wiki,
memories — so the development history travels with the repository. Commit your
`.novadev/` changes together with the work they describe.

This playbook is the always-applied rule for ANY agent doing development work here.
It is agent-, framework-, and language-agnostic: it only prescribes structure.

## The folder map

```
.novadev/
  todos/       task batches waiting to be executed — human-authored, or filed by YOU from chat requests
  archive/     finished batches, moved here by year
  postponed/   deferred work with an explicit wake-up trigger
  sparks/      raw unshaped ideas — not yet tasks
  wiki/        the project pre-context every agent loads before working
  memories/    hard-won gotchas, guides, and guardrails — read before, write during
  features/    the registry of what this software DOES — one FEAT-NNNN file per capability
  totest/      test tasks waiting on a HUMAN — what you could not verify yourself
  skills/      these playbooks (managed by `novadev deploy`)
```

## Vocabulary

- **Batch** — one folder `todos/YYYY-MM-DD_N/` (`N` = same-day sequence number,
  1-based). Created by the human (or via `novadev new`), or by YOU when filing
  chat-initiated work.
- **Todo** — one folder inside a batch, e.g. `todos/2026-08-16_1/fix-login/`.
  Numbered prefixes (`01-…`, `02-…`) express intended order; a `00-program` todo,
  when present, is the batch's owner plan — read it first.
- **Brief** — the task input inside a todo folder: one or more `.txt`/`.md`
  files plus optional screenshots or other attachments. Usually human-authored;
  for a chat-initiated todo it is the `prompt.md` YOU transcribe from the chat.
- **Record** — the file YOU write into the todo folder when work concludes
  (`ai_completed.md` / `ai_failed.md`) or is long-running (`ai_progress.md`).
- **Test task** — ONE living folder in `totest/` per feature, named after it
  (`FEAT-0007-magic-link/`), holding a stepped `test-plan.md` and a `test-results/`
  inbox. New work on that feature REVISES the existing plan and opens a new round —
  never a second folder, and never a scenario left describing behaviour that the
  change removed.
- **Gate** — `ai_needstest.md` on the todo: the work landed but a person must still
  confirm it. It is NOT terminal; the batch cannot archive while it is open. The
  human's `/novadev-review-tests` replaces it with `ai_confirmed.md`.
- **Chat-initiated todo** — a todo YOU create when the human asks for work in the
  chat that no open todo covers (see "Chat-initiated work" below).
- **Feature** — one capability of the software, registered as
  `features/FEAT-NNNN-<slug>.md` with a lifecycle status. Todos are the *work*;
  features are the *result* the work accumulates into.
- **Reference** — how the parts link to each other: always a stable ID
  (`FEAT-0007`, `2026-08-24_1/01-magic-link`, a commit hash), never a relative
  path — archiving moves todo folders and would break paths.

## Before ANY substantive work (the pre-context ritual)

1. **Load the wiki.** Read `.novadev/wiki/INDEX.md`, then the pages relevant to your
   task. **If `wiki/INDEX.md` is missing, STOP and create the wiki first** following
   `.novadev/skills/wiki-init.md` — working without pre-context produces wrong work.
2. **Scan memories.** Read `.novadev/memories/INDEX.md` and open every memory whose
   one-liner touches your task area. Memories exist to stop you from repeating past
   time-wasters — ignoring them is a defect.
3. **Scan postponed.** When taking stock of open work (a "what's next?", a new batch,
   or you are about to touch an area a postponed item names), read each
   `.novadev/postponed/*.md` header and report: trigger met → surface it; obsolete →
   recommend deletion; still waiting → say it is parked.
4. **Check the features registry.** Read `.novadev/features/INDEX.md` and open the
   features covering your task's area — they tell you what already exists, what owns
   the code you are about to touch (`novadev features --touching <path>`), and what
   must not be broken. **If `features/INDEX.md` is missing, create the registry
   first** per `.novadev/skills/feature-init.md`. Before designing a NEW capability,
   run the full pre-flight in `.novadev/skills/feature-check.md` — building a
   duplicate or a conflicting second version is the expensive failure this prevents.

## Batch kickoff (multi-todo batches — the strategic-plan ritual)

When a batch holds SEVERAL todos, do not pick them off one by one blind. First:

1. **Read every brief in the batch** (all files, all screenshots) before starting any.
2. **Build a strategic plan**: group the todos into waves (quick fixes first — they ship
   while the big ones are still being designed), spot cross-todo overlaps (two briefs
   touching one seam get ONE design), and order by dependency, not folder order.
3. **Settle the open decisions with the human up front** — one batched round of concrete
   options (recommend one each), never mid-implementation stalls. Record the answers in
   the batch's `ai_progress.md` header; they govern the whole batch.
4. **Recon before code where the plan needs it**: read the relevant modules (or fan out
   read-only investigations) so every wave starts from exact file/line routes instead of
   guesses. Keep the recon notes — they become the record's evidence.
5. **Keep `ai_progress.md` at the batch root current** (done / remaining / owed) — a
   compaction or session handoff must be able to resume from it alone.

This ritual exists because batches are where scope is won or lost: the 2026-08-21_3
batch (11 todos) shipped in one day precisely because the plan, the user decisions, and
the recon all happened before the first feature commit.

## Executing a todo

1. Read the entire brief (all files, look at the screenshots).
2. Do the work by the project's own standards (the wiki's conventions page).
3. **Write the record** in the todo folder as the work concludes — this is part of
   doing the todo, not an optional extra:

### `ai_completed.md` — implemented and verified

```markdown
# ai_completed — <todo slug>

**Date:** <absolute date>
**Feature:** <FEAT-NNNN, comma-separated if several — or `none — <why>`>
**Commits:** <hashes, comma-separated — omit the line if nothing was committed>

## Prompt
<quote or tightly summarize the brief>

## What I did
<the change, key files touched>

## Verification
<tests / typecheck / build / manual checks that confirm it — actual results>

## Notes
<follow-ups, known limitations, cross-links to related todos (`<batch>/<todo>`)>
```

The `**Feature:**` and `**Commits:**` lines are the **authored** half of the link
graph: `novadev links --fix` reads them and regenerates each feature's `## Work` and
`## Commits` sections from them. Write them on every record — including
`ai_failed.md` and `ai_progress.md` — so the registry can show work in flight and
work that was dropped, not just successes.

### `ai_failed.md` — did NOT land as a standalone completion

State **which case** and why:
- *deferred / not done* — out of scope this run; what remains and the plan.
- *cancelled* — the human dropped or changed it; what was decided.
- *merged into another todo* — name the todo it folded into and why.
- *blocked / failed* — what blocked it or why the attempt failed.

### `ai_progress.md` — long-running work spanning sessions

A dated log: what is done so far, what is next, how to resume. When the work finally
concludes, replace it with `ai_completed.md` or `ai_failed.md`.

### `ai_needstest.md` — landed, but a HUMAN still has to verify it

Write it beside `ai_completed.md` whenever something could not be verified
automatically — how it renders, how it feels, a real device or third-party service,
anything behind credentials you do not hold. It names the `totest/` task holding the
scenarios (`**Test:** FEAT-0007-magic-link`). **Check `novadev totest --all` first:**
if that feature already has a task, revise its plan and open a round
(`novadev totest --round <id>`) instead of filing a second one. Full rules:
`.novadev/skills/test-plan.md`.

**This is not optional politeness.** Saying "I could not test X, please check it" in
chat loses the hand-off the moment the conversation scrolls; the gate does not get
lost. While it exists the todo is NOT terminal and its batch cannot be archived.

### `ai_confirmed.md` — the human tested it and the results were reviewed

Written ONLY by `.novadev/skills/review-tests.md`, when the human explicitly invokes
`/novadev-review-tests`. It replaces `ai_needstest.md` and carries the verdict
(`passed` / `passed-with-followups` / `failed`) plus links to any follow-up todos.
Never write it yourself, and never review your own pending test task — an unreviewed
task is a request for the human's attention, and closing it destroys the only signal
that a person actually looked.

### Record conventions

- **One record per todo folder.** If status changes later, UPDATE — a deferred item
  that lands flips `ai_failed.md` → `ai_completed.md` (delete the stale one).
- Keep records short and factual; they are a log, not documentation.
- A later todo that refines an earlier one: cross-link both records.
- Never claim verification you did not run. If something is skipped, failing, or
  unverified, say so in the record — and if a HUMAN has to check it, file the test
  task and the gate (`ai_needstest.md`) rather than mentioning it in chat.
- **Reference by ID, never by relative path** — `2026-08-24_1/01-magic-link`, not
  `../../todos/…`. Archiving changes folder depth and would break the path.

## Features — register the capability, link the work (mandatory)

Records say what was *done*; the features registry says what the software *has*.
Both are required, and they are joined by the `**Feature:**` line.

1. **Before designing a new capability**, pre-flight it against the registry —
   `.novadev/skills/feature-check.md`. Verdict `drop` or `extend FEAT-NNNN` means
   you do not build a new thing; that is the point.
2. **When the work starts on a new capability**, create its file
   (`novadev features --new <slug>`), status `planned` → `in-progress`.
3. **On the record**, name it: `**Feature:** FEAT-0007` — or `**Feature:** none —
   <why>` for infra chores, dependency bumps, and doc work. Saying "none" out loud
   is required; silence is indistinguishable from forgetting.
4. **When the capability actually works and is verified**, flip the feature to
   `shipped`, append a dated line to its `## Progress`, and refresh `touches:` /
   `tags:` if the code surface or vocabulary moved — those fields are what the next
   `feature-check` searches. Full rules: `.novadev/skills/feature-update.md`.
5. **Never hand-edit** inside `<!-- novadev:work:… -->` / `<!-- novadev:commits:… -->`
   markers, or `features/INDEX.md` — all derived, all regenerated by
   `novadev links --fix`.

## Chat-initiated work — file it as a todo (mandatory)

Todos usually arrive as human-authored briefs. But when the human asks you **in
the chat session** to implement, fix, change, or build something that no open
todo already covers, the request itself IS a todo and MUST be documented as one.
A match against `postponed/` or `sparks/` does NOT exempt the ask — it means the
item's trigger fired and it graduates into the new todo (step 1). Chat
evaporates; the todo folder is the only durable trace. Nothing project-changing
happens off the books.

**Scope.** The rule fires for any chat request whose execution changes the
repository (code, config, docs, assets, dependencies), rewrites its history
(reverts, squashes, release tags), or changes deployed/external state (deploys,
migrations). It does NOT fire for pure questions, explanations, read-only
investigation, clerical commits/pushes of work already recorded in a todo, or
upkeep of `.novadev/` itself — filing or editing todos, postponed items, sparks,
memories, or the wiki on request (there, the file you create or edit IS the
durable trace; never file a todo about filing).

**Before starting the work** — not after; an interrupted session must still
leave a trace:

1. **Check for an existing home first.**
   - Matches a todo with no terminal record yet (open, or carrying
     `ai_progress.md`) → work under THAT todo and update its record; no new
     todo. If the chat adds constraints or decisions beyond the written brief,
     append them to the brief as a dated addendum
     (`**Chat addendum, <YYYY-MM-DD>:** …`).
   - Matches a todo that already has a terminal record — still in `todos/` or
     moved to `archive/` → do NOT reopen or rewrite the old record: file a NEW
     chat-initiated todo and cross-link both records. Exception: an
     `ai_failed.md` marked *deferred* whose remaining work you are now doing —
     that is the status-flip case under Record conventions; update in place.
   - Named in a human batch's `00-program` plan but not yet broken out → the one
     case where you add to a human-authored batch: create the planned
     `NN-<slug>/` there and transcribe the brief.
   - Matches a `postponed/` item → its trigger just fired: fold the item's
     content into the new todo's brief and delete the postponed file.
   - Matches a `sparks/` file → the spark graduates the same way: fold it into
     the brief and delete the spark.
2. **Create the todo.** Reuse the batch YOU created earlier in this conversation
   if it is still in `todos/`; otherwise create the next `todos/YYYY-MM-DD_N/`
   (`N` = highest `N` for today across BOTH `todos/` and `archive/<year>/`,
   plus 1 — a same-day batch already archived still claims its number; `novadev
   new` computes this). Except for the `00-program` breakout above, never add
   todos to a human-authored batch. Inside it, create `NN-<slug>/` (`NN` = next
   number in the batch starting at `01`, arrival order; `00` is reserved for a
   program todo).
3. **Transcribe the brief** as `prompt.md` in the todo folder — the chat request
   made durable:

```markdown
# prompt — <slug>

**Source:** chat-initiated, transcribed by the agent — <YYYY-MM-DD>

## Request
<the human's ask — verbatim where short, tightly faithful where long>

## Context from the conversation
<constraints, clarifications, and decisions the human stated in chat>
```

**When the work concludes**, write the record exactly as for any other todo:
`ai_completed.md` or `ai_failed.md`, or `ai_progress.md` if the work is still in
flight when the session ends. A chat-initiated record carries one EXTRA section,
because the conversation that shaped the work is not saved anywhere else:

```markdown
## Thinking
<the approach and why; alternatives considered and rejected; decisions made
during the conversation and their rationale; dead ends worth not repeating>
```

Several chat requests in one conversation → several todos in the same
conversation batch, each with its own brief and record.

## Auto-writing memories (mandatory, during the work)

Whenever you stumble on something **non-obvious that cost real time or would cost
the next agent time** — a tool quirk, a trap in the stack, a decision with a
non-obvious why, a debugging recipe, a "never do X here" — write a memory
**immediately**, while the context is fresh:

1. Create `.novadev/memories/<short-kebab-slug>.md`:

```markdown
---
title: <one line — the claim itself>
created: <YYYY-MM-DD>
kind: gotcha | guide | decision | guardrail
verified: <YYYY-MM-DD — last date this was confirmed true>
---
<The fact. Then **Why:** it matters. Then **How to apply:** what to actually do.>
```

2. Add a one-line pointer to `.novadev/memories/INDEX.md`:
   `- [title](<slug>.md) — <when it applies>`

Do NOT record what the repo already states (code, wiki, git history) or what only
matters to the current conversation. A memory earns its file by saving future time.

## Postponing work

Work that is real but blocked on a precondition goes to
`.novadev/postponed/<slug>.md` — never silently dropped:

```markdown
---
title: <what it is, one line>
postponed: <YYYY-MM-DD>
do-when: <the concrete TRIGGER that makes it doable>
discard-if: <the condition that makes it OBSOLETE>
---
<what the work is + where it plugs in, enough to act on later>
```

The header is the contract: `do-when` is when it wakes up, `discard-if` is when it
dies. Never let a postponed item rot unread (see the pre-context ritual).

## After the work

1. **Update the wiki** if your change altered what the wiki describes (new module,
   changed workflow, new dependency, moved boundary) — follow
   `.novadev/skills/wiki-update.md`. A wiki that lies is worse than none.
2. **Update the feature** you touched (status, progress line, `touches:`) per
   `.novadev/skills/feature-update.md`.
3. **Regenerate the links**: `novadev links --fix`, then `novadev links` to confirm
   the graph is consistent. `novadev doctor` runs the same checks.
4. **Commit** the `.novadev/` record/memory/wiki/feature changes alongside the code,
   then put the commit hash(es) in the record's `**Commits:**` line and re-run
   `novadev links --fix` (the hash only exists after the commit).
5. **Hand back what you could not verify**: file the `totest/` task and the
   `ai_needstest.md` gate (`.novadev/skills/test-plan.md`), then tell the human
   plainly what is waiting for them. Do not claim a browser/device/visual check you
   did not perform.
6. Archiving: when every todo in a batch has a terminal record, the batch may move
   to `archive/<year>/` — `novadev archive --done` does this mechanically. A todo
   gated by `ai_needstest.md` is deliberately not terminal and holds its batch back
   until the human's review lands. Links keep resolving because they are IDs, not
   paths.

## Management playbooks (invoke when asked, or when the trigger fits)

| Playbook | When |
|---|---|
| `wiki-init.md` | wiki missing/empty — create it before any todo work |
| `wiki-update.md` | landed work changed reality; human asks to refresh |
| `wiki-compact.md` | wiki grew fat/redundant; INDEX no longer skimmable |
| `memories-review.md` | memories suspected stale; periodic hygiene |
| `debt-scan.md` | human asks to find tech debt and turn it into todos |
| `feature-init.md` | `features/INDEX.md` missing — build the registry before feature work |
| `feature-check.md` | a NEW capability is proposed — duplicate/overlap/conflict pre-flight |
| `feature-update.md` | work changed a capability; full registry audit on request |
| `test-plan.md` | work landed that a HUMAN must verify — file the totest task + gate |
| `review-tests.md` | the human ran `/novadev-review-tests` — read their results, close the gate |
| `links-audit.md` | link graph suspect (`novadev links` complains, big rename/merge/archive sweep) |
