# novadev feature-init — create the features registry

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

`.novadev/features/` is the registry of **what this software does**: one file per
feature, carrying its lifecycle status, the code it owns, and links to every todo,
record, and commit that built it. The wiki says how the project is *built*; the
registry says what it *has*, and is the thing you search before proposing anything
new.

**Trigger:** `features/INDEX.md` does not exist (or the folder holds no `FEAT-` files).
Creating it is MANDATORY before feature work — without it, `feature-check.md` cannot
tell you whether the thing you are about to build already exists.

## What counts as a feature

A capability a user (human, caller, or operator) can point at: "magic-link login",
"CSV export", "rate limiting", "dark mode", "the `doctor` command". One feature =
one coherent capability with its own behaviour and its own code surface.

**Not** features: individual bug fixes, refactors, dependency bumps, or internal
helpers with no capability of their own. Those are todos; they attach to the feature
they served. If a change has no feature, its record says `**Feature:** none — <why>`.

Prefer a handful of real capabilities over dozens of fragments. Two "features" that
are always changed together and share a code surface are ONE feature with two
behaviours.

## Reverse-engineer the current feature set (investigate, don't guess)

1. **Read the wiki first** — `overview.md` (capabilities), `architecture.md`
   (module boundaries, which usually map 1:1 to features), `glossary.md` (the
   project's own names for things — use THOSE names, not invented ones).
2. **Walk the code surface**: entry points, routes/commands/handlers, public API,
   UI screens, CLI subcommands, feature flags, config switches. Each is a candidate.
3. **Mine the history**: `.novadev/archive/` records and `todos/` briefs say what was
   actually built and why — and give you the `Work` links for free. Read the git log
   for the same reason.
4. **Confirm each candidate against the code before writing it down.** A registry
   entry for a capability that does not exist is worse than a missing one.

## Write one file per feature

`features/FEAT-NNNN-<kebab-slug>.md`, IDs assigned in the order you create them
(`novadev features --new <slug>` scaffolds the next free ID and the exact skeleton).
IDs are permanent and never reused — links point at them forever.

```markdown
---
id: FEAT-0001
title: <the capability, one line>
status: planned | in-progress | shipped | deprecated
area: <subsystem this belongs to — group features by it>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
tags: <comma-separated search keywords: domain nouns, synonyms someone would grep>
touches: <comma-separated repo paths this feature owns — src/auth/, src/session.ts>
depends-on: <FEAT-IDs this needs to work>
supersedes: <FEAT-IDs this replaces>
superseded-by: <FEAT-IDs that replaced this>
conflicts-with: <FEAT-IDs that cannot coexist with this, or fight it at runtime>
---
```

Frontmatter values are **plain comma-separated text**, not YAML lists — that is what
the tooling parses. Leave a key empty rather than deleting it.

Then the body, in this exact section order (the tooling rewrites two of them):

| Section | Contents |
|---|---|
| `## What it does` | The user-visible behaviour: what someone can do that they could not before. |
| `## How it works` | Design, key modules/files, data flow, integration points. Link paths, don't paste code. |
| `## Progress` | Dated log of development stages — one line per real step, newest last. |
| `## Work` | **Derived.** Todos/records that built it, between the `novadev:work` markers. |
| `## Commits` | **Derived.** Commit hashes, between the `novadev:commits` markers. |
| `## Open questions` | What is undecided or unverified. Delete the section when empty. |

Never hand-write inside the `<!-- novadev:work:… -->` and
`<!-- novadev:commits:… -->` markers — `novadev links --fix` overwrites them from the
records. To make work show up there, put `**Feature:** FEAT-NNNN` in the record (see
`feature-update.md`).

## `touches:` is the conflict detector — get it right

`novadev features --touching <path>` answers "what else already owns this code?", and
it is only as good as this field. List the paths the feature genuinely owns
(directories where practical), not every file it ever reads. Two features legitimately
sharing a path is fine and worth seeing — that is exactly the overlap a future change
needs to know about.

## Finish

1. Generate the index and the derived blocks: `novadev links --fix`.
2. Add one line to `wiki/INDEX.md` pointing at `../features/INDEX.md` so the registry
   is reachable from the pre-context, and make sure `wiki/overview.md` describes
   capabilities in the same words the registry uses.
3. Run `novadev doctor` — it validates frontmatter, IDs, and every cross-reference.
4. Report: how many features by status, which ones you could not confirm (say so
   plainly), and any capability you found in the code that nobody had ever recorded.
5. Commit the registry.
