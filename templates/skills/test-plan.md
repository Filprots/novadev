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

## File the task

```sh
novadev totest --new <slug> --todo <batch>/<todo> --feature FEAT-NNNN --scope "<one line>"
```

That creates `totest/YYYY-MM-DD_<slug>/` with `test-plan.md` and a `test-results/`
folder (seeded with a short guide for the human — leave it there). Name the slug
after the **capability being tested**, not the todo.

Several todos in one batch needing the same pass → ONE test task covering them, with
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

## Gate the todo

Add `ai_needstest.md` next to the `ai_completed.md` (both live in the todo folder —
the record says what you built, the gate says it is not confirmed yet):

```markdown
# ai_needstest — <todo slug>

**Date:** <YYYY-MM-DD>
**Test:** <the totest task id, e.g. 2026-08-27_magic-link>
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

## Finish

1. `novadev totest` — confirm the task shows up as awaiting test.
2. `novadev links` — the gate and the task must reference each other consistently.
3. Commit both the task and the gate.
4. **Tell the human plainly**: what you built, what you verified, what you could not,
   and that `novadev totest` now lists the scenarios waiting for them. Then STOP —
   do not review your own test task. Only the human's explicit
   `/novadev-review-tests` closes the loop.
