// A todo's own settings — its priority, and the todos it waits for — kept in the todo folder:
//
//   todos/<batch>/<todo>/todo.json
//   {
//     "priority": "urgent",                              urgent | high | normal | later; absent = normal
//     "after": ["2026-11-12_2/05-todo-priority"],        the todos it waits for (todo-links.ts); absent = none
//     "history": [                                       every change, oldest first: who, when, from → to, why
//       { "at": "2026-11-12T15:02:11+01:00", "by": "human:filipp", "change": "priority",
//         "from": "normal", "to": "urgent", "reason": "Board on IRR-260: production is down." }
//     ]
//   }
//
// A todo without the file — every todo filed before it existed — is `normal` and waits for nothing: there
// is nothing to migrate. The file is JSON rather than lines in the brief because novadev reads fields at the
// start of any line of any brief (`**Feature:**`), and a person quoting a test scenario's `**Priority:**
// critical` into a request must not be able to change a todo's priority, or break `novadev sync`, by
// accident. It is written by `novadev file-todo` (a part's `priority` and `after`) and by `novadev todo
// priority|after`, never by hand; a file novadev cannot read is a problem `sync` and `doctor` name, and the
// todo then reads as `normal` with no links. Keys novadev does not know are kept as they are.
//
// Priority orders every queue: `novadev todo list`, `novadev status` (and `--json`), sync's NEXT ACTIONS —
// urgent first, then high, normal, later, and inside one level the filing order (batch, then todo). A
// change of priority is a person's decision: `novadev todo priority` records who made it and when.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { humanActor } from './knowledge-log.ts';
import { type TodoState, isPlainObject, listDirs } from './lib.ts';
import { actorKind, nowTimestamp } from './okf.ts';

export const TODO_META_FILE = 'todo.json';
/** Highest first: the order every queue uses. */
export const PRIORITIES = ['urgent', 'high', 'normal', 'later'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const DEFAULT_PRIORITY: Priority = 'normal';
const MAX_REASON_CHARS = 2000;

/** One recorded change of a todo's settings. `by` is null only for a filing that named nobody. */
export type MetaChange = { at: string; by: string | null; change: string; from?: unknown; to?: unknown; reason?: string };

export type TodoMeta = {
  priority: Priority;
  /** Refs of the todos this one waits for, `<batch>/<todo folder>`. */
  after: string[];
  history: MetaChange[];
  /** The file as it was read — unknown keys included — or null when there is none. */
  raw: Record<string, unknown> | null;
  /** Why the file, or one of its values, could not be read; null when all of it could. */
  error: string | null;
};

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

/** A priority as a person writes it (`Urgent`, ` HIGH `); null when it is none of the four. */
export function parsePriority(value: unknown): Priority | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isPriority(text) ? text : null;
}

/** 0 for urgent … 3 for later. */
export function priorityRank(priority: Priority): number {
  return PRIORITIES.indexOf(priority);
}

/** Sort order of two priorities: the higher one first. */
export function comparePriority(a: Priority, b: Priority): number {
  return priorityRank(a) - priorityRank(b);
}

/**
 * A todo's settings. Never throws: a missing file is the defaults, and so is every value novadev cannot
 * read — `error` then says which, so `sync` and `doctor` can name it.
 */
export function readTodoMeta(todoDir: string): TodoMeta {
  const out: TodoMeta = { priority: DEFAULT_PRIORITY, after: [], history: [], raw: null, error: null };
  const path = join(todoDir, TODO_META_FILE);
  if (!existsSync(path)) return out;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ...out, error: 'it is not valid JSON (a merge conflict?)' };
  }
  if (!isPlainObject(data)) return { ...out, error: 'it must be a JSON object' };
  out.raw = data;
  const errors: string[] = [];
  if (data.priority !== undefined) {
    const priority = parsePriority(data.priority);
    if (priority === null) errors.push(`"priority" must be one of ${PRIORITIES.join(', ')}`);
    else out.priority = priority;
  }
  if (data.after !== undefined) {
    if (!Array.isArray(data.after) || data.after.some((ref) => typeof ref !== 'string' || ref.trim() === '')) errors.push('"after" must be a list of todo refs, like ["2026-11-12_2/05-todo-priority"]');
    else out.after = [...new Set((data.after as string[]).map((ref) => ref.trim()))];
  }
  if (data.history !== undefined) {
    if (!Array.isArray(data.history)) errors.push('"history" must be a list');
    else out.history = data.history.filter((entry): entry is MetaChange => isPlainObject(entry) && typeof entry.at === 'string' && typeof entry.change === 'string');
  }
  out.error = errors.length > 0 ? errors.join('; ') : null;
  return out;
}

