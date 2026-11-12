// The merge queue's state (0.18.0): which worktrees wait to be merged, in what order, and the one
// lock that lets a single merge run at a time. It lives beside the registry, in the common git dir
// (`<git common dir>/novadev/queue.json`, `queue.lock`), so every worktree of the clone sees it and
// nothing of it is ever committed. The commands are `novadev worktree queue …` (src/worktree.ts).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { isPlainObject } from './lib.ts';
import { registryDir } from './registry.ts';

/** `queued` waits for its turn; `failed` went back to its builder with a reason and waits to be queued again. */
export type QueueEntry = {
  name: string;
  state: 'queued' | 'failed';
  /** When it was (last) queued, ISO. */
  added: string;
  /** Who queued it (an actor), when said. */
  by: string | null;
  /** The express lane: ahead of every normal entry (`queue add --express`). */
  express: boolean;
  reason?: string;
  failedAt?: string;
};

const QUEUE_FILE = 'queue.json';
const LOCK_FILE = 'queue.lock';
/** A lock this old is nobody's: no merge with its checks runs for half a day. */
const LOCK_STALE_MS = 12 * 60 * 60 * 1000;

function asEntry(value: unknown): QueueEntry | null {
  if (!isPlainObject(value) || typeof value.name !== 'string' || (value.state !== 'queued' && value.state !== 'failed')) return null;
  return {
    name: value.name,
    state: value.state,
    added: typeof value.added === 'string' ? value.added : '',
    by: typeof value.by === 'string' ? value.by : null,
    express: value.express === true,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(typeof value.failedAt === 'string' ? { failedAt: value.failedAt } : {}),
  };
}

/** The queue as it was written, oldest first; [] outside git or when there is none. */
export function readQueue(root: string): QueueEntry[] {
  const dir = registryDir(root);
  if (dir === null || !existsSync(join(dir, QUEUE_FILE))) return [];
  try {
    const value: unknown = JSON.parse(readFileSync(join(dir, QUEUE_FILE), 'utf8'));
    const entries = isPlainObject(value) && Array.isArray(value.entries) ? value.entries : [];
    return entries.map(asEntry).filter((entry): entry is QueueEntry => entry !== null);
  } catch {
    return [];
  }
}

export function writeQueue(root: string, entries: readonly QueueEntry[]): void {
  const dir = registryDir(root);
  if (dir === null) throw new Error('The merge queue needs a git repository.');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, QUEUE_FILE), `${JSON.stringify({ entries }, null, 2)}\n`);
}

/** The order merges run in: the express lane first, then first in, first out. Failed entries keep their place in the list but never run. */
export function queueOrder(entries: readonly QueueEntry[]): QueueEntry[] {
  const waiting = entries.filter((entry) => entry.state === 'queued');
  return [...waiting.filter((entry) => entry.express), ...waiting.filter((entry) => !entry.express)];
}

export type QueueLock = { host: string; pid: number; at: string; what: string };

function readLock(path: string): QueueLock | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isPlainObject(value) || typeof value.pid !== 'number') return null;
    return { host: typeof value.host === 'string' ? value.host : '', pid: value.pid, at: typeof value.at === 'string' ? value.at : '', what: typeof value.what === 'string' ? value.what : '' };
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsDead(lock: QueueLock | null, now: Date): boolean {
  if (lock === null) return true;
  if (lock.host === hostname() && !alive(lock.pid)) return true;
  const at = Date.parse(lock.at);
  return Number.isNaN(at) || now.getTime() - at > LOCK_STALE_MS;
}

/** The merge running now in any worktree of the clone, or null. */
export function queueLockHolder(root: string, now: Date = new Date()): QueueLock | null {
  const dir = registryDir(root);
  if (dir === null || !existsSync(join(dir, LOCK_FILE))) return null;
  const lock = readLock(join(dir, LOCK_FILE));
  return lockIsDead(lock, now) ? null : lock;
}

/**
 * Run `fn` as THE merge of this clone: one at a time, whichever worktree asks. A lock whose process
 * is gone (this host) or that is half a day old is taken over; a live one refuses.
 */
export function withQueueLock<T>(root: string, what: string, fn: () => T, now: Date = new Date()): T {
  const dir = registryDir(root);
  if (dir === null) throw new Error('A merge needs a git repository.');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, LOCK_FILE);
  const mine: QueueLock = { host: hostname(), pid: process.pid, at: now.toISOString(), what };
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(path, `${JSON.stringify(mine, null, 2)}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const theirs = readLock(path);
      if (attempt === 0 && lockIsDead(theirs, now)) {
        rmSync(path, { force: true });
        continue;
      }
      throw new Error(
        `One merge at a time: ${theirs?.what || 'a merge'} is running (pid ${theirs?.pid ?? '?'} on ${theirs?.host || '?'}, since ${theirs?.at || '?'}). Wait for it — \`novadev worktree queue list\` shows the queue.`,
      );
    }
  }
  try {
    return fn();
  } finally {
    const still = readLock(path);
    if (still !== null && still.pid === mine.pid && still.host === mine.host) rmSync(path, { force: true });
  }
}
