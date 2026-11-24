// A todo's recipient at work: who may start a todo that is addressed, how it is re-addressed, and what
// `sync` and `doctor` say about it.
//
//   todos/<batch>/<todo>/todo.json   { "recipient": "hq" }   (todo-meta.ts; the names: recipients.ts)
//
// Written by `novadev file-todo` (a part's `recipient`) and by `novadev todo recipient <ref> <name>`
// (`--clear` makes the todo anyone's again). The rules, in one place because several commands must agree
// on them:
// - A todo WITHOUT a recipient is anyone's: nothing here applies to it, and a project that addresses no
//   todo prints and behaves as it did before recipients existed.
// - Only the RECIPIENT starts an addressed todo. `novadev work start` refuses anybody else
//   (`refuseOthersTodos`, called by work.ts) and says who it is for. Who starts is the `--agent` actor: it
//   answers to the recipient when it is that actor, or an actor of that team (`hq/…` for `hq`). A start
//   that names nobody is refused on an addressed todo. A person (`human:<id>`) is never refused: the
//   project is theirs, and the lock says they took it.
// - A start that covers several todos — a whole batch, or `--todo a --todo b` — applies the rule to each
//   todo it covers that is still to be worked. A finished todo, or one waiting on a test, a review or a
//   merge, is not being started and is not judged.
// - RE-ADDRESSING is anyone's to do and always recorded: who, when, from whom to whom, and why when they
//   said. It is how a todo that reached the wrong recipient moves on, and the only way somebody else may
//   take an addressed todo. Not refused behind a lock, and refused on a finished todo.
// - `sync` lists the addressed todos that are still to be worked apart from NEXT ACTIONS: they are their
//   recipient's work, not whoever runs sync. A todo addressed to a name the project's `"recipients"` does
//   not list (the list changed after it was filed) is a NEXT ACTION: nobody will pick it up.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type TodoState, listDirs, todoState } from './lib.ts';
import { actorKind, nowTimestamp } from './okf.ts';
import { RECIPIENTS_SETTING, answersTo, auditRecipientsSetting, isTeam, readRecipients, recipientsText } from './recipients.ts';
import { type MetaChange, TODO_META_FILE, orderByPriority, priorityLabel, readTodoMeta, writeTodoMeta } from './todo-meta.ts';

/** States in which a todo can be started, or gone on with. */
const WORKABLE: readonly string[] = ['open', 'progress', 'changes'];
/** States that end a todo for good: its recipient no longer matters. */
const OVER: readonly string[] = ['completed', 'confirmed', 'failed'];

/** `hq/<your name>` for a team, the actor itself otherwise: what a start by the recipient passes as `--agent`. */
export function actorHint(recipient: string): string {
  return isTeam(recipient) ? `${recipient}/<your name>` : recipient;
}

/** Who addressed a todo to its current recipient, and when: the newest history entry that set it. Null when none says. */
export function addressedBy(history: readonly MetaChange[], recipient: string): { by: string | null; at: string } | null {
  for (const entry of [...history].reverse()) {
    const to = entry.change === 'recipient' ? entry.to : entry.change === 'filed' && typeof entry.to === 'object' && entry.to !== null ? (entry.to as Record<string, unknown>).recipient : undefined;
    if (to === recipient) return { by: typeof entry.by === 'string' ? entry.by : null, at: entry.at };
  }
  return null;
}

/**
 * Address a todo to a recipient, or — `to` null — to anyone again: the new value in todo.json, and who
 * did it, when and why in its history. The recipient it already has changes nothing. Refused on a
 * finished todo.
 */
export function changeRecipient(
  todo: { ref: string; dir: string; state: TodoState },
  to: string | null,
  who: { by: string; reason?: string },
  now: Date = new Date(),
): Record<string, unknown> {
  if (OVER.includes(todo.state)) throw new Error(`${todo.ref} is finished (${todo.state}): there is nothing left in it to address. New work gets a new todo (novadev file-todo).`);
  const meta = readTodoMeta(todo.dir);
  if (meta.error !== null && meta.raw === null) throw new Error(`todos/${todo.ref}/${TODO_META_FILE} cannot be read: ${meta.error} — fix it, or delete it, then set the recipient again.`);
  // A value in the file that is no name reads as "no recipient" and is still there: it is what is replaced.
  const held = meta.raw?.recipient;
  const unreadable = meta.recipient === null && held !== undefined && held !== null;
  const from = unreadable ? String(held) : meta.recipient;
  if (meta.recipient === to && !unreadable) return { ref: todo.ref, recipient: to, changed: false, written: null };
  meta.history.push({ at: nowTimestamp(now), by: who.by, change: 'recipient', from, to, ...(who.reason !== undefined ? { reason: who.reason } : {}) });
  const { recipient: _replaced, ...raw } = meta.raw ?? {};
  writeTodoMeta(todo.dir, { ...meta, recipient: to, raw });
  return { ref: todo.ref, recipient: to, from, changed: true, by: who.by, written: `todos/${todo.ref}/${TODO_META_FILE}` };
}

/**
 * Is this a todo whose recipient cannot be told: its todo.json cannot be read at all (a merge conflict —
 * two worktrees re-addressed it), and what is in it names a recipient? Such a todo reads as anyone's, and
 * must not be started as that. Answers why the file cannot be read, or null.
 */
export function recipientUnknown(todoDir: string): string | null {
  const meta = readTodoMeta(todoDir);
  if (meta.error === null || meta.raw !== null) return null;
  const path = join(todoDir, TODO_META_FILE);
  return existsSync(path) && /"recipient"\s*:/.test(readFileSync(path, 'utf8')) ? meta.error : null;
}