/** A todo's priority: `normal` when it has no todo.json, or one novadev cannot read. */
export function todoPriority(todoDir: string): Priority {
  return readTodoMeta(todoDir).priority;
}

/**
 * Write a todo's settings: the known keys first, in one order, then whatever else the file held. A value
 * the file held that novadev could not read is replaced by what `meta` says.
 */
export function writeTodoMeta(todoDir: string, meta: Pick<TodoMeta, 'priority' | 'after' | 'history' | 'raw'>): void {
  const { priority: _p, after: _a, history: _h, ...rest } = meta.raw ?? {};
  const data: Record<string, unknown> = {
    // Written out once it was ever set, so the file says "normal" after a change back to it.
    ...(meta.priority !== DEFAULT_PRIORITY || meta.raw?.priority !== undefined || meta.history.some((h) => h.change === 'priority') ? { priority: meta.priority } : {}),
    ...(meta.after.length > 0 ? { after: meta.after } : {}),
    history: meta.history,
    ...rest,
  };
  writeFileSync(join(todoDir, TODO_META_FILE), `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Who decided something, from a payload's `by` or a `--by` option: an actor as it is, or `human` for the
 * person git knows. `personOnly` refuses an agent: the decision is a person's, and an agent acting for them
 * names them.
 */
export function resolveActor(root: string, raw: unknown, opts: { personOnly: boolean; what: string }): string {
  const by = typeof raw === 'string' ? raw.trim() : '';
  const form = 'human:<id>, or "human" for git\'s user.name';
  if (by === '') throw new Error(`Say who ${opts.what}: "by" in the payload, or --by <actor> — ${opts.personOnly ? form : `${form}, or an agent's actor (claude-code/<model>)`}.`);
  if (by === 'human') {
    const human = humanActor(root);
    if (human === null) throw new Error('"human" needs git\'s user.name — set it, or write human:<id>.');
    return human;
  }
  const kind = actorKind(by);
  if (kind === null) throw new Error(`"${by}" is not an actor — write ${form}${opts.personOnly ? '' : ", or an agent's actor (claude-code/<model>)"}.`);
  if (opts.personOnly && kind !== 'human') {
    throw new Error(`"${by}" is not a person. Name the person who ${opts.what} (${form}) and quote what they said in "reason": this is a person's decision, never an agent's own.`);
  }
  return by;
}

/** A reason as it is recorded: one line, or absent. */
export function reasonText(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') throw new Error("'reason' must be text.");
  const text = raw.replace(/\s*\n\s*/g, ' ').trim();
  if (text.length > MAX_REASON_CHARS) throw new Error('That reason is too long to record — keep it to a few lines.');
  return text === '' ? undefined : text;
}

/** States that end a todo for good: its priority and its links no longer matter. */
const OVER: readonly TodoState[] = ['confirmed', 'completed', 'failed'];

/**
 * Change a todo's priority, on a person's decision: the new level in todo.json, and who decided, when and
 * why in its history. A level it already has changes nothing. Refused on a finished todo.
 */
export function changePriority(
  todo: { ref: string; dir: string; state: TodoState },
  level: unknown,
  who: { by: string; reason?: string },
  now: Date = new Date(),
): Record<string, unknown> {
  const to = parsePriority(level);
  if (to === null) throw new Error(`A priority is one of ${PRIORITIES.join(', ')} — not "${String(level ?? '')}".`);
  if (OVER.includes(todo.state)) throw new Error(`${todo.ref} is finished (${todo.state}): its priority no longer orders anything. New work gets a new todo (novadev file-todo).`);
  const meta = readTodoMeta(todo.dir);
  if (meta.error !== null && meta.raw === null) throw new Error(`todos/${todo.ref}/${TODO_META_FILE} cannot be read: ${meta.error} — fix it, or delete it, then set the priority again.`);
  const from = meta.priority;
  if (from === to) return { ref: todo.ref, priority: to, changed: false, written: null };
  meta.history.push({ at: nowTimestamp(now), by: who.by, change: 'priority', from, to, ...(who.reason !== undefined ? { reason: who.reason } : {}) });
  writeTodoMeta(todo.dir, { ...meta, priority: to });
  return { ref: todo.ref, priority: to, from, changed: true, by: who.by, written: `todos/${todo.ref}/${TODO_META_FILE}` };
}

/** What a filing writes: the part's priority and links, with one history entry saying it was filed so. */
export function writeFiledMeta(todoDir: string, set: { priority: Priority; after: readonly string[] }, by: string | null, now: Date = new Date()): void {
  if (set.priority === DEFAULT_PRIORITY && set.after.length === 0) return;
  const entry: MetaChange = {
    at: nowTimestamp(now),
    by,
    change: 'filed',
    to: { ...(set.priority !== DEFAULT_PRIORITY ? { priority: set.priority } : {}), ...(set.after.length > 0 ? { after: [...set.after] } : {}) },
  };
  writeTodoMeta(todoDir, { priority: set.priority, after: [...set.after], history: [entry], raw: null });
}

/** Sort by priority, highest first; inside one level the order the list came in (the filing order) is kept. */
export function orderByPriority<T>(items: readonly T[], priorityOf: (item: T) => Priority): T[] {
  return items
    .map((item, index) => ({ item, index, rank: priorityRank(priorityOf(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * The open batches in the order `novadev status` shows them, by the best priority among their unfinished
 * todos: a batch with an urgent todo to do comes first, one with only `later` work left comes last, and
 * batches of the same level keep their date order. A batch with nothing left to do counts as normal.
 */
export function batchesByPriority(todosDir: string, stateOf: (todoDir: string) => TodoState): string[] {
  const best = (batch: string): Priority => {
    let top: Priority = DEFAULT_PRIORITY;
    let any = false;
    for (const todo of listDirs(join(todosDir, batch))) {
      const dir = join(todosDir, batch, todo);
      if (OVER.includes(stateOf(dir))) continue;
      const priority = todoPriority(dir);
      if (!any || comparePriority(priority, top) < 0) top = priority;
      any = true;
    }
    return any ? top : DEFAULT_PRIORITY;
  };
  return orderByPriority(listDirs(todosDir), best);
}

/** `, urgent` after a state in a list line — nothing for a normal todo, so old projects print as before. */
export function priorityTag(priority: Priority): string {
  return priority === DEFAULT_PRIORITY ? '' : `, ${priority}`;
}

/** ` [urgent]` after a ref in a sentence — nothing for a normal todo. */
export function priorityLabel(priority: Priority): string {
  return priority === DEFAULT_PRIORITY ? '' : ` [${priority}]`;
}

/** The problems of the todo.json files of the open todos: one novadev cannot read, in part or whole. */
export function auditTodoMeta(nd: string): { problems: string[] } {
  const problems: string[] = [];
  const todos = join(nd, 'todos');
  for (const batch of listDirs(todos)) {
    for (const todo of listDirs(join(todos, batch))) {
      const meta = readTodoMeta(join(todos, batch, todo));
      if (meta.error === null) continue;
      problems.push(
        `todos/${batch}/${todo}/${TODO_META_FILE}: ${meta.error} — fix it, or delete it; until then ${meta.raw === null ? 'the todo reads as priority normal, with no "do after" links' : 'that value reads as its default'}. It is written by \`novadev todo priority\` and \`novadev todo after\`, never by hand.`,
      );
    }
  }
  return { problems };
}
