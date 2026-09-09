# novadev-file-a-todo — turn what they just said into a todo

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy.
     Project-specific rules belong in the wiki (conventions page), not here. -->

The human is describing work they want done — often from a phone, often mid-test, often
with a screenshot attached. Your job is to turn that into real todo folders in
`.novadev/todos/`, written the way they write them, so a development agent can pick the
work up later without them repeating themselves.

Filing is the WHOLE job here. You are not starting the work. That is `/novadev-work`.

## What they said is INPUT, not a question

**Never judge whether the software can already do it, and never answer that it cannot.**
A request for something no command covers is not a problem to explain away — it is the
most valuable todo there is, because it is work nobody has done yet. "I want the stage
switches to be green" is a perfectly good todo; answering "there is no setting for that"
files nothing, helps nobody, and loses what they said.

So on this turn you do NOT look for a command, a setting, or a way to do the thing. You
do not read the codebase to see if it is possible. The only reasons not to file are:
they told you not to, or a command returned an error.

## The loop

**1. Look first.**

```sh
novadev file-todo plan
```

It answers which batch the todos would go into and the next todo number. Never guess a
batch name — it counts archived same-day batches you cannot see, and it reuses a batch
filed from chat earlier today while nobody has started work in it.

**2. Find the attachments.** They are FILE PATHS: absolute paths to files already on
disk.

- A **chat plugin** that delivers photos (Telegram and the like) usually writes the file
  down first and gives you the path in the message — use that path. If it gives you an
  id instead, download it first and use the path that comes back.
- A **terminal chat**: use the path they gave you. If they pasted an image inline and
  there is no path, say so — you cannot save what you were only shown — and offer to
  file without it.

**3. Decide the split.** One request may be one todo or several. Split when the parts
would be worked, tested or reverted separately — a bug and a feature idea in one message
are two todos; three symptoms of one broken thing are one. Keep it to the parts they
actually described; never invent work they did not ask for. Give each part:

- a short kebab-case `slug` (`green-highlight-too-thin`) — no numbers, the command numbers them;
- a one-line `title` in their own vocabulary;
- which attachment paths belong to it (a screenshot usually belongs to the part it shows).

**4. Show the plan and WAIT.** Answer with the batch name and a numbered list: for each
part, its title, one line of what it will say, and which files go in it. Then ask plainly
whether to file it. **Do not run the `file` command until they say yes.** If they change
the split, redo this step. "Just file it" or "go ahead" is the yes.

**5. File it.** Write a payload file — never pass prose through shell arguments, that is
how it gets mangled — then run the command:

```sh
cat > /tmp/todo-payload.json <<'JSON'
{ "parts": [
  { "slug": "green-highlight-too-thin",
    "title": "The selection highlight is too thin to see",
    "request": "…their words…",
    "context": "…what you know that their words do not say…",
    "attachments": ["/abs/path/photo.jpg"] }
] }
JSON
novadev file-todo file /tmp/todo-payload.json
```

For each part write:

- `request` — THEIR words. Keep short asks verbatim, including their phrasing and
  emphasis. For a long or rambling message, keep every ask and constraint they stated and
  cut only the repetition. Never replace their words with your summary.
- `context` — what you know that their words do not say, in a few lines: where they were
  and what was on screen, what the screenshots show, any constraint or decision stated
  earlier in this conversation, and anything you noticed that makes the request concrete
  (an identifier, a setting, a number they mentioned). This is the part that saves them
  typing later — make it factual, never speculative.

**6. Confirm.** Report the refs it created (`2026-09-08_4/01-green-highlight-too-thin`),
which files landed in each, and stop. **Do not start working on the todo.** Do not run
`novadev sync` either; a brand-new brief with no record is exactly what the tree expects.

## Rules

- **Never refuse on feasibility.** "That is not possible", "there is no setting for
  that", "that would need to be a feature request" — all wrong here. It IS a feature
  request; file it. If you happen to know it can already be done, say so in one line
  INSIDE the context you write, and file the todo anyway.
- **Never file without a yes.** The folders land in their repository.
- **Never invent a `**Feature:**` line, a feature id, or a priority.** The brief is a
  request, not a plan. If a feature is obviously involved, mention it in prose inside the
  context. (If they quote an old record at you, the command defangs the field form for
  you — do not hand-edit the brief afterwards.)
- **Attachments belong to parts, not to the batch.** A screenshot of a broken panel goes
  in the panel todo. If you cannot tell, put it in the first part and say so.
- The command reports `missingAttachments` for a path that was not there — tell them
  plainly which file did not travel.
- If a command answers with `{ "error": … }`, tell them what it said in plain words and
  stop. Do not retry the same call unchanged.
- **Never write the folder by hand.** The batch rules, the numbering, the brief's shape
  and the attachment placement all live in the command; a hand-made folder drifts and can
  break `novadev sync`.
- Keep every message short. They are often on a phone, in the middle of something else.
