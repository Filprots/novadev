// "Do after" links between todos: a todo names the todos it waits for, and work on it starts only once
// they are completed.
//
//   todos/<batch>/<todo>/todo.json   { "after": ["2026-11-12_2/05-todo-priority", …] }   (todo-meta.ts)
//
// Written by `novadev file-todo` (a part's `after`: refs, or the slug of another part of the same filing)
// and by `novadev todo after <ref> <ref>…` (adds links), `--clear` (removes them all; with refs: replaces
// them). A link is always stored as the full ref, `<batch>/<todo folder>`: it survives the archive move.
//
// The rules, in one place because five commands must agree on them:
// - A dependency is SATISFIED when its state is `completed` or `confirmed` — in team mode that means
//   approved and merged (review.ts), because that is when `todoState` says so. An archived completed todo
//   is satisfied. Anything else — open, in progress, waiting for a test, a review or a merge — is not.
// - A todo is READY when it can be started (open, mid-flight, or sent back by a review) and nothing it waits
//   for is unsatisfied; `todo list`, `status` and their JSON say `ready` or `waits for …`.
// - `novadev work start` refuses a todo that still waits (`refuseWaitingTodos`, called by work.ts). A start
//   that covers several todos — a whole batch, or `--todo a --todo b` — applies the rule to each todo it
//   covers that is still to be worked; a dependency INSIDE the same start is fine: one holder works them, in
//   the order the links give. A dependency outside it must be satisfied. The way to start early is to
//   remove the link (`novadev todo after <ref> --clear`), which is recorded.
// - A link to a todo that does not exist, and a cycle of todos that wait for each other, are PROBLEMS
//   (`sync` exits 1, `doctor` too): nothing in them can ever start. A link to a todo that did not land
//   (`ai_failed.md`: cancelled, deferred) is a NEXT ACTION: somebody has to decide whether the link goes.
//   Only todos that are not finished are judged: a finished todo's links no longer hold anything up.
import { join } from 'node:path';
import { type TodoRef, type TodoState, listAllTodos, listDirs, todoState } from './lib.ts';
import { nowTimestamp } from './okf.ts';
import { teamMode } from './review.ts';
import { TODO_META_FILE, readTodoMeta, writeTodoMeta } from './todo-meta.ts';

/** One todo another waits for, as it stands now. `missing`: no todo of the project has that ref. */
export type Dependency = { ref: string; state: TodoState | 'missing'; archived: boolean; satisfied: boolean };

/** What a todo's links say about it now. */
export type LinkFacts = { after: string[]; waitsFor: { ref: string; state: TodoState | 'missing' }[]; ready: boolean };

/** States in which a dependency no longer holds anybody up. */
const SATISFIED: readonly string[] = ['completed', 'confirmed'];
/** States in which a todo can be started, or gone on with. */
const WORKABLE: readonly string[] = ['open', 'progress', 'changes'];
/** States that end a todo: its links are no longer judged. */
const OVER: readonly string[] = ['completed', 'confirmed', 'failed'];

/** Every todo of the project by its ref — `todos/` and the archive; an open todo wins over an archived twin. */
export type TodoIndex = Map<string, TodoRef>;

export function todoIndex(nd: string): TodoIndex {
  const index: TodoIndex = new Map();
  for (const todo of listAllTodos(nd)) if (!index.has(todo.ref)) index.set(todo.ref, todo);
  return index;
}

/** The todos `refs` name, each with its state now. */
export function dependencies(refs: readonly string[], index: TodoIndex): Dependency[] {
  return refs.map((ref) => {
    const todo = index.get(ref);
    if (todo === undefined) return { ref, state: 'missing', archived: false, satisfied: false };
    const state = todoState(todo.dir);
    return { ref, state, archived: todo.archived, satisfied: SATISFIED.includes(state) };
  });
}

/**
 * A reader of link facts for many todos of one project: the index of all todos is built once, and only
 * when a todo with links is met — a project without links never lists its archive for this.
 */
