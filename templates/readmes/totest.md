# totest — what needs YOUR hands

<!-- managed by `novadev deploy`. -->

The human-verification queue. When an agent finishes work it could not fully verify
itself — browser rendering, a real device, visual judgement, a third-party service,
whether something *feels* right — it does not claim it works. It files a test task
here and gates the todo with `ai_needstest.md`.

One task = one folder `YYYY-MM-DD_<slug>/` containing:

- **`test-plan.md`** — why a human is needed, what was already verified
  automatically, the setup, then numbered `## Scenario` walks each with an explicit
  **Expect (pass)** and **Watch for (fail)**;
- **`test-results/`** — where YOU write what actually happened: a `results.md`,
  screenshots, recordings, logs. Anything you add here (besides the seeded
  `README.md`) marks the task **ready for review**.

```sh
novadev totest        # what is waiting on you, and what is ready for review
novadev status        # same queue, at the top of the stock-take
```

Then run **`/novadev-review-tests`** — and only then. An agent reads your results,
judges each scenario against its written expectation, writes `ai_confirmed.md` on the
original todo, and files follow-up todos for whatever failed. Agents never review
their own pending test tasks.

A todo carrying `ai_needstest.md` is deliberately **not** terminal: `novadev archive
--done` refuses to file its batch away, so a pending test cannot be forgotten.
Reviewed rounds archive to `archive/<year>/totest/` — the notes and screenshots stay
in git as the evidence that it really was checked.

Playbooks: `../skills/test-plan.md` (file a task), `../skills/review-tests.md`
(close the loop).
