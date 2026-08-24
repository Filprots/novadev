# novadev links-audit — validate and repair the whole link graph

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

Everything in `.novadev/` is connected: a record names the feature it built, the
feature lists the work and commits that made it, memories and postponed items name
the areas they guard. This playbook audits that graph end to end and repairs it.

**Trigger:** the human asks to check/fix the links; `novadev doctor` or
`novadev links` reports link problems; a big merge, rename, rebase, or archive sweep
just moved things around; or periodic hygiene.

## The rule that keeps the graph repairable

Every edge has **one authored direction and one derived direction**:

| Edge | Authored (by hand, in the record) | Derived (`novadev links --fix`) |
|---|---|---|
| todo → feature | `**Feature:** FEAT-0007` | the feature's `## Work` block |
| todo → commits | `**Commits:** abc1234` | the feature's `## Commits` block |
| feature → registry | the file's frontmatter | `features/INDEX.md` table |

So there is no such thing as "updating both sides": you fix the authored line and
regenerate the rest. Never hand-edit inside `<!-- novadev:*:begin/end -->` markers —
the next `--fix` overwrites it.

## References are IDs, never paths

| Target | Reference form |
|---|---|
| Feature | `FEAT-0007` |
| Todo / record | `<batch>/<todo>` — e.g. `2026-08-24_1/01-magic-link` |
| Memory | the memory's slug / filename |
| Postponed | the item's slug / filename |
| Commit | the hash |
| Wiki page | `wiki/<page>.md` (the wiki never moves) |

This is deliberate: `novadev archive` moves a batch from `todos/` to
`archive/<year>/`, changing its depth, so **relative links into or out of a todo
folder break on archiving** while IDs keep resolving. If you are about to write
`../../features/…` inside a record, write the ID instead.

## Run the audit

```sh
novadev links          # validate: unresolvable refs, one-way claims, stale derived blocks
novadev links --fix    # regenerate every derived block + features/INDEX.md
novadev doctor         # the same checks plus the structural ones
```

## What the tool cannot fix — the part that needs you

`--fix` only regenerates derived content. Everything below is judgement work:

1. **Unresolvable feature refs** (`**Feature:** FEAT-0042` with no such file) —
   find the feature that was meant (search the registry by the record's subject); if
   it truly never existed, either create it from the record's evidence or correct the
   record. Never delete the line to silence the error.
2. **One-way supersession** (`A supersedes B`, but `B` says nothing) — read both,
   decide which claim is true, then write the reciprocal field. If neither actually
   replaced the other, they are `conflicts-with` (or unrelated) instead.
3. **Records with no `**Feature:**` line** (reported as notes) — the backlog of work
   that predates the registry. Work newest-first: open the record, identify the
   capability, add the link or `none — <why>`. Batch this; do not leave it half-done
   without saying which batches you covered.
4. **Status contradictions** — `shipped` with no completed work, `planned` with
   completed work. Resolve per `feature-update.md`; the tool cannot tell which side
   is lying.
5. **Missing commits** — a hash git does not know (rebased away, squashed, never
   pushed). Find the surviving commit for that change and correct the record; if the
   work was dropped, say so in the record instead of leaving a dead hash.
6. **Stale `touches:` paths** — a path that no longer exists silently breaks
   `novadev features --touching`, which is how future work finds conflicts. Repoint
   it at where the code moved.
7. **Orphans** — features nothing links to and that describe nothing real
   (→ deprecate or delete with a reason); memories and postponed items pointing at
   deleted code (→ `memories-review.md`, or delete the postponed item as obsolete).

## Finish

- `novadev links` is clean, or every remaining item is listed in your report with
  why it needs a human.
- Report: how many refs were checked, what `--fix` regenerated, what you repaired by
  hand, and what is still open.
- Commit the repaired graph.
