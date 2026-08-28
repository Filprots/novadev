# novadev test-plan — hand verification back to the human, in writing

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy. -->

Some things an agent cannot verify: how a page actually renders, whether an
interaction *feels* right, what a real device or a third-party service does, anything
behind credentials you do not hold. Saying so in chat does not work — chat scrolls
away and the human is left guessing what mattered.

So it goes in `.novadev/totest/` as a real task with stepped scenarios, and the
originating todo gets an `ai_needstest.md` gate that keeps the batch out of the
archive until a person has actually looked.

**Trigger:** work is concluding and something about it could not be verified
automatically. Decide this while writing the record, not later.

## What belongs here — and what does not

File a test task when the check needs **human eyes, hands, or judgement**:
rendering and layout across browsers/devices, animation and perceived performance,
copy that must read well, a flow that must *feel* right, real third-party or payment
sandboxes, hardware (camera, notifications, offline), accessibility with a real
screen reader, anything gated behind an account only the human has.

Do NOT file one for work you could have verified and simply did not — write the test
instead. A `totest` folder full of things a unit test should have covered trains the
human to ignore the folder, which costs you the one channel that catches real
regressions. Nothing testable in CI belongs here.

Judgement call: if you find yourself writing "please just double-check it works",
you have not identified a real scenario. Either name the specific thing you could not
observe, or drop it.

## One living task per feature — check for it FIRST

Test tasks are named after the **feature they test** (`totest/FEAT-0007-magic-link/`),
not after the todo or the date, and there is exactly **one per feature, forever**. It
is a living document: when new work changes that feature, you revise the existing plan
instead of filing a second one.

`totest/` is an active queue: the task folder is only there while a round is open, and
archives to `archive/<year>/totest/<task>/rev<N>-<date>/` once reviewed. So check both:

```sh
novadev totest --all            # open tasks AND completed rounds in the archive
```

**If this feature has been tested before → open a new round (the normal case):**

```sh
novadev totest --round FEAT-0007-magic-link
```

That revives the task from its newest archived round — bringing back the plan you
last tested against as the honest starting point — bumps `revision:`, and sets
`status: awaiting-test` with an empty results inbox. Then you edit the plan; see
"Revising a plan" below. (It refuses if the open round still holds unreviewed results,
so a new round cannot bury testing the human already did.)

**If no task exists → create it:**

```sh
novadev totest --new FEAT-0007 --todos <batch>/<todo> --scope "<one line>"
```

(`--new` takes a `FEAT-NNNN` and names the folder from the registry; a bare kebab
slug is the fallback for work with no feature.) The CLI refuses to create a second
task for a feature that already has one — that refusal is the rule being enforced,
not an obstacle to route around.

Several todos needing the same pass → ONE task listing them all in `todos:`, with
every todo's `ai_needstest.md` pointing at it. Do not make the human repeat a setup.

## Write scenarios a stranger could execute

Each `## Scenario` is a numbered walk with two explicit outcomes:

```markdown
## Scenario 2 — Expired magic link is refused

**Priority:** critical
**Steps:**
1. Request a login link for `demo@example.com`.
2. Wait 20 minutes without opening it (or set `MAGIC_TTL=1m` and wait 2).
3. Open the link.

**Expect (pass):** the "link expired" screen, with a working "send me a new one"
button; no session cookie is set; you are still logged out afterwards.
**Watch for (fail):** it logs you in anyway; a raw stack trace or blank page; the
resend button does nothing; you land in a redirect loop.
```

Rules that make a plan usable:

- **One concrete action per step.** "Verify the flow works" is not a step.
- **Pass and fail are both written down.** Naming the failure modes is what turns
  "looks fine" into a real check — the human cannot report a symptom nobody warned
  them to watch for.
- **Observable outcomes only.** What is on screen, in the response, in the inbox —
  not "the token is validated correctly".
- **Priority per scenario** (`critical` / `normal`) so a human with ten minutes
  knows what to do first.
- **Order by dependency**, cheapest setup first; put anything destructive last.
- The header carries **why a human is needed**, **what you already verified
  automatically** (so they do not redo machine work), and the exact **setup**:
  branch, build command, URL, account, seed data, device/browser matrix.
- **`## Out of scope`** — what this round deliberately does not cover. A plan that
  silently omits things reads as "everything was checked".

## Revising a plan when the feature changes (the part that matters most)

A scenario describing behaviour that no longer exists is **worse than no scenario**:
the human walks it, hits the old expectation, and reports a failure that is really
just a stale plan — which burns their time and teaches them to distrust the folder.

So when you reopen a task, go through every existing scenario and decide:

| The change… | Do this |
|---|---|
| left the scenario valid | keep it — it must be re-walked against the new code |
| moved what "correct" looks like | **rewrite** its Expect/Watch-for to the new truth |
| removed the behaviour entirely | **delete** the scenario |
| made it automatically testable | **delete** it and say which test now covers it |
| introduced new behaviour | **add** a scenario for it |

Then log it under `## Revisions`, newest last, so the human knows what is different
since they last tested:

```markdown
- 2026-09-15 (rev 3) — TTL cut to 5 min: Scenario 2 expectations updated.
  Scenario 4 (SMS fallback) deleted, that path was removed. New: Scenario 5
  (rate limiting on resend).
```

Also refresh the header: what you verified automatically this time, and any setup
that moved (new URL, new seed data, new device matrix). A plan whose setup is stale
fails before scenario 1.

Never edit an archived round under `archive/<year>/totest/` — it records what was
actually tested back then, and the feature's `tests.md` cites it as evidence.

## Gate the todo

Add `ai_needstest.md` next to the `ai_completed.md` (both live in the todo folder —
the record says what you built, the gate says it is not confirmed yet):

```markdown
# ai_needstest — <todo slug>

**Date:** <YYYY-MM-DD>
**Test:** <the totest task id, e.g. FEAT-0007-magic-link>
**Feature:** <FEAT-NNNN, or `none — <why>`>

## Why a human is needed
<the specific thing you could not observe>

## Verified automatically already
<tests/build/typecheck that passed — actual results>

## What is riskiest
<where you would look first if something is broken — steer their attention>
```

While `ai_needstest.md` exists the todo is **not** terminal: `novadev status` shows
it as `⧗ needstest` and `novadev archive --done` refuses to file the batch away. That
is the point — a pending test cannot be lost.

Add the todo's ref to the task's `todos:` frontmatter list at the same time — the two
sides must name each other, and `novadev links` fails when they do not.

## Finish

1. `novadev totest` — confirm the task shows up as awaiting test at the new revision.
2. `novadev links` — the gate and the task must reference each other consistently.
3. Commit both the task and the gate.
4. **Tell the human plainly**: what you built, what you verified, what you could not,
   and that `novadev totest` now lists the scenarios waiting for them. Then STOP —
   do not review your own test task. Only the human's explicit
   `/novadev-review-tests` closes the loop.
