# totest — what needs YOUR hands

<!-- managed by `novadev deploy`. -->

The human-verification queue. When an agent finishes work it could not fully verify
itself — browser rendering, a real device, visual judgement, a third-party service,
whether something *feels* right — it does not claim it works. It files a test task
here and gates the todo with `ai_needstest.md`.

This folder is an **active queue**: a task folder is here only while a round is open,
so everything you see is genuinely waiting on you. When a round is reviewed it moves
to `../archive/<year>/totest/<task>/rev<N>-<date>/` with its plan and your evidence
intact, and the feature's `tests.md` links to it.

Tasks are named after the **feature** they test (`FEAT-0007-magic-link/`), one per
feature. When new work changes a feature, the agent revives that task from its last
archived round and REVISES the plan — rewriting scenarios whose expectations moved,
deleting ones the change made irrelevant. A scenario describing behaviour that no
longer exists is worse than no scenario: you would walk it, hit the old expectation,
and report a failure that is really just a stale plan.

Each open task folder holds:

- **`test-plan.md`** — living document: why a human is needed, what was already
  verified automatically, the setup, a `## Revisions` log (what changed since you
  last tested this), then numbered `## Scenario` walks each with an explicit
  **Expect (pass)** and **Watch for (fail)**;
- **`test-results/`** — the current round's inbox, where YOU write what actually
  happened: a `results.md`, screenshots, recordings, logs. Anything you add here
  (besides the seeded `README.md`) marks the task **ready for review**;
Previous rounds are not here — they are in `../archive/<year>/totest/<task>/`, listed
with their verdicts in the feature's `tests.md`.

```sh
novadev totest        # what is waiting on you, and what is ready for review
novadev totest --all  # also lists every completed round in the archive
novadev status        # the same queue, at the top of the stock-take
```

Then run **`/novadev-review-tests`** — and only then. An agent reads your results,
judges each scenario against its written expectation, writes `ai_confirmed.md` on the
original todo, and files follow-up todos for whatever failed. Agents never review
their own pending test tasks.

A todo carrying `ai_needstest.md` is deliberately **not** terminal: `novadev archive
--done` refuses to file its batch away, so a pending test cannot be forgotten. That
same command sweeps reviewed rounds into the archive, where the notes and screenshots
stay in git as the evidence it really was checked.

Playbooks: `../skills/test-plan.md` (file a task), `../skills/review-tests.md`
(close the loop).
