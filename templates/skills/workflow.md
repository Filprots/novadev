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
  todos/       task batches the human authored, waiting to be executed
  archive/     finished batches, moved here by year
  postponed/   deferred work with an explicit wake-up trigger
  sparks/      raw unshaped ideas — not yet tasks
  wiki/        the project pre-context every agent loads before working
  memories/    hard-won gotchas, guides, and guardrails — read before, write during
  skills/      these playbooks (managed by `novadev deploy`)
```

## Vocabulary

- **Batch** — one folder `todos/YYYY-MM-DD_N/` (`N` = same-day sequence number,
  1-based). Created by the human (or via `novadev new`).
- **Todo** — one folder inside a batch, e.g. `todos/2026-08-16_1/fix-login/`.
  Numbered prefixes (`01-…`, `02-…`) express intended order; a `00-program` todo,
  when present, is the batch's owner plan — read it first.
- **Brief** — the human's task input inside a todo folder: one or more `.txt`/`.md`
  files plus optional screenshots or other attachments.
- **Record** — the file YOU write into the todo folder when work concludes
  (`ai_completed.md` / `ai_failed.md`) or is long-running (`ai_progress.md`).

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

## Executing a todo

1. Read the entire brief (all files, look at the screenshots).
2. Do the work by the project's own standards (the wiki's conventions page).
3. **Write the record** in the todo folder as the work concludes — this is part of
   doing the todo, not an optional extra:

### `ai_completed.md` — implemented and verified

```markdown
# ai_completed — <todo slug>

**Date:** <absolute date>

## Prompt
<quote or tightly summarize the brief>

## What I did
<the change, key files touched, commit hash(es) if committed>

## Verification
<tests / typecheck / build / manual checks that confirm it — actual results>

## Notes
<follow-ups, known limitations, cross-links to related todos>
```

### `ai_failed.md` — did NOT land as a standalone completion

State **which case** and why:
- *deferred / not done* — out of scope this run; what remains and the plan.
- *cancelled* — the human dropped or changed it; what was decided.
- *merged into another todo* — name the todo it folded into and why.
- *blocked / failed* — what blocked it or why the attempt failed.

### `ai_progress.md` — long-running work spanning sessions

A dated log: what is done so far, what is next, how to resume. When the work finally
concludes, replace it with `ai_completed.md` or `ai_failed.md`.

### Record conventions

- **One record per todo folder.** If status changes later, UPDATE — a deferred item
  that lands flips `ai_failed.md` → `ai_completed.md` (delete the stale one).
- Keep records short and factual; they are a log, not documentation.
- A later todo that refines an earlier one: cross-link both records.
- Never claim verification you did not run. If something is skipped, failing, or
  unverified, say so in the record.

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
2. **Commit** the `.novadev/` record/memory/wiki changes alongside the code.
3. Archiving: when every todo in a batch has a terminal record, the batch may move
   to `archive/<year>/` — `novadev archive --done` does this mechanically.

## Management playbooks (invoke when asked, or when the trigger fits)

| Playbook | When |
|---|---|
| `wiki-init.md` | wiki missing/empty — create it before any todo work |
| `wiki-update.md` | landed work changed reality; human asks to refresh |
| `wiki-compact.md` | wiki grew fat/redundant; INDEX no longer skimmable |
| `memories-review.md` | memories suspected stale; periodic hygiene |
| `debt-scan.md` | human asks to find tech debt and turn it into todos |
