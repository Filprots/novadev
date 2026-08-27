# novadev review-tests — read the human's results and close the loop

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

The human walked the scenarios and wrote down what happened. This playbook turns that
into a decision: the work is confirmed, or it produces new work — and either way the
gate closes so nothing sits in limbo.

**Trigger:** the human invokes this explicitly (`/novadev-review-tests`). Never run it
on your own initiative: an unreviewed test task is a request for *their* attention,
and closing it yourself destroys the only signal that a person actually looked.

## 1. Find what is ready

```sh
novadev totest        # tasks with results are marked READY FOR REVIEW
```

Review every ready task unless the human named one. A task with an empty
`test-results/` (only the seeded `README.md`) has **not** been tested — say so and
leave it open; do not infer a pass from silence.

## 2. Read everything, in this order

1. `test-plan.md` — the scenarios and, critically, what each one's pass and fail
   were defined to be. Judge against what was written, not against what you would
   have expected.
2. Every file in `test-results/` — notes, screenshots, recordings, logs, exports.
   **Look at the images**, do not skip them; a screenshot often contradicts the
   sentence next to it, and when they disagree the screenshot wins.
3. The originating todo's `ai_completed.md` and `ai_needstest.md`, for what the code
   was supposed to do.

Human notes are informal by nature. "Kinda slow", "the second one looked weird",
"had to click twice" are all real findings — treat them as such rather than
discarding them for being unquantified. If a note is genuinely ambiguous about
whether something passed, ask the human rather than guessing; a wrong `passed` is
far more expensive than one question.

## 3. Judge each scenario

Per scenario: **pass / fail / partial / skipped / unreported**, each with the
evidence you based it on. Then read across them for what the plan did not ask:
off-script observations, a symptom in one scenario that explains another,
environment-specific behaviour (one browser only, one device only) — that is usually
the most valuable content in the folder.

Reproduce what you can before concluding: if a report describes something a test
*could* have caught, go look at the code and confirm the mechanism. A confirmed
cause turns a vague note into a fixable todo.

## 4. Land the outcome

**Always** close the gate: delete `ai_needstest.md` from the todo and write
`ai_confirmed.md` in its place. "Confirmed" means *human verification happened and
was reviewed* — the verdict inside says whether it worked.

```markdown
# ai_confirmed — <todo slug>

**Date:** <YYYY-MM-DD>
**Test:** <totest task id>
**Verdict:** passed | passed-with-followups | failed
**Feature:** <FEAT-NNNN, or `none — <why>`>

## What the human reported
<per scenario: verdict + the evidence, including which files/screenshots>

## Off-script findings
<anything they noticed that the plan did not ask about — or "none">

## Conclusion
<what this means for the work; for anything unresolved, say so plainly>

## Follow-ups
<new todo refs filed from failures, or "none">
```

Then, by verdict:

- **passed** — nothing else to file.
- **passed-with-followups** / **failed** — file the fixes as a NEW batch of todos
  (per the chat-initiated rules in `workflow.md`): one todo per coherent problem,
  each brief carrying the scenario it came from, the human's exact words, the
  evidence file, and your reproduction if you got one. Cross-link both ways: the new
  brief names the todo it came from, and `## Follow-ups` names the new todos. Never
  silently reopen the original todo — the original record stays true about what it
  did; the new work is new work.
- Anything the human could not test (blocked, skipped, environment unavailable) does
  not become a pass. Either keep a scenario open in a fresh test task, or park it in
  `postponed/` with the trigger that would make it testable.

## 5. Mark the round done

1. Set `status: reviewed` in the test task's `test-plan.md` frontmatter.
2. Update the feature: status and a dated `## Progress` line recording that human
   verification happened and what it found (`feature-update.md`). A feature only
   earns `shipped` once the human verification behind it actually passed.
3. `novadev links --fix`, then `novadev doctor`.
4. `novadev archive --done` files reviewed test rounds into `archive/<year>/totest/`
   — the results and screenshots stay in git as the evidence that it was checked.
5. Commit, then report to the human: verdict per scenario, what you filed, and what
   still needs them.