export function linkReader(nd: string): (todoDir: string, state: TodoState) => LinkFacts {
  let index: TodoIndex | null = null;
  return (todoDir, state) => {
    const after = readTodoMeta(todoDir).after;
    if (after.length === 0) return { after, waitsFor: [], ready: WORKABLE.includes(state) };
    index ??= todoIndex(nd);
    const waitsFor = dependencies(after, index).filter((dep) => !dep.satisfied).map(({ ref, state: s }) => ({ ref, state: s }));
    return { after, waitsFor, ready: WORKABLE.includes(state) && waitsFor.length === 0 };
  };
}

/** A dependency as a list names it: its folder inside the same batch, its full ref elsewhere. */
export function depName(ref: string, batch: string): string {
  return ref.startsWith(`${batch}/`) ? ref.slice(batch.length + 1) : ref;
}

/** `, waits for 05-todo-priority` / `, ready` after a state in a list line; nothing for a finished todo. */
export function linkTag(todo: { batch: string; state: TodoState } & LinkFacts, showReady: boolean): string {
  if (OVER.includes(todo.state)) return '';
  if (todo.waitsFor.length > 0) return `, waits for ${todo.waitsFor.map((dep) => depName(dep.ref, todo.batch)).join(', ')}`;
  return showReady && todo.state === 'open' ? ', ready' : '';
}

/**
 * The todo a link names: its full ref, `<batch>/<NN>` or the start of its folder name in that batch — also
 * for an archived todo — or a word only one OPEN todo's folder has. Throws with the candidates otherwise.
 */
