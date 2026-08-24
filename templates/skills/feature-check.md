# novadev feature-check — pre-flight a proposed feature against the registry

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

Before ANY new capability is designed or built, check it against
`.novadev/features/`. This playbook exists to stop the three expensive mistakes:
**building what already exists**, **building something that fights an existing
feature**, and **building a second half-version of a capability instead of extending
the first**.

**Trigger:** a new feature is proposed — by the human in chat, by a todo brief, by a
spark graduating, or by you while planning a batch. Run it *before* design work, not
after. It costs a few minutes; a duplicate costs a rewrite.

If `features/INDEX.md` is missing, STOP and build the registry first
(`feature-init.md`) — a check against an empty registry always says "go", which is
exactly the wrong answer in a project that already has features.

## 1. Extract the search surface from the proposal

Write down, before searching: the **capability** in one line; the **nouns and verbs**
a past author might have used for it (including synonyms — "login/auth/sign-in",
"export/download/report"); and the **code surface** it will touch (paths, modules,
routes, tables, config keys).

## 2. Search from every angle — one angle finds one kind of collision

| Angle | How | Catches |
|---|---|---|
| Name/keyword | `novadev features <term>` per synonym | the same feature under another name |
| Code surface | `novadev features --touching <path>` per path | features that own the code you are about to change |
| Area | `novadev features --area <area>` | neighbours that should absorb this instead |
| Lifecycle | `novadev features --status planned` / `in-progress` | someone already started it |
| Deprecated | `novadev features --status deprecated` | a capability removed on purpose — do not resurrect it blindly |
| Full text | grep the registry + `archive/` records for the nouns | rejected designs and past attempts |

Also read `postponed/` (a parked version of this work, with its trigger) and
`sparks/` (an earlier shape of the idea). Both may be the same proposal, already
thought about once.

Open the candidate features and READ them — status, `## What it does`,
`## Open questions`, `conflicts-with`. Frontmatter alone decides nothing.

## 3. Classify every hit

- **Duplicate** — the capability already exists and works. Do not build it.
- **Extension** — an existing feature covers most of it; this is a behaviour to add
  to that feature, not a new `FEAT-`.
- **Supersession** — this replaces an existing feature. New `FEAT-` with
  `supersedes:`, and the old one gets `superseded-by:` + `status: deprecated`.
- **Conflict** — both can exist but they fight (same route/flag/state, contradictory
  behaviour, competing sources of truth). Record `conflicts-with:` on BOTH and say
  how they are reconciled.
- **Dependency** — this needs another feature to work (or is blocked by a `planned`
  one). Record `depends-on:`.
- **Overlap only** — shared code surface, independent behaviour. No metadata needed;
  name the shared paths in the design so the change does not break the neighbour.

## 4. Return a verdict — always one of these

| Verdict | Means | Next step |
|---|---|---|
| **build** | genuinely new | new `FEAT-` (status `planned`), then do the work |
| **extend FEAT-NNNN** | belongs to an existing feature | update that feature; no new ID |
| **supersede FEAT-NNNN** | replaces existing behaviour | new `FEAT-` + both links + deprecate the old |
| **drop** | already exists and works | say where it is; do not build |
| **blocked** | needs an unbuilt dependency, or conflicts unresolvably | name the blocker; `postponed/` if it is waiting on a trigger |

State the verdict with **evidence** — the FEAT-IDs you checked and what each one
said. "No conflicts found" is only credible with the searches you ran attached; if
you searched two synonyms and one path, say exactly that, because a check that
overstates its coverage is worse than no check.

## 5. Land the outcome

- **build / supersede** → create the feature file now (`novadev features --new <slug>`),
  fill `area`/`tags`/`touches` and the metadata links from step 3, status `planned`,
  and reference it from the todo brief and record with `**Feature:** FEAT-NNNN`.
- **extend** → no new file; note the decision in the existing feature's `## Progress`.
- **drop / blocked** → the answer goes in the record (`ai_failed.md`, case *cancelled*
  or *blocked*) so the next person asking finds the reasoning instead of re-deriving it.
- Update reciprocal metadata on the OTHER feature too (`conflicts-with`,
  `superseded-by`) — `novadev links` fails on one-way supersession.
- Run `novadev links --fix`, then commit.
