# metrics — the project's own numbers

<!-- managed by `novadev deploy`. -->

`latest.json` is the newest snapshot of numbers the project measures about itself: its
known debt, and its biggest "hubs" (the files or modules that collect too much). `novadev
sync` writes it. Do not edit it by hand. It is tracked in git, so every commit shows how
the numbers moved.

**This is off until you turn it on.** Set a command in `../novadev.json`:

```json
"metrics": "bun scripts/novadev-metrics.ts"
```

The command runs from the project root. It prints ONE JSON object on stdout, and nothing
else (logs go to stderr):

```json
{
  "debt": { "known": 230, "new": 0 },
  "hubs": [
    { "name": "Workbench", "measure": 11019, "over": ["loc"], "path": "src/editor/workbench/" }
  ]
}
```

`debt` and `hubs` are both optional, but at least one must be there. `new`, `over` and
`path` are optional too. A path is relative to the project root and stays inside the project
(no `..`). novadev does not know what the numbers mean. It only compares them.

A hub's `path` is also what the placement check uses: a record whose commits changed a file
inside it needs a `## Placement` section. When no hub here has a path, `"hubs"` in
`../novadev.json` can list the paths instead.

Every `novadev sync` runs the command and stores the new snapshot. It compares the numbers
with the last commit and lists what GREW under NEXT ACTIONS, until a record of this round
explains it in a `## Debt` section (it names each hub that grew). A missing or failing
command is only a warning. `novadev sync --check` fails while this file is out of date.

**The debt budget.** Add `"debtBudget": { "maxKnown": 230 }` to `../novadev.json`. When
known debt goes over `maxKnown`, `novadev sync` lists it as a NEXT ACTION and
`novadev sync --check` fails. To raise the budget, the record of the work that caused it
gets a `## Debt` section with a `**Raise:** 230 → 238` line and the reason. The raise starts
at the current budget, stops at the measured debt, and counts only in the round it is written
in. Sync then writes the new budget and remembers the raise under `debtBudget.raises`, so it
counts once. `novadev sync --check` fails until sync has written it: commit `../novadev.json`
together with the record. When known debt drops under the budget, sync asks you to lower
`maxKnown`, so the gain is kept.

**The wiki block.** Sync also keeps a generated "Budgets" block in
`../wiki/architecture.md` (or the page named by `"metricsWikiPage"`): the debt count, the
budget and the hub table.

On a merge conflict in `latest.json`: keep either side, or delete the file, then run
`novadev sync`. On a merge conflict in `../novadev.json`: keep the higher `maxKnown` and the
raises of both sides.

All the rules are in `../skills/novadev-work.md` (loop phases 4 and 10).
