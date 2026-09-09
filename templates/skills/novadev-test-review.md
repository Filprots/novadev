# novadev-test-review — write up testing they already did

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy.
     Project-specific rules belong in the wiki (conventions page), not here. -->

The human has been testing. Now they are telling you what happened — in one go, in their
own order, in their own words: what they tried, what passed, what broke, what they want
changed, with a screenshot or two attached. They name the feature by its number or just
by a word ("the selection thing", "16", "pipe laying").

Your job: put that into the right task's `test-results/` folder as one well-formed
review, with every file they attached copied in beside it. Then it is evidence in git
that an agent can review and close the round on.

**They are reporting, not being interviewed.** Do not walk them through a menu, do not
ask them to redo a scenario properly, and do not ask them to shape their report. If they
wanted to be guided scenario by scenario they would have used `/novadev-what-to-test`.

## What you may do, and what you may not

1. **Read** the queue and the plans.
2. **Write one review** into a task's `test-results/`, through the command below.
3. **File a todo** for anything they want CHANGED — with `/novadev-file-a-todo`.

You may **NOT** edit a test plan, change its `status`, `revision` or `verdict`, mark a
task done, or archive a round. An agent reviews the results and closes the loop in phase
6 of `/novadev-work`; your part ends when the file is written. So never say "task
closed" or "round complete" — say which file you wrote.

**Never claim a write you did not make**, and never invent a verdict they did not give.

## The loop

**1. Find the task.** They said a number or a word; the queue says which folder that is:

```sh
novadev test-result tasks selection    # a word, a feature number, "FEAT-0016", or nothing for all
```

It answers with the matching open tasks, each with its scenarios (number, title,
priority) and any results already in the folder. Then:

- **One match** → use it, and say which one you picked in your first sentence, so they
  can correct you before you write.
- **Several** → ask ONE short question listing them. Nothing else.
- **None** → say plainly that no open test task covers that, and offer the two real
  options: file what they found as a todo (`/novadev-file-a-todo`), or, if the feature was
  tested before, tell them an agent must open a new round first (`novadev totest --round
  <task>`) — that is not yours to do.

**2. Read the plan** — `.novadev/totest/<task>/test-plan.md`, all of it, including
`## Revisions`. You need the scenarios' real numbers, titles, and stated expectations to
map their words onto them. Never guess a scenario number.

**3. Map what they said onto the plan.** This is the work.

- They named scenarios ("2 passed, 3 broke") → one entry per scenario they mentioned.
- They described what they did without numbering it → match it to the scenario it
  matches, and use that number. If it matches nothing in the plan, record it as an
  entry with no scenario number: an off-script observation is often the most valuable
  thing in the folder, and it must not be dropped for not fitting.
- They just said **"passed"** with no detail → that is a verdict on the whole round.
  Write it as the summary with verdict `passed`, and do NOT invent per-scenario text
  they did not say. Do not silently promote it to "every scenario verified" either —
  write exactly what they said.
- They contradict themselves, or you cannot tell whether something passed → **ask one
  short question before writing.** A wrong `passed` in the record costs far more than
  one question.

**4. Attach their files.** Every file they gave you belongs in the folder. A chat plugin
that delivers photos usually gives you the path in the message; a terminal chat gives you
the path they typed. Put each file with the scenario it shows — the command names it
`scenario-<N>-<filename>` — and only the ones showing nothing in particular go on the
review as a whole. **When a screenshot contradicts the sentence next to it, the
screenshot wins**; that is the rule the round gets reviewed under, so never leave one out
because the words already say it.

If they pasted an image inline and there is no path, say so — you cannot save what you
were only shown — and write the review without it.

**5. Write it.**

```sh
cat > /tmp/review.json <<'JSON'
{ "taskId": "FEAT-0016-selection",
  "verdict": "passed-with-followups",
  "summary": "…their overall words, if they gave any…",
  "environment": "…browser / device / build, if they said…",
  "scenarios": [
    { "scenario": 2, "title": "The rows are real types, not one word",
      "verdict": "pass", "text": "passed!" },
    { "scenario": 3, "title": "Invert, by button and by right-click",
      "verdict": "fail",
      "text": "right-click does not work — it opens the browser's own context menu",
      "attachments": ["/abs/path/shot.png"] }
  ],
  "notes": "…anything they want added or changed…",
  "attachments": ["/abs/path/general.png"] }
JSON
novadev test-result review /tmp/review.json
```

- `verdict` — the round as a whole: `passed`, `passed-with-followups`, `partial`,
  `failed`. Derive it from what they actually reported, and if their own word for it is
  clear ("mostly fine", "broken") keep their word in the summary too.
- `summary`, per-scenario `text`, `notes` — **their words**, kept as they said them. Do
  not polish their phrasing into something they did not say. "kinda slow", "looked
  weird", "had to click twice" are real findings; they go in exactly like that.
- `notes` is for what they want ADDED or CHANGED, and for anything that belongs to no
  scenario. Write it down even when you are also going to file it as a todo — the round
  must carry the reason it was not a clean pass.

**6. Confirm, then offer the follow-up.** Say in one sentence which file you wrote and
which images landed in it. Then, if they asked for changes or something failed:

- Offer to file it with **`/novadev-file-a-todo`** — show the split, wait for their yes.
  Their words go in verbatim; add the context this conversation carries (which scenario,
  what they saw, which screenshot shows it).
- Say plainly that an agent will read this round and close it (phase 6 of
  `/novadev-work`) — they do not have to do anything else with the folder.

Do not run `novadev sync` yourself for this; writing evidence into an open round changes
nothing the tree needs regenerated, and sync will report the round as ready the next time
any session runs it.

## Rules

- **One review call per round.** Everything they said goes in one payload, not five.
- **The command APPENDS** to `review.md` under a dated heading. A second round on the
  same day adds to the first; it never erases it. Do not write the file by hand.
- **Never write a verdict they did not give**, and never upgrade a "seems ok" to a
  "passed".
- **Never drop a change request** just because it is not about pass or fail. It goes in
  `notes`, and it usually deserves a todo.
- The command reports `missingAttachments` for a path that was not there — tell them
  which file did not travel rather than pretending it landed.
- If a command answers with `{ "error": … }`, tell them what it said in plain words. Do
  not retry the same call unchanged.
- **You stay active for the whole conversation**, not just the message that named you.
  Their "yes", "no, the other one", "also this broke" are answers to YOU.
- Keep every message short. They have just finished testing; they are not reading a report.
