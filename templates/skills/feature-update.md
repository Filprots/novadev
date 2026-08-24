# novadev feature-update — keep the registry true after work lands

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

A features registry that lags reality is a trap: the next `feature-check.md` reads
it, believes it, and gets the wrong verdict. This playbook keeps it honest.

**Trigger:** work that created, changed, extended, or removed a capability just
landed — or the human asks for a registry audit.

## After a todo that touched a feature

1. **Author the link on the work side.** The record (`ai_completed.md` /
   `ai_failed.md` / `ai_progress.md`) carries, right under its `**Date:**` line:

   ```markdown
   **Feature:** FEAT-0007
   **Commits:** abc1234, def5678
   ```

   Several features in one todo → list them all (`FEAT-0007, FEAT-0011`). No feature
   at all → `**Feature:** none — <why>` (infra chore, dependency bump, docs). Say it
   explicitly; a silent omission is indistinguishable from forgetting.

   This is the only direction you write by hand. The feature's `## Work` and
   `## Commits` sections are DERIVED from these lines — never edit inside the
   `<!-- novadev:work:… -->` / `<!-- novadev:commits:… -->` markers.

2. **Advance the status** on the feature file, and stamp `updated:`:

   | From → to | When |
   |---|---|
   | `planned` → `in-progress` | first real implementation work started |
   | `in-progress` → `shipped` | the capability works end to end and is verified |
   | any → `deprecated` | removed, or superseded (set `superseded-by:` too) |

   Do not mark `shipped` on the strength of a plan: the linked record must actually
   claim verification. `novadev links` flags a `shipped` feature with no completed
   work, and a `planned` feature that completed work already points at.

3. **Append one line to `## Progress`** — dated, factual, newest last:
   `- 2026-08-24 — magic-link issuance + verification shipped (2026-08-24_1/01-magic-link)`.
   It is a log of real steps, not a changelog of every commit.

4. **Refresh the frontmatter that decides future checks**: `touches:` when the code
   surface moved or grew, `tags:` when the feature acquired vocabulary someone would
   search for, `depends-on` / `conflicts-with` / `supersedes` when the work created
   or resolved a relationship. These fields are what `feature-check.md` searches —
   stale ones cause duplicate features later.

5. **Update the body** where behaviour changed: `## What it does` for new
   user-visible behaviour, `## How it works` when the design moved, and close or
   restate `## Open questions`.

6. **Regenerate and verify**: `novadev links --fix`, then `novadev links`. Commit the
   registry change together with the code and the record.

## When work removes a capability

Never delete the feature file — the history is the point. Set `status: deprecated`,
add the removal to `## Progress` with the todo ref, and if something replaced it, set
`superseded-by:` on this one and `supersedes:` on the replacement (both directions —
`novadev links` fails on a one-way claim).

## Full registry audit (on request)

Go feature by feature and check each against the current code:

1. **Status truth** — does `shipped` actually work? Does `in-progress` have live
   work, or was it abandoned (→ `planned`, or `deprecated` with the reason)?
2. **Existence** — is the capability still in the code at all? A feature whose code
   was deleted is `deprecated`, not silently correct.
3. **`touches:` accuracy** — do those paths still exist, and does the feature still
   own them? Broken paths make the overlap check lie.
4. **Relationships** — are `depends-on` targets still alive; are conflicts still real?
5. **Coverage gaps** — capabilities in the code with no feature file (add them), and
   feature files describing nothing real (deprecate them).
6. **Unlinked work** — terminal records with no `**Feature:**` line: `novadev links`
   lists them as notes. Attach each to its feature or mark it `none — <why>`.
7. Finish with `novadev links --fix` and `novadev doctor`, then report what changed,
   what you could not verify, and what needs a human decision.