/**
 * `novadev work start`: throw when a todo the start covers is addressed to somebody else. `covers` is
 * null for the whole batch; `agent` is who starts, null when the command named nobody; `resumesBatchLock`
 * says the start goes on with a lock at the batch root this worktree already holds (the whole batch, or a
 * 0.17.0 lock on part of it) — it cannot be narrowed, so the way on is another one.
 */
export function refuseOthersTodos(nd: string, batch: string, covers: readonly string[] | null, agent: string | null, resumesBatchLock = false): void {
  if (agent !== null && actorKind(agent) === 'human') return;
  const batchDir = join(nd, 'todos', batch);
  const all = listDirs(batchDir);
  const covered = covers === null ? all : all.filter((todo) => covers.includes(todo));
  const others: { ref: string; recipient: string; since: { by: string | null; at: string } | null }[] = [];
  let mine = 0;
  for (const todo of covered) {
    const dir = join(batchDir, todo);
    if (!WORKABLE.includes(todoState(dir))) continue;
    const unknown = recipientUnknown(dir);
    if (unknown !== null) {
      throw new Error(`Not started — todos/${batch}/${todo}/${TODO_META_FILE} cannot be read (${unknown}), and it names a recipient: whose the todo is cannot be told. Fix the file first (after a merge conflict: keep one side), then start again.`);
    }
    const meta = readTodoMeta(dir);
    if (meta.recipient === null || (agent !== null && answersTo(agent, meta.recipient))) mine++;
    else others.push({ ref: `${batch}/${todo}`, recipient: meta.recipient, since: addressedBy(meta.history, meta.recipient) });
  }
  if (others.length === 0) return;
  const named = others.map((o) => `${o.ref} is addressed to ${o.recipient}${o.since !== null ? ` (${o.since.by !== null ? `by ${o.since.by}, ` : ''}${o.since.at.slice(0, 10)})` : ''}`).join('; ');
  const first = others[0]!;
  if (agent === null) {
    throw new Error(
      `Not started — ${named}. Only its recipient works an addressed todo, so say who starts: \`--agent <actor>\` (the recipient's: \`--agent ${actorHint(first.recipient)}\`). ` +
        'A todo with no recipient is anyone\'s.',
    );
  }
  throw new Error(
    `Not started — ${named}, and you are ${agent}. Only its recipient works an addressed todo: leave ${others.length === 1 ? 'it' : 'them'} to ${others.length === 1 ? 'its recipient' : 'their recipients'}. ` +
      (resumesBatchLock
        ? `The lock this worktree holds at the root of ${batch} covers ${others.length === 1 ? 'it' : 'them'} and cannot be narrowed: write down where you are (\`novadev work waypoint ${batch} <payload.json>\`), release that lock (\`novadev work stop ${batch}\`), then start your own todos by name (\`novadev work start ${batch}/<todo>\`). `
        : mine > 0
          ? `Start only the todos that are yours (\`novadev work start ${batch} --todo <nn>\`; \`novadev todo list --for ${agent},anyone\` lists them). `
          : `\`novadev todo list --for ${agent},anyone\` lists what you may take: the todos addressed to you, and the ones with no recipient. `) +
      `If you are the recipient, start it under the recipient's actor (\`--agent ${actorHint(first.recipient)}\`). When the person or the lead decided it is yours after all, it is re-addressed first, on the record: \`novadev todo recipient ${first.ref} <recipient> --by <actor>\` (\`--clear\` makes it anyone's).`,
  );
}

/** One addressed todo that is still to be worked, as `sync` lists it. */
export type AddressedTodo = { ref: string; recipient: string; state: TodoState; line: string };

/** The open todos that have a recipient and are still to be worked, the highest priority first, then in filing order. */
export function addressedTodos(nd: string): AddressedTodo[] {
  const todos = join(nd, 'todos');
  const found: (AddressedTodo & { dir: string })[] = [];
  for (const batch of listDirs(todos)) {
    for (const todo of listDirs(join(todos, batch))) {
      const dir = join(todos, batch, todo);
      const recipient = readTodoMeta(dir).recipient;
      if (recipient === null) continue;
      const state = todoState(dir);
      if (!WORKABLE.includes(state)) continue;
      const ref = `${batch}/${todo}`;
      const what = state === 'open' ? 'no record yet' : state === 'progress' ? 'mid-flight' : 'its review asked for CHANGES';
      found.push({ ref, recipient, state, dir, line: `${ref}${priorityLabel(readTodoMeta(dir).priority)} — for ${recipient}: ${what}` });
    }
  }
  return orderByPriority(found, (t) => readTodoMeta(t.dir).priority).map(({ dir: _dir, ...todo }) => todo);
}

/**
 * What `sync` and `doctor` say about recipients: a `"recipients"` setting novadev cannot read is a
 * problem; a todo still to be worked that is addressed to a name the setting does not list is an action —
 * nobody will pick it up until somebody re-addresses it.
 */
export function auditTodoRecipients(nd: string): { problems: string[]; actions: string[] } {
  const { problems } = auditRecipientsSetting(nd);
  const actions: string[] = [];
  const { known } = readRecipients(nd);
  if (known === null) return { problems, actions };
  const isKnown = (name: string) => known.some((k) => answersTo(name, k.name));
  for (const todo of addressedTodos(nd)) {
    if (isKnown(todo.recipient)) continue;
    actions.push(
      `${todo.ref} is addressed to ${todo.recipient}, which "${RECIPIENTS_SETTING}" in novadev.json does not name (${recipientsText(known)}) — nobody will pick it up. Ask who it is for, then re-address it: \`novadev todo recipient ${todo.ref} <recipient> --by <actor>\` (\`--clear\` makes it anyone's)`,
    );
  }
  return { problems, actions };
}
