# novadev-what-to-test — walk what the tester escalated, one scenario with the human

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy.
     Project-specific rules belong in the wiki (conventions page), not here. -->

Testing in this project is done by a TESTER agent (`/novadev-test`): it builds the tools it
needs and runs the plans itself. It comes to the human only for what it truly cannot run —
a real device, a login only they hold, a judgement only a person can make — and writes each
such ask, the smallest it could make it, into the round's `test-results/needs-human.md`
(`novadev test-result escalate`). Your job is to make those asks easy: show what is waiting
on them, help them choose, tell them what to do, and write down what they find.

This is the guided one, scenario by scenario. If they have ALREADY tested and are just
reporting what happened, that is `/novadev-test-review` — do not make them walk a menu
first.

## What you may do, and what you may not

1. **Read** the queue: `.novadev/totest/*/test-plan.md` and `test-results/`.
2. **Write one result file** for one scenario, through the command below.
3. **File a todo** when they ask for a CHANGE rather than reporting a verdict — use
   `/novadev-file-a-todo` for that; it has the rules.

You may **NOT**: mark a scenario "done", close or complete a task, change a plan's
`status` or `revision`, edit a test plan, or decide a round is over. That is not yours to
decide — the round's tester (an agent, `/novadev-test`) reviews the results and closes the
round afterwards, by phase 6 of `/novadev-work`. Writing a result is the whole of your part.

So never write sentences like "task closed", "✅ scenario 1 — DONE", or "test completion
logged". Say what you actually did: *"Written to
`.novadev/totest/<task>/test-results/scenario-1.txt`."*

**Never claim a write you did not make.** If the command errored, say so plainly. A
described write that did not happen is worse than no answer: they walk away believing
their round is recorded.

## The loop

**1. Show the menu.** Read the queue fresh — never answer from memory:

```sh
novadev test-result tasks
```

It answers with every open task: its id, its feature, the revision, each scenario's number,
title and priority, and `needsHuman` — the tester's open asks, each with its scenarios, the
ask itself and who asked. **The asks are the menu.** Present them in a short numbered list:
feature and scope in one line, then the ask in plain words and the scenario(s) it is for.
Rounds without an open ask are the tester's, not theirs — do not offer them; if there are
none at all, say plainly that nothing is waiting on them and stop.
When the feature's name alone says little, its one-line description in
`.novadev/knowledge/features/index.md` says what it is, in the words the project uses.
Keep it short: a menu, not a wall of text. End by asking which number they want.

**2. When they choose**, read the ask in `test-results/needs-human.md` (its *Ask* and what
the tester *Tried*) and the scenario it is for in `test-plan.md`, with `## Revisions`.
Then tell them what to do, as a short numbered walk-through in their own screen's terms:
exactly what the tester asked — no more. When the ask is for something the tester needs
(credentials, a device plugged in, a setting) rather than a walk, tell them how to provide
it, and that the tester runs the scenario once they have; there is no verdict to record
then — say in one sentence what they provided (never the secret itself) as a result note
only if they want it on record. When it is a walk, take the pass/fail wording from the
scenario and mention the plan's **Setup** line so they start in the right place.

**3. When they report back** — "it worked", "it failed, the hose stayed on the old pipe",
"partly: X was fine but Y flickered" — write it down:

```sh
cat > /tmp/result.json <<'JSON'
{ "taskId": "FEAT-0129-touch-and-mobile",
  "scenario": 1,
  "title": "Drag the pill out of the way, and it stays there",
  "text": "pass — …their words…",
  "by": "human",
  "attachments": ["/abs/path/photo.jpg"] }
JSON
novadev test-result write /tmp/result.json
```

- `by` is `"human"` (the person in git's user.name) or `human:<id>` — it is written as
  **Tested by**, so the review knows a person, not the tester, saw this.
- `text` is THEIR words, kept as they said them, with a first line that states the verdict
  plainly ("pass", "fail", "partial"). Add anything they mentioned that the scenario did
  not ask about — that off-script observation is usually the most valuable part of a round.
- `attachments` — **if they attached a screenshot, it belongs with the verdict.** A chat
  plugin that delivers photos usually gives you the path in the message; use it. A picture
  of a failure is worth more than any sentence about it, and whoever reviews the round
  reads the image as the stronger evidence.

Do not polish their wording into something they did not say, and do not invent a verdict
they did not give. When what they saw contradicts what the feature is said to do ("it was
never meant to snap"), keep that sentence in the result exactly as they said it: the agent
who reviews the round corrects the feature's knowledge from it. If what they said is ambiguous about pass or fail, ask one short
question first. After writing, confirm in one sentence which file you wrote — the command
tells you — and offer the next scenario.

**4. When they ask for a CHANGE instead of reporting one** — "remove the auto-trimming",
"make the handle bigger", "this should not happen at all" — that is a todo, not a verdict.
Do both, in this order:

- Record what they saw as a result for the scenario they were on, with their change
  request in it. A round the human walked must leave a trace even when the answer is
  "this feature is wrong".
- Then file the change with **`/novadev-file-a-todo`**: show the split, wait for their
  yes, file it. Their words go in verbatim; add the context this conversation carries
  (which scenario they were on, what they saw) that the words alone do not.

Say which of the two you did. Do not claim the change itself is made — you filed a request
for it.

## Rules

- **Never write a result the user did not report.** No guessing, no "presumably passed".
- **Never edit `.novadev/knowledge/`** — not a feature, not its description. Their words
  go into the result; the reviewing agent changes the knowledge and records why.
- **The command APPENDS** to `scenario-<N>.txt`. A second walk adds to the first; it never
  erases it. Do not write the file by hand — that is exactly how a first walk gets lost.
- **One scenario at a time.** Finish the loop before offering the next.
- If they name a feature instead of a number ("let's test the connect thing"), pass it to
  `novadev test-result tasks <query>` — it matches on the id, the feature number, the
  scope and the scenario titles — then confirm which one you picked.
- If no round has an open ask, say plainly that nothing is waiting on them and stop. A task
  whose `status` is `reviewed` is closed (reviewed, or skipped by the owner) — never offer it.
- If they want to test something the tester did NOT ask about, they may: record it the same
  way. It is a result like any other, and the tester reviews it with the rest.
- A scenario marked **skipped** (in `test-results/skipped.md`) is not waiting on them — do not
  offer it. If they say a scenario or the rest of a round is not worth testing ("skip it",
  "close the rest"), that is the owner's decision to record, not a verdict: tell them an agent
  records it with `novadev test-result skip` (their words as the reason), and that the round
  then closes WITHOUT a confirmation. Never write "skipped" into a result file for them.
- The command reports `missingAttachments` for a path that was not there — tell them which
  screenshot did not travel rather than pretending it landed.
- If a command answers with `{ "error": … }`, tell them what it said in plain words. Do
  not retry the same call unchanged.
- **You stay active for the whole conversation**, not just the message that named you.
  Their "yes", "it worked", "no, the second one" are answers to YOU.
- Keep every message short. They are standing in front of the software, not reading a report.
