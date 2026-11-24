# totest — the testing queue, walked by a tester agent

<!-- managed by `novadev deploy`. -->

When an agent finishes work, it runs its own tests — and what those cannot show (the real
app end to end, a browser, a device, a service, what is on the screen) it does not claim. It
files a test round here and gates the todo with `ai_needstest.md`.

**A TESTER runs the round, not you.** The tester is an agent that did not build the work
(`/novadev-test`, in a fresh session or as a sub-agent). Its main job is the tooling: it
builds the harnesses, drivers, fixtures and scripts it needs, keeps them in the project, runs
every scenario itself, records the results with evidence, then reviews the round and closes
the gate. **You are asked only for what it truly cannot run** — a real device, a login only
you hold, a judgement only a person can make — and only the smallest part of it: each ask is
in the round's `test-results/needs-human.md`.

This folder is an **active queue**: a task folder is here only while a round is open. When a
round is reviewed it moves to `../archive/<year>/totest/<task>/rev<N>-<date>/` with its plan
and its evidence intact, and the feature's `tests.md` links to it.

Tasks are named after the **feature** they test (`FEAT-0007-magic-link/`), one per
feature. When new work changes a feature, the builder revives that task from its last
archived round and REVISES the plan — rewriting scenarios whose expectations moved,
deleting ones the change made irrelevant. A scenario describing behaviour that no longer
exists is worse than no scenario: the tester would run it, hit the old expectation, and
report a failure that is really just a stale plan.

Each open task folder holds:

- **`test-plan.md`** — living document: why a tester is needed, what was already verified
  automatically, the setup, the tools to drive it with, a `## Revisions` log, then numbered
  `## Scenario` sections each with explicit **Expect (pass)** and **Watch for (fail)**;
- **`test-results/`** — the current round's results: one `scenario-<N>.txt` per scenario
  (`novadev test-result write`, appended, with **Tested by**), screenshots, logs — and
  `needs-human.md` when the tester asked a person for something.

```sh
novadev totest        # every open round, and who it waits on: a tester, or you
novadev totest --all  # also lists every completed round in the archive
novadev status        # the same queue, in the stock-take
```

**When the tester needs you**, `novadev sync` lists the ask under WAITING ON THE HUMAN. Say
"what should I test" and `/novadev-what-to-test` walks it with you and records what you
found; or give the tester what it asked for (an account, a device) and it runs the scenario
itself. Tested something on your own? Say what you found — `/novadev-test-review` writes it
up, and the tester reviews it with the rest.

Not worth testing? Say so: on your word an agent marks the scenarios (or the rest of the
round) **skipped** with `novadev test-result skip`, with who decided and why. The round then
closes without a confirmation — its todos get `ai_testskipped.md` (not tested).

A todo carrying `ai_needstest.md` is deliberately **not** terminal: `novadev sync`
refuses to file its batch away, so a pending test cannot be forgotten. The same command
sweeps reviewed rounds into the archive, where the results and the evidence stay in git.

All the rules — writing a plan, running a round, escalating, reviewing — are in
`../skills/novadev-work.md` (loop phases 5 and 6) and `../skills/novadev-test.md` (the
tester's playbook).
