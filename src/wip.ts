// The work-in-progress limit (0.18.0): finish before you start more.
//
//   "wipLimit": 2              one holder — the actor a lock records (`--agent`) — may hold at most
//                              this many unfinished todos at once. Absent, null or 0 = no limit.
//   "wipCountsPaused": false   a paused todo does not take a slot (the default: it does).
//
// A todo takes a slot while a lock holds it and it is not finished; a lock on a whole batch holds
// every unfinished todo of that batch. An URGENT todo (todo-meta.ts) never takes a slot and is
// never refused: it is the express lane. Both settings are read from the main checkout, like the
// claim policy. This module only counts; `novadev work start` (work.ts) refuses, and pauses for an
// urgent todo.
import { join } from 'node:path';
import { ruleRoot } from './claim-policy.ts';
import { type Parsed, ROOT_DIR_NAME, type TodoState, isPlainObject, novadevDir, readManifest, refuse, todoState } from './lib.ts';
import { todoPriority } from './todo-meta.ts';
import type { TodoHolder } from './work.ts';

export type WipSettings = { limit: number | null; countsPaused: boolean };

export function parseWipSettings(manifest: unknown): Parsed<WipSettings> {
  const m = isPlainObject(manifest) ? manifest : {};
  const out: WipSettings = { limit: null, countsPaused: true };
  if (m.wipLimit !== undefined && m.wipLimit !== null) {
    if (typeof m.wipLimit !== 'number' || !Number.isInteger(m.wipLimit) || m.wipLimit < 0) return refuse('"wipLimit" must be a whole number of todos one holder may have in work, like 2 (0 or absent: no limit)');
    out.limit = m.wipLimit === 0 ? null : m.wipLimit;
  }
  if (m.wipCountsPaused !== undefined && m.wipCountsPaused !== null) {
    if (typeof m.wipCountsPaused !== 'boolean') return refuse('"wipCountsPaused" must be true (a paused todo takes a slot, the default) or false');
    out.countsPaused = m.wipCountsPaused;
  }
  return { ok: true, value: out };
}

/** The project's limit. Throws on a setting that cannot be read. */
export function wipSettings(root: string): WipSettings {
  const parsed = parseWipSettings(readManifest(novadevDir(ruleRoot(root))));
  if (!parsed.ok) throw new Error(`novadev.json: ${parsed.error}`);
  return parsed.value;
}

export function auditWip(nd: string): { problems: string[] } {
  const parsed = parseWipSettings(readManifest(nd));
  return { problems: parsed.ok ? [] : [`${ROOT_DIR_NAME}/novadev.json: ${parsed.error}. Until it is fixed \`novadev work start\` is refused.`] };
}

const finished = (state: TodoState) => state === 'confirmed' || state === 'completed' || state === 'failed';

/** What one todo a lock holds means for the limit. */
export type WipSlot = 'counts' | 'urgent' | 'paused' | 'finished';

export function wipSlot(nd: string, ref: string, holder: Pick<TodoHolder, 'state'>, settings: WipSettings): WipSlot {
  const dir = join(nd, 'todos', ref);
  if (finished(todoState(dir))) return 'finished';
  if (todoPriority(dir) === 'urgent') return 'urgent';
  if (holder.state === 'paused' && !settings.countsPaused) return 'paused';
  return 'counts';
}

export type WipHolder = { agent: string; count: number; limit: number | null; atLimit: boolean; todos: string[]; urgent: string[]; pausedNotCounted: string[] };

/** Every holder's todos against the limit, busiest first — for `status`, and for `work start`. */
export function wipHolders(nd: string, settings: WipSettings, holders: ReadonlyMap<string, TodoHolder>): WipHolder[] {
  const by = new Map<string, WipHolder>();
  for (const [ref, holder] of holders) {
    const slot = wipSlot(nd, ref, holder, settings);
    if (slot === 'finished') continue;
    const entry = by.get(holder.agent) ?? { agent: holder.agent, count: 0, limit: settings.limit, atLimit: false, todos: [], urgent: [], pausedNotCounted: [] };
    if (slot === 'counts') entry.todos.push(ref);
    else if (slot === 'urgent') entry.urgent.push(ref);
    else entry.pausedNotCounted.push(ref);
    by.set(holder.agent, entry);
  }
  return [...by.values()]
    .map((h) => ({ ...h, count: h.todos.length, atLimit: settings.limit !== null && h.todos.length >= settings.limit }))
    .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent));
}