export function resolveLinkRef(raw: string, index: TodoIndex): string {
  const want = raw.trim().replace(/^(\.novadev\/)?todos\//, '').replace(/\/+$/, '');
  if (want === '') throw new Error('Name the todo to wait for: <batch>/<todo>, <batch>/<NN>, or a word of its slug.');
  if (index.has(want)) return want;
  const all = [...index.values()];
  const [batch, part] = want.split('/');
  const hits =
    part !== undefined
      ? all.filter((t) => t.batch === batch && (t.todo === part || t.todo.startsWith(`${part}-`) || t.todo.startsWith(part)))
      : all.filter((t) => !t.archived && t.todo.toLowerCase().includes(want.toLowerCase()));
  if (hits.length === 1) return hits[0]!.ref;
  if (hits.length === 0) throw new Error(`No todo matches "${raw}" — name it as <batch>/<todo> (an archived todo by its batch and number).`);
  throw new Error(`"${raw}" matches ${hits.length} todos: ${hits.slice(0, 8).map((t) => t.ref).join(', ')}${hits.length > 8 ? ' …' : ''}`);
}

/** The links of a todo as its todo.json has them now ([] for a ref no todo has). */
function linksOf(ref: string, index: TodoIndex): string[] {
  const todo = index.get(ref);
  return todo === undefined ? [] : readTodoMeta(todo.dir).after;
}

/**
 * A chain of links from `from` to `to` (`from → … → to`), or null when there is none. `extra` adds links
 * that are about to be written (a filing's, which are not on disk yet).
 */
export function linkPath(from: string, to: string, index: TodoIndex, extra: ReadonlyMap<string, readonly string[]> = new Map()): string[] | null {
  const seen = new Set<string>();
  const walk = (ref: string, path: string[]): string[] | null => {
    if (ref === to) return [...path, ref];
    if (seen.has(ref)) return null;
    seen.add(ref);
    for (const next of [...linksOf(ref, index), ...(extra.get(ref) ?? [])]) {
      const found = walk(next, [...path, ref]);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(from, []);
}

/**
 * Set a todo's links: add `deps` to the ones it has, or — with `clear` — replace them (no `deps`: remove
 * them all). Refused for a finished todo, a link to itself, a todo nobody has, and a link that would close
 * a cycle. The change, with who made it (when they said) and when, goes into the todo's history.
 */
export function changeAfter(
  nd: string,
  todo: { ref: string; batch: string; dir: string; state: TodoState },
  deps: readonly string[],
  opts: { clear: boolean; by: string | null },
  now: Date = new Date(),
): Record<string, unknown> {
  if (OVER.includes(todo.state)) throw new Error(`${todo.ref} is finished (${todo.state}): it waits for nothing any more.`);
  const meta = readTodoMeta(todo.dir);
  if (meta.error !== null && meta.raw === null) throw new Error(`todos/${todo.ref}/${TODO_META_FILE} cannot be read: ${meta.error} — fix it, or delete it, then set the links again.`);
  const index = todoIndex(nd);
  const named = deps.map((raw) => resolveLinkRef(raw, index)).filter((ref, i, all) => all.indexOf(ref) === i);
  if (named.includes(todo.ref)) throw new Error(`${todo.ref} cannot wait for itself.`);
  const next = opts.clear ? named : [...meta.after, ...named.filter((ref) => !meta.after.includes(ref))];
  for (const dep of named) {
    const path = linkPath(dep, todo.ref, index);
    if (path !== null) {
      throw new Error(`${todo.ref} cannot wait for ${dep}: ${dep} already waits for it (${[...path, dep].join(' → ')}), so neither could ever start. Remove that link first (\`novadev todo after <ref> --clear\`).`);
    }
  }
  const changed = next.length !== meta.after.length || next.some((ref, i) => ref !== meta.after[i]);
  if (changed) {
    meta.history.push({ at: nowTimestamp(now), by: opts.by, change: 'after', from: meta.after, to: next });
    writeTodoMeta(todo.dir, { ...meta, after: next });
  }
  const facts = linkReader(nd)(todo.dir, todo.state);
  return { ref: todo.ref, after: facts.after, waitsFor: facts.waitsFor, ready: facts.ready, changed, written: changed ? `todos/${todo.ref}/${TODO_META_FILE}` : null };
}

/**
 * The links of the parts of one filing, resolved before anything is written: an entry is the slug of
 * another part of the same filing (it becomes that part's ref), or a todo that exists. Throws on a todo
 * nobody has, a part that waits for itself, and parts that wait for each other.
 */
export function resolveFiledLinks(nd: string, parts: readonly { ref: string; slug: string; after: readonly string[] }[]): string[][] {
  if (parts.every((part) => part.after.length === 0)) return parts.map(() => []);
  const index = todoIndex(nd);
  const sibling = (raw: string): string | undefined => {
    const slug = raw.trim().toLowerCase().replace(/^\d+[-_]/, '');
    return parts.find((part) => part.slug === slug)?.ref;
  };
  const links = parts.map((part) => {
    const out: string[] = [];
    for (const raw of part.after) {
      const ref = sibling(raw) ?? resolveLinkRef(raw, index);
      if (ref === part.ref) throw new Error(`Part '${part.slug}' cannot wait for itself.`);
      if (!out.includes(ref)) out.push(ref);
    }
    return out;
  });
  const extra = new Map(parts.map((part, i) => [part.ref, links[i]!]));
  for (const [i, part] of parts.entries()) {
    for (const dep of links[i]!) {
      const path = linkPath(dep, part.ref, index, extra);
      if (path !== null) throw new Error(`Parts wait for each other (${[part.ref, ...path].join(' → ')}): none of them could ever start. Remove one 'after'.`);
    }
  }
  return links;
}

/**
 * What `sync` and `doctor` say about the links of the open, unfinished todos: a link to no todo and a cycle
 * are problems; a link to a todo that did not land is an action for whoever decides.
 */
export function auditTodoLinks(nd: string): { problems: string[]; actions: string[] } {
  const problems: string[] = [];
  const actions: string[] = [];
  const todos = join(nd, 'todos');
  let index: TodoIndex | null = null;
  /** Each unfinished todo's unsatisfied links to todos that are themselves unfinished: where a cycle can be. */
  const waiting = new Map<string, string[]>();
  for (const batch of listDirs(todos)) {
    for (const todo of listDirs(join(todos, batch))) {
      const dir = join(todos, batch, todo);
      const after = readTodoMeta(dir).after;
      if (after.length === 0 || OVER.includes(todoState(dir))) continue;
      index ??= todoIndex(nd);
      const ref = `${batch}/${todo}`;
      const open: string[] = [];
      for (const dep of dependencies(after, index)) {
        if (dep.state === 'missing') {
          problems.push(`todos/${ref}/${TODO_META_FILE}: it waits for "${dep.ref}", which is no todo of this project (not in todos/, not in the archive) — it can never start. Set its links again: \`novadev todo after ${ref} --clear [<ref>…]\``);
        } else if (dep.state === 'failed') {
          actions.push(`${ref} waits for ${dep.ref}, which did not land (ai_failed.md) — it can never start. Ask whoever decides the order, then remove or replace the link: \`novadev todo after ${ref} --clear [<ref>…]\``);
        } else if (!dep.satisfied) {
          open.push(dep.ref);
        }
      }
      waiting.set(ref, open);
    }
  }
  for (const cycle of cycles(waiting)) {
    problems.push(`"do after" links form a cycle: ${[...cycle, cycle[0]!].join(' → ')} — none of these todos can ever start. Remove one link: \`novadev todo after <ref> --clear [<ref>…]\``);
  }
  return { problems, actions };
}

/** The cycles of a graph, each once, starting at its smallest node. */
function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const found = new Map<string, string[]>();
  const done = new Set<string>();
  const walk = (node: string, path: string[]): void => {
    const at = path.indexOf(node);
    if (at !== -1) {
      const cycle = path.slice(at);
      const start = cycle.indexOf([...cycle].sort()[0]!);
      const turned = [...cycle.slice(start), ...cycle.slice(0, start)];
      found.set(turned.join('\0'), turned);
      return;
    }
    if (done.has(node)) return;
    for (const next of graph.get(node) ?? []) walk(next, [...path, node]);
    done.add(node);
  };
  for (const node of [...graph.keys()].sort()) walk(node, []);
  return [...found.values()];
}

/**
 * `novadev work start`: throw when a todo the start covers still waits. `covers` is null for the whole
 * batch. A todo that is finished, or waiting on a test, a review or a merge, is not being started and is
 * not judged; a dependency inside the same start (and not failed) is worked in the same round, in order.
 */
export function refuseWaitingTodos(nd: string, batch: string, covers: readonly string[] | null): void {
  const batchDir = join(nd, 'todos', batch);
  const all = listDirs(batchDir);
  const covered = covers === null ? all : all.filter((todo) => covers.includes(todo));
  let index: TodoIndex | null = null;
  const blocked: string[] = [];
  let ready = 0;
  for (const todo of covered) {
    const dir = join(batchDir, todo);
    if (!WORKABLE.includes(todoState(dir))) continue;
    const after = readTodoMeta(dir).after;
    if (after.length === 0) {
      ready++;
      continue;
    }
    index ??= todoIndex(nd);
    const inThisStart = (ref: string) => ref.startsWith(`${batch}/`) && covered.includes(ref.slice(batch.length + 1));
    const holding = dependencies(after, index).filter((dep) => !dep.satisfied && !(inThisStart(dep.ref) && dep.state !== 'failed' && dep.state !== 'missing'));
    if (holding.length === 0) ready++;
    else blocked.push(`${batch}/${todo} waits for ${holding.map((dep) => `${dep.ref} (${dep.state === 'missing' ? 'no such todo' : dep.state === 'failed' ? 'did not land' : dep.state})`).join(', ')}`);
  }
  if (blocked.length === 0) return;
  const refs = blocked.map((line) => line.split(' ')[0]!);
  throw new Error(
    `Not started — ${blocked.join('; ')}. A todo starts once every todo it waits for is completed${teamMode(nd) ? ' (in team mode: approved and merged)' : ''}. ` +
      (ready > 0 ? `Start only the todos that are ready (\`novadev work start ${batch} --todo <nn>\`; \`novadev todo list\` says which), or wait. ` : 'Wait for them. ') +
      `When the person or the lead decided the order no longer holds, remove the link first: \`novadev todo after ${refs[0]} --clear\`.`,
  );
}
