// `novadev todo` — one todo at a time, for a person (or an agent acting for one) away from the repository:
//
//   novadev todo list [--state open,progress,…] [--json]   the open todos with their titles and states
//   novadev todo show <ref>                                  one todo as JSON: its brief and its records
//   novadev todo addendum <ref> <payload.json>               {text}: a "Chat addendum" appended to the brief
//   novadev todo cancel <ref> <payload.json>                 {reason}: an ai_failed.md that says *cancelled*
//
// A <ref> is how people name a todo: `2026-10-16_2/02-router-…`, `2026-10-16_2/02`, or a word of its slug that only one
// open todo has. The two writes follow the playbook's intake rules: a todo with a terminal record, or one waiting on a
// human test, gets a NEW todo rather than an addendum; a batch an agent holds right now is not written behind its back.
// Answers are JSON on stdout; errors are `{ "error": … }` with a non-zero exit (as `test-result` and `file-todo`).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  RECORD_COMPLETED,
  RECORD_CONFIRMED,
  RECORD_FAILED,
  RECORD_NEEDSTEST,
  RECORD_PROGRESS,
  TERMINAL_STATES,
  type TodoState,
  listDirs,
  novadevDir,
  requireProjectRoot,
  todoState,
} from './lib.ts';
import { lockLiveness, readWorkLock } from './work.ts';

const PROMPT = 'prompt.md';
const RECORDS = [RECORD_NEEDSTEST, RECORD_CONFIRMED, RECORD_COMPLETED, RECORD_FAILED, RECORD_PROGRESS] as const;
const MAX_RECORD_CHARS = 12000;
const MAX_TEXT_BYTES = 20000;
const USAGE =
  'usage: novadev todo list [--state open,progress,needstest,…] [--json]\n' +
  '       novadev todo show <ref>\n' +
  '       novadev todo addendum <ref> <payload.json>   ({ "text": … })\n' +
  '       novadev todo cancel <ref> <payload.json>     ({ "reason": … })';

export type TodoItem = { ref: string; batch: string; todo: string; title: string; state: TodoState };

/** The brief's title: its first `## ` heading (the filed form), else the first line that says something. */
export function briefTitle(text: string): string {
  const h2 = text.match(/^##\s+(.+)$/m)?.[1];
  if (h2) return h2.trim();
  const line = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l !== '' && !/^prompt\s+—/i.test(l) && !l.startsWith('**Source:**'));
  return line ?? '';
}

/** Every todo of the open batches, oldest batch first. */
export function listTodos(nd: string): TodoItem[] {
  const out: TodoItem[] = [];
  for (const batch of listDirs(join(nd, 'todos'))) {
    for (const todo of listDirs(join(nd, 'todos', batch))) {
      const dir = join(nd, 'todos', batch, todo);
      const prompt = join(dir, PROMPT);
      out.push({ ref: `${batch}/${todo}`, batch, todo, title: existsSync(prompt) ? briefTitle(readFileSync(prompt, 'utf8')) : '', state: todoState(dir) });
    }
  }
  return out;
}

/** The one open todo a person means; an error that lists the candidates when it is not one. */
export function resolveTodo(nd: string, ref: string): TodoItem {
  const want = ref.trim().replace(/^todos\//, '').replace(/\/+$/, '');
  if (want === '') throw new Error('Name a todo: <batch>/<todo>, <batch>/<NN>, or a word of its slug.');
  const all = listTodos(nd);
  const exact = all.find((t) => t.ref === want);
  if (exact) return exact;
  const [batch, part] = want.split('/');
  let hits = part !== undefined ? all.filter((t) => t.batch === batch && (t.todo.startsWith(`${part}-`) || t.todo === part || t.todo.startsWith(part))) : [];
  if (part === undefined) {
    const word = want.toLowerCase();
    hits = all.filter((t) => t.todo.toLowerCase().includes(word) || t.title.toLowerCase().includes(word));
  }
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0) throw new Error(`No open todo matches "${ref}" (archived todos are not open).`);
  throw new Error(`"${ref}" matches ${hits.length} todos: ${hits.slice(0, 8).map((t) => t.ref).join(', ')}${hits.length > 8 ? ' …' : ''}`);
}

/** One todo: its brief, its state, its records (long ones cut), and whether its batch is in work. */
export function showTodo(nd: string, ref: string, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  const dir = join(nd, 'todos', t.batch, t.todo);
  const records: Record<string, string> = {};
  for (const file of RECORDS) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    records[file] = text.length > MAX_RECORD_CHARS ? `${text.slice(0, MAX_RECORD_CHARS)}\n… (cut: ${text.length} characters)` : text;
  }
  const lock = readWorkLock(nd, t.batch);
  const inWork =
    lock === null ? null : lock.state === 'invalid' ? { state: 'unreadable' } : { state: lock.lock.state, live: lockLiveness(lock.lock, now).live, agent: lock.lock.agent, todo: lock.lock.todo, updated: lock.lock.updated };
  return { ...t, brief: existsSync(join(dir, PROMPT)) ? readFileSync(join(dir, PROMPT), 'utf8') : '', records, batchInWork: inWork, files: listFilesIn(dir) };
}

function listFilesIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile()).sort();
}

/** Refuse a write the playbook routes elsewhere: a finished or test-waiting todo, a batch someone holds now. */
function writable(nd: string, t: TodoItem, what: string, now: Date): void {
  if (t.state === 'needstest') throw new Error(`${t.ref} is waiting on a human test: ${what} would be new work — file a NEW todo (novadev file-todo) and cross-link it.`);
  if ((TERMINAL_STATES as readonly string[]).includes(t.state)) throw new Error(`${t.ref} already has a terminal record (${t.state}): file a NEW todo for this (novadev file-todo).`);
  const lock = readWorkLock(nd, t.batch);
  if (lock !== null && lock.state === 'ok' && lock.lock.state === 'working' && lockLiveness(lock.lock, now).live) {
    throw new Error(`${t.batch} is in work right now (${lock.lock.agent}): tell that session, or try again when it pauses or stops.`);
  }
}

const today = (now: Date) => {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
};

function body(text: unknown, key: string): string {
  if (typeof text !== 'string' || text.trim() === '') throw new Error(`The payload needs a '${key}'.`);
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error(`That ${key} is too large to record.`);
  return text.trim();
}

/** A "Chat addendum" — the playbook's way a later word from the person joins an open todo's brief. */
export function addAddendum(nd: string, ref: string, payload: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  writable(nd, t, 'an addendum', now);
  const text = body(payload['text'], 'text');
  const by = typeof payload['by'] === 'string' && payload['by'].trim() !== '' ? ` (${payload['by'].trim()})` : '';
  const path = join(nd, 'todos', t.batch, t.todo, PROMPT);
  const before = existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : `# prompt — ${t.todo}`;
  writeFileSync(path, `${before}\n\n**Chat addendum, ${today(now)}${by}:** ${text}\n`);
  return { ref: t.ref, written: `todos/${t.ref}/${PROMPT}` };
}

/** The person decided against it: an ai_failed.md of the *cancelled* kind, so the batch can close. */
export function cancelTodo(nd: string, ref: string, payload: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  writable(nd, t, 'a cancellation', now);
  const reason = body(payload['reason'], 'reason');
  const by = typeof payload['by'] === 'string' && payload['by'].trim() !== '' ? payload['by'].trim() : 'the person';
  const path = join(nd, 'todos', t.batch, t.todo, RECORD_FAILED);
  writeFileSync(
    path,
    `# ai_failed — ${t.todo}\n\n**Date:** ${today(now)}\n**Feature:** none — cancelled before any work\n\n## Prompt\n${t.title || t.todo}\n\n` +
      `## What happened\n*cancelled* — ${by} decided not to do it.\n\n## Placement\nnothing new placed\n\n## Decisions\n${reason}\n`,
  );
  return { ref: t.ref, written: `todos/${t.ref}/${RECORD_FAILED}`, state: 'failed' };
}

function readPayload(argument: string | undefined): Record<string, unknown> {
  if (argument === undefined) throw new Error(USAGE);
  const path = isAbsolute(argument) ? argument : resolve(process.cwd(), argument);
  if (!existsSync(path)) throw new Error(`No payload file at ${path}.`);
  const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The payload must be a JSON object.');
  return payload as Record<string, unknown>;
}

export function todoCommand(args: string[]): void {
  const [command, ref, argument] = args;
  const nd = novadevDir(requireProjectRoot());
  const json = args.includes('--json');
  try {
    if (command === 'list' || command === undefined) {
      const at = args.indexOf('--state');
      const states = at !== -1 ? (args[at + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
      const todos = listTodos(nd).filter((t) => states.length === 0 || states.includes(t.state));
      if (json) {
        console.log(JSON.stringify({ todos }, null, 2));
        return;
      }
      if (todos.length === 0) console.log('todos — none open');
      for (const t of todos) console.log(`${t.ref}  (${t.state})${t.title ? `  ${t.title}` : ''}`);
      return;
    }
    if (ref === undefined) throw new Error(USAGE);
    if (command === 'show') return void console.log(JSON.stringify(showTodo(nd, ref), null, 2));
    if (command === 'addendum') return void console.log(JSON.stringify(addAddendum(nd, ref, readPayload(argument)), null, 2));
    if (command === 'cancel') return void console.log(JSON.stringify(cancelTodo(nd, ref, readPayload(argument)), null, 2));
    throw new Error(USAGE);
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}
