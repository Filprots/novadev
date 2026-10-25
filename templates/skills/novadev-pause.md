# novadev-pause — stop the loop where it is, so the next session resumes from there

<!-- managed by `novadev deploy` — local edits will be overwritten on the next deploy.
     Project-specific rules belong in the wiki (conventions page), not here. -->

The human wants to stop now: "pause", "stop here", "let's continue tomorrow", "I have to
go", "/novadev-pause" — or the session itself must end with work in flight (the context is
nearly spent, the machine is going down). Your job is to leave the batch in a state a
later session picks up WITHOUT rediscovering anything: what landed, exactly where you
stopped, what comes next, how to start again.

That later session may be a different agent, on a different machine, next week. It will
read one thing first: the **PAUSED** section at the top of the batch's lock,
`.novadev/todos/<batch>/working.md`. Write it for that reader. Ten minutes of writing
here saves an hour of re-discovery there — and a pause written in a hurry is the one that
gets resumed wrong.

**A pause is not a stop.** `novadev work stop` releases a batch whose round is over.
`novadev work pause` keeps the lock, marks it paused, and writes the resume point. When
work remains — a todo half done, a record unwritten, a knowledge change not yet recorded
— it is always a pause.

## What you may do, and what you may not

1. **Finish the step you are in** only if it is seconds away (the file you are saving,
   the test that is running). Otherwise stop where you are. Do not "quickly finish the
   todo" — a pause asked for is a pause now.
2. **Write the todo's own record** for work that landed (step 2 below). The record is
   the history; the lock is transient.
3. **Write the pause** through the command (step 3). Never edit `working.md` by hand.
4. **Offer a commit** of the work in progress; never make one without a yes on the
   default branch, and never `push`, `merge` or rewrite history (the loop's limits hold).

You may **NOT** release the lock (`novadev work stop`) when work remains, archive
anything, or mark a todo finished that is not. And never claim a record or a pause you
did not write: if a command errored, say so.

## The loop

**1. Know what you hold.** You know which batch you took with `novadev work start`. If
in doubt, `novadev status` lists the batches in work and who holds them; `novadev sync`
does too. A session that holds several locks pauses each one it is leaving mid-way.

**2. Record the work first.** For the todo you are in the middle of, write or update
`ai_progress.md` the way `/novadev-work` phase 4 says: what is done, what is next, how
to resume, a `## Placement` section for what landed. If a terminal record is half-written,
finish it only if the work it describes is really finished; otherwise it is `ai_progress.md`.
If you learned something that cost time, write the memory now (phase 8) — a pause is
exactly when such things get lost. What belongs to the WORK goes in the records and the
knowledge, where it outlives the lock; the pause record is the map back to it.

**3. Write the pause.** The payload is a JSON file — the content is multi-line prose,
and quoting that through a shell is how it gets mangled:

```sh
payload=$(mktemp -t novadev-pause.XXXXXX.json)   # or your session's own scratch dir
cat > "$payload" <<'JSON'
{ "todo": "02-dark-mode", "phase": 3,
  "stopped": "…exactly where: the todo, the step within it, the file and function, what was being tried, what the last test run said, what is half-written…",
  "next": ["…the first thing to do when resuming…", "…then…", "…then…"],
  "done": "…what landed in this session, per todo: records written, commits made, scenarios filed…",
  "resume": "…what to read and run first: the branch, the servers to start, the exact commands, the records to open…",
  "open": "…questions and decisions waiting on the human, and chat decisions not recorded anywhere else — or omit…" }
JSON
novadev work pause 2026-10-24_1 "$payload"
```

- `stopped` — **exactly** where. Not "working on dark mode" but "in `src/theme.ts`,
  `applyTheme()` reads the tokens; the toggle in `Header.tsx` is wired but the body class
  never flips — I was about to check whether `useTheme` is called outside the provider.
  `bun test` is green except `theme.test.ts` (2 failures, expected: the toggle)". Say what
  is half-written and what is untested. The next session trusts this line more than
  anything else in the file.
- `next` — the steps, in order, each one concrete enough to start on without thinking.
  Include the bookkeeping that remains: the record to finish, the knowledge to record, the
  test task to file, the `novadev sync` close-out.
- `done` — what landed, with the evidence: the records you wrote, the commits (hashes),
  the test tasks filed, the knowledge events recorded. A resumer must not redo it.
- `resume` — the way back in: the branch, the servers or services that must run, the
  commands to run first, the files to open, and anything environment-specific (a token
  that must be set, a device that must be plugged in).
- `open` — questions you were going to ask, decisions settled in chat that no record holds
  yet, anything the human said that changes the plan. A pause loses the conversation;
  this field keeps the parts of it that matter.
- `todo` and `phase` say where in the batch and the loop you are (phase 3 WORK, 4 RECORD,
  …, as `/novadev-work` numbers them). Omit them only when nothing changed since your
  last waypoint.

The command adds what it can see on its own: the branch and the last commit, every
uncommitted path, and the state of each todo in the batch at the moment of the pause.
That is how the resumer checks whether anything moved in between.

**4. Offer the commit.** If the working tree holds uncommitted work, say so, with the
files, and offer a commit of the work in progress on the current branch (a plain "wip:
…" message naming the todo is fine) — recommend it, because an uncommitted tree is one
`git checkout` away from lost work. Wait for the yes; the lock file goes in the same
commit. On the default branch, this is the ask the loop requires anyway. If they decline,
the pause record already lists the uncommitted paths; say that a resumer will find them.

**5. Report, briefly.** One short message: where you stopped (the todo, one line), what
landed, what is waiting on them, and the sentence that matters: *Paused — `/novadev-work`
resumes it from `.novadev/todos/<batch>/working.md`.* Nothing else is needed from them.

## Rules

- **Write for a stranger.** The resumer may be another agent with none of this
  conversation. Names, paths, commands, hashes — never "the thing we discussed".
- **Never pause a batch you did not record.** Step 2 before step 3, always.
- **Never stop instead of pausing** when work remains. A stop drops the resume point.
- **Never edit `working.md` by hand**, and never write the pause into `ai_progress.md`
  instead: the record says what the WORK is at; the pause says where the SESSION stopped.
  The two point at each other.
- **Never edit `.novadev/knowledge/` as part of pausing** beyond what phase 8 of the loop
  already asked for (a memory for what cost time, recorded with `novadev knowledge log`).
- If the command answers with `{ "error": … }`, say what it said in plain words and fix the
  payload. Do not retry the same call unchanged. A batch that is "not in work" was never
  started or was already released — then there is no lock to pause; say so and write the
  resume point into the todo's `ai_progress.md` instead.
- Keep every message short. They are leaving.
