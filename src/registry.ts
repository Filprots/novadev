// The registry of work in progress, shared by EVERY worktree of a repository.
//
// A lock is a `working.md` (work.ts) — in a todo's folder for one todo, at a batch's root for the
// whole batch: tracked, on the branch it was taken on, so its trail and its pause record travel
// with the branch and reach any machine. But a worktree on another branch cannot see that file. So
// every `novadev work` command also writes one small entry here, in the common git folder all
// worktrees of the repository share:
//
//   <common git dir>/novadev/locks/<batch>.<todo>.json   who holds the todo, in which worktree, on
//                                                    which branch, where the work is, and the
//                                                    paths it claims (`unit: "todo"`)
//   <common git dir>/novadev/locks/<batch>.json      the same for a lock on the whole batch
//   <common git dir>/novadev/worktrees/<name>.json   a worktree `novadev worktree create` made
//                                                    (worktree.ts): its branch, its sub-repos, its
//                                                    claims, the todos it is for, what it linked in
//
// It is never committed (it lives inside .git), and it is only a mirror: the lock that counts in a
// worktree is that worktree's working.md; the registry answers "is this todo, or this batch, in
// work ELSEWHERE, and which paths does that work own?". An entry whose worktree is gone is ignored,
// and removed by the next `novadev work` command.
//
// Claims — "one owner per file". A batch in work claims the paths it will change: the ones given
// with `--claim` / `novadev work claim`, and the `touches:` of the features its todos name. A
// claim may be written `<sub-repo>:<path>` (`irrippr:ps/layouting/`), which is the sub-repo's
// folder plus the path. A worktree made by `novadev worktree create --claim` claims paths too.
// `novadev work start` refuses a batch whose claims overlap the claims of a batch in work in
// another worktree, or of another worktree; `novadev worktree create` and `novadev worktree claim`
// refuse the same. Inside a worktree novadev made, a batch claims the WORKTREE's paths (plus
// `--claim`), not its features' folders, and the paths a `novadev work` command adds there become
// the worktree's too, so the gate sees them after the lock is gone.
//
// Which todos an entry holds is its `covers`: one todo for a todo's lock, null for the whole batch.
// Two entries of one batch collide when either covers the whole batch, or they share a todo; so a
// lock on the whole batch and a lock on one of its todos never coexist, and two todos of one batch
// are held side by side. 0.17.0 wrote a lock on part of a batch as ONE batch-root lock with a
// `covers` list, mirrored as `locks/<batch>@<worktree hash>.json` (one per worktree): such entries
// are read, kept in step and removed as before — novadev no longer makes new ones.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonGitDir, worktreeList } from './git.ts';
import { BATCH_RE, WORK_LOCK_FILE, comparablePath, featureIdsIn, isPlainObject, listDirs, listFeatures, listFiles, pathsOverlap, readField } from './lib.ts';
import { listSubrepos } from './subrepos.ts';

export const REGISTRY_DIR = 'novadev';

/** One lock, as the registry keeps it: a todo in work, or a whole batch. */
export type RegistryLock = {
  batch: string;
  /**
   * What the lock is on: `todo` — one todo, its working.md in the todo's folder (`covers` names it);
   * `batch` — the batch-root working.md: the whole batch, or (0.17.0) the todos in `covers`.
   */
  unit: 'batch' | 'todo';
  /** The worktree it is in work in: its root, absolute. */
  worktree: string;
  branch: string | null;
  state: 'working' | 'paused';
  agent: string;
  host: string;
  pid: number | null;
  session: string | null;
  started: string;
  updated: string;
  todo: string | null;
  phase: number | null;
  /** Project-relative paths, "/" separated. */
  claims: string[];
  /** The todos the lock holds: the one todo of a todo's lock; null: the whole batch. */
  covers: string[] | null;
  /** The first line of the newest waypoint or pause: where the work is, in the holder's words. */
  note?: string | null;
  /** The registry file it was read from (never written into it). */
  file?: string;
};

/** How a lock is named to a person: `2026-11-12_2/02-dark-mode` for a todo's, the batch for a batch's. */
export function lockRef(lock: { batch: string; unit: 'batch' | 'todo'; covers: readonly string[] | null }): string {
  return lock.unit === 'todo' ? `${lock.batch}/${lock.covers?.[0] ?? '?'}` : lock.batch;
}

/** `<common git dir>/novadev`, or null outside git. */
export function registryDir(root: string): string | null {
  const common = commonGitDir(root);
  return common === null ? null : join(common, REGISTRY_DIR);
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True when two paths name the same folder. */
export function samePlace(a: string, b: string): boolean {
  return real(a) === real(b);
}

function asLock(value: unknown): RegistryLock | null {
  if (!isPlainObject(value)) return null;
  const v = value as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === 'string' ? (v[key] as string) : null);
  const batch = text('batch');
  const worktree = text('worktree');
  const state = text('state');
  if (batch === null || !BATCH_RE.test(batch) || worktree === null || (state !== 'working' && state !== 'paused')) return null;
  const covers = Array.isArray(v.covers) ? v.covers.filter((c): c is string => typeof c === 'string') : null;
  return {
    batch,
    // An entry without `unit` is a batch-root lock: every entry 0.17.0 and earlier wrote.
    unit: v.unit === 'todo' && covers !== null && covers.length === 1 ? 'todo' : 'batch',
    worktree,
    branch: text('branch'),
    state,
    agent: text('agent') ?? 'agent/unknown',
    host: text('host') ?? '',
    pid: typeof v.pid === 'number' ? v.pid : null,
    session: text('session'),
    started: text('started') ?? '',
    updated: text('updated') ?? '',
    todo: text('todo'),
    phase: typeof v.phase === 'number' ? v.phase : null,
    claims: Array.isArray(v.claims) ? v.claims.filter((c): c is string => typeof c === 'string') : [],
    covers,
    note: text('note'),
  };
}

/** Do two locks of one batch collide? Yes when either covers the whole batch, or they share a todo. */
export function coversOverlap(a: readonly string[] | null, b: readonly string[] | null): boolean {
  return a === null || b === null || a.some((todo) => b.includes(todo));
}

/**
 * The registry file of a lock: `<batch>.<todo>.json` for a todo's lock (one todo has one holder,
 * so one file); for a batch-root lock `<batch>.json` when it holds the whole batch, and
 * `<batch>@<hash of the worktree>.json` for a 0.17.0 lock on part of it (one per worktree).
 */
function lockFileName(lock: RegistryLock): string {
  if (lock.unit === 'todo') return `${lock.batch}.${lock.covers?.[0] ?? ''}.json`;
  if (lock.covers === null) return `${lock.batch}.json`;
  return `${lock.batch}@${createHash('sha1').update(real(lock.worktree)).digest('hex').slice(0, 12)}.json`;
}

/** Every lock the registry holds, readable ones only; [] outside git. */
export function registryLocks(root: string): RegistryLock[] {
  const dir = registryDir(root);
  if (dir === null) return [];
  const locks = join(dir, 'locks');
  if (!existsSync(locks)) return [];
  const out: RegistryLock[] = [];
  for (const file of readdirSync(locks).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const lock = asLock(JSON.parse(readFileSync(join(locks, file), 'utf8')));
      if (lock !== null) out.push({ ...lock, file });
    } catch {
      // An entry nobody can read says nothing; the next write replaces it.
    }
  }
  return out;
}

/**
 * Write (or replace) a lock's entry for the worktree it names. A batch-root lock also drops that
 * worktree's other batch-root entry of the batch (a 0.17.0 lock that went from part of the batch to
 * all of it, or back); a todo's entries in that worktree stay. Nothing outside git. A batch-root
 * entry is written as 0.17.0 wrote it — no `unit`, and no `covers` for the whole batch — plus
 * `note` once there is a waypoint (an older novadev ignores it): an older novadev reading the
 * folder sees what it always saw, and reads a todo's entry as a lock on that part of the batch.
 */
export function writeRegistryLock(root: string, lock: RegistryLock): void {
  const dir = registryDir(root);
  if (dir === null) return;
  mkdirSync(join(dir, 'locks'), { recursive: true });
  const name = lockFileName(lock);
  const { file: _file, covers, unit, note, ...rest } = lock;
  const entry = {
    ...rest,
    ...(covers === null ? {} : { covers }),
    ...(unit === 'todo' ? { unit } : {}),
    ...(note === undefined || note === null ? {} : { note }),
  };
  writeFileSync(join(dir, 'locks', name), `${JSON.stringify(entry, null, 2)}\n`);
  if (unit !== 'batch') return;
  for (const other of registryLocks(root)) {
    if (other.file !== name && other.unit === 'batch' && other.batch === lock.batch && samePlace(other.worktree, lock.worktree)) removeRegistryEntry(root, other);
  }
}

/** Remove one entry, as read by `registryLocks`. */
export function removeRegistryEntry(root: string, lock: RegistryLock): void {
  const dir = registryDir(root);
  if (dir === null) return;
  rmSync(join(dir, 'locks', lock.file ?? lockFileName(lock)), { force: true });
}

/**
 * Remove THIS worktree's entry of one lock: the todo's (`todo`), or the batch-root lock's (null).
 * Another worktree's entry of the same todo or batch — it took the work over — is never touched.
 */
export function removeRegistryLock(root: string, batch: string, todo: string | null = null): void {
  for (const entry of registryLocks(root)) {
    if (entry.batch !== batch || !samePlace(entry.worktree, root)) continue;
    if (todo === null ? entry.unit === 'batch' : entry.unit === 'todo' && entry.covers?.[0] === todo) removeRegistryEntry(root, entry);
  }
}

/** The worktrees git knows for this repository, as real paths; null outside git. */
function liveWorktrees(root: string): string[] | null {
  const list = worktreeList(root);
  return list === null ? null : list.map((w) => real(w.path));
}

/**
 * Is `path` (a project root, as the registry records it) inside one of `worktrees` (their tops)? The
 * project may sit below the top of its repository (`repo/app/.novadev`), so equality is not enough.
 */
function inLiveWorktree(path: string, worktrees: string[] | null): boolean {
  if (!existsSync(path)) return false;
  if (worktrees === null) return true;
  const here = real(path);
  return worktrees.some((top) => here === top || here.startsWith(`${top}/`));
}

/** Is the project root `path` inside the worktree whose top is `top`? */
export function insideWorktree(path: string, top: string): boolean {
  const here = real(path);
  const t = real(top);
  return here === t || here.startsWith(`${t}/`);
}

/** A registry lock in another worktree, and whether that worktree still exists. */
export type ElsewhereLock = RegistryLock & { gone: boolean };

/**
 * The batches in work in OTHER worktrees of this repository. `gone` marks an entry whose worktree
 * no longer exists (removed without releasing the lock): it holds nothing.
 */
export function locksElsewhere(root: string): ElsewhereLock[] {
  const worktrees = liveWorktrees(root);
  return registryLocks(root)
    .filter((lock) => !samePlace(lock.worktree, root))
    .map((lock) => ({ ...lock, gone: !inLiveWorktree(lock.worktree, worktrees) }));
}

/** Remove the entries whose worktree is gone; returns their batches. */
export function pruneGone(root: string): string[] {
  const gone = locksElsewhere(root).filter((lock) => lock.gone);
  for (const lock of gone) removeRegistryEntry(root, lock);
  return gone.map((lock) => lock.batch);
}

/** The batches in work (or paused) in another worktree that still exists — wholly, or any todo of them. */
export function batchesInWorkElsewhere(root: string): Set<string> {
  return new Set(locksElsewhere(root).filter((lock) => !lock.gone).map((lock) => lock.batch));
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/**
 * A claim as the registry keeps it: project-relative, "/" separated, without "./" or a trailing "/".
 * `<sub-repo>:<path>` becomes the sub-repo's folder plus the path. An error for a path that leaves
 * the project, or a sub-repo the project does not name.
 */
export function normalizeClaim(root: string, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  let text = raw.trim().replace(/\\/g, '/');
  // `<sub-repo>:<path>` — a sub-repo is named by its folder, whatever characters that has; a Windows
  // drive (`C:/…`) is not one, and is refused below as a path outside the project.
  const prefixed = /^([^\s:/]+):(.*)$/.exec(text);
  if (prefixed && !/^[A-Za-z]:(\/|$)/.test(text)) {
    const repo = listSubrepos(root).repos.find((r) => r.name === prefixed[1]);
    if (repo === undefined) return { ok: false, error: `claim "${raw}": "${prefixed[1]}" is not a sub-repo (see "subrepos" in novadev.json)` };
    text = `${repo.rel}/${prefixed[2]!.replace(/^\/+/, '')}`;
  }
  if (/^[A-Za-z]:/.test(text)) text = `/${text}`;
  // One spelling per path: "src//auth/", "src/./auth" and "./src/auth" are all "src/auth".
  const absolute = text.startsWith('/');
  const parts = text.split('/').filter((part) => part !== '' && part !== '.');
  const path = absolute ? '/' : comparablePath(parts.join('/'));
  if (path === '' || path === '.' || path.startsWith('/') || parts.includes('..')) {
    return { ok: false, error: `claim "${raw}" must be a path inside the project, like src/auth/ or irrippr:ps/layouting/` };
  }
  return { ok: true, value: path };
}

// ---------------------------------------------------------------------------
// Worktrees made by `novadev worktree create`
// ---------------------------------------------------------------------------

/** One worktree novadev made: the project's checkout plus worktrees of some sub-repos, on one branch. */
export type RegistryWorktree = {
  name: string;
  branch: string;
  /** The worktree's root (the project's checkout), absolute. */
  path: string;
  /** The main checkout it was made from, absolute. */
  main: string;
  /** The sub-repos it has worktrees of (the others are linked to the main checkout's, or absent). */
  repos: { name: string; rel: string }[];
  claims: string[];
  /**
   * The todos it is for, as `<batch>/<todo>`: named on `worktree create --todo`, and every todo
   * `novadev work start` locked in it. They outlive the locks, so the merge request can name them.
   * An entry 0.17.0 wrote has none.
   */
  todos: string[];
  /** The symbolic links it made (shared folders, unchanged sub-repos), absolute. */
  links: string[];
  /** Each repository's default branch and the commit it started from: "." is the project's own. */
  base: Record<string, { branch: string; commit: string }>;
  created: string;
};

function asWorktree(value: unknown): RegistryWorktree | null {
  if (!isPlainObject(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || typeof v.branch !== 'string' || typeof v.path !== 'string' || typeof v.main !== 'string') return null;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : []);
  return {
    name: v.name,
    branch: v.branch,
    path: v.path,
    main: v.main,
    repos: Array.isArray(v.repos)
      ? v.repos.filter((r): r is { name: string; rel: string } => isPlainObject(r) && typeof r.name === 'string' && typeof r.rel === 'string')
      : [],
    claims: strings(v.claims),
    todos: strings(v.todos),
    links: strings(v.links),
    base: isPlainObject(v.base) ? (v.base as RegistryWorktree['base']) : {},
    created: typeof v.created === 'string' ? v.created : '',
  };
}

/** Every worktree `novadev worktree create` registered; [] outside git. */
export function registryWorktrees(root: string): RegistryWorktree[] {
  const dir = registryDir(root);
  if (dir === null || !existsSync(join(dir, 'worktrees'))) return [];
  const out: RegistryWorktree[] = [];
  for (const file of readdirSync(join(dir, 'worktrees')).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const entry = asWorktree(JSON.parse(readFileSync(join(dir, 'worktrees', file), 'utf8')));
      if (entry !== null) out.push(entry);
    } catch {
      // unreadable: says nothing
    }
  }
  return out;
}

export function writeRegistryWorktree(root: string, entry: RegistryWorktree): void {
  const dir = registryDir(root);
  if (dir === null) return;
  mkdirSync(join(dir, 'worktrees'), { recursive: true });
  writeFileSync(join(dir, 'worktrees', `${entry.name}.json`), `${JSON.stringify(entry, null, 2)}\n`);
}

/** The worktree novadev made whose root is `root`, or null (the main checkout, a worktree made by hand). */
export function worktreeAt(root: string): RegistryWorktree | null {
  return registryWorktrees(root).find((w) => samePlace(w.path, root)) ?? null;
}

/** Add claims (already normalised and checked) to a worktree's entry; returns the ones it did not hold. */
export function addWorktreeClaims(root: string, entry: RegistryWorktree, claims: readonly string[]): string[] {
  const added = claims.filter((claim, i) => !entry.claims.includes(claim) && claims.indexOf(claim) === i);
  if (added.length > 0) writeRegistryWorktree(root, { ...entry, claims: [...entry.claims, ...added] });
  return added;
}

/** Add todos (`<batch>/<todo>`) to the ones a worktree is for; returns the ones it did not name yet. */
export function addWorktreeTodos(root: string, entry: RegistryWorktree, todos: readonly string[]): string[] {
  const added = todos.filter((todo, i) => !entry.todos.includes(todo) && todos.indexOf(todo) === i);
  if (added.length > 0) writeRegistryWorktree(root, { ...entry, todos: [...entry.todos, ...added] });
  return added;
}

export function removeRegistryWorktree(root: string, name: string): void {
  const dir = registryDir(root);
  if (dir !== null) rmSync(join(dir, 'worktrees', `${name}.json`), { force: true });
}

// ---------------------------------------------------------------------------
// Overlaps
// ---------------------------------------------------------------------------

/**
 * Who holds claims: a todo in work (`id` is `<batch>/<todo>`), a batch in work, or a worktree
 * novadev made. `batch` and `file` say which registry lock a todo's or a batch's claims come from.
 */
export type ClaimHolder = { kind: 'batch' | 'todo' | 'worktree'; id: string; worktree: string; branch: string | null; agent: string | null; claims: string[]; batch?: string; file?: string };

/** Every holder of claims in the repository whose worktree still exists, except those in `exceptPlace`. */
export function claimHolders(root: string, exceptPlace: string | null): ClaimHolder[] {
  const out: ClaimHolder[] = [];
  const worktrees = liveWorktrees(root);
  const exists = (path: string) => inLiveWorktree(path, worktrees);
  for (const lock of registryLocks(root)) {
    if (!exists(lock.worktree) || (exceptPlace !== null && samePlace(lock.worktree, exceptPlace))) continue;
    out.push({ kind: lock.unit, id: lockRef(lock), worktree: lock.worktree, branch: lock.branch, agent: lock.agent, claims: lock.claims, batch: lock.batch, file: lock.file });
  }
  for (const w of registryWorktrees(root)) {
    if (!exists(w.path) || (exceptPlace !== null && samePlace(w.path, exceptPlace))) continue;
    out.push({ kind: 'worktree', id: w.name, worktree: w.path, branch: w.branch, agent: null, claims: w.claims });
  }
  return out;
}

/** One overlap: our claim, theirs, and whose it is. */
export type Overlap = { claim: string; theirs: string; holder: ClaimHolder };

/** Where `claims` overlap the claims of holders in other worktrees (`holders`, or those not in `root`). */
export function claimOverlaps(root: string, claims: readonly string[], exceptBatch?: string, holders: ClaimHolder[] = claimHolders(root, root)): Overlap[] {
  const out: Overlap[] = [];
  for (const holder of holders) {
    if (holder.kind !== 'worktree' && exceptBatch !== undefined && holder.batch === exceptBatch) continue;
    for (const claim of claims) {
      for (const theirs of holder.claims) {
        if (pathsOverlap(claim, theirs)) out.push({ claim, theirs, holder });
      }
    }
  }
  return out;
}

/** "src/a.ts overlaps src — claimed by todo 2026-11-10_2/01-login in /wt/x on branch b (claude-code/…)". */
export function overlapText(overlap: Overlap): string {
  const h = overlap.holder;
  const where = `${h.worktree}${h.branch ? ` on branch ${h.branch}` : ''}`;
  return `${overlap.claim} overlaps ${overlap.theirs} — claimed by ${h.kind} ${h.id} in ${where}${h.agent ? ` (${h.agent})` : ''}`;
}

/**
 * The paths a batch claims: the ones given (`--claim`, `work claim`, a resumed lock's), and the
 * `touches:` of every feature a `**Feature:**` line in the batch's files names — in the files of the
 * todos in `covers` only, when the lock covers part of the batch. Throws on a claim that is not a
 * path inside the project.
 */
export function batchClaims(root: string, nd: string, batch: string, given: readonly string[], covers: readonly string[] | null = null): { claims: string[]; from: { given: string[]; features: Record<string, string[]> } } {
  const explicit: string[] = [];
  for (const raw of given) {
    const claim = normalizeClaim(root, raw);
    if (!claim.ok) throw new Error(claim.error);
    if (!explicit.includes(claim.value)) explicit.push(claim.value);
  }
  const batchDir = join(nd, 'todos', batch);
  const ids = new Set<string>();
  for (const todo of listDirs(batchDir)) {
    if (covers !== null && !covers.includes(todo)) continue;
    for (const file of listFiles(join(batchDir, todo))) {
      // The todo's lock is not one of its records: a waypoint may quote a `**Feature:**` line.
      if ((!file.endsWith('.md') && !file.endsWith('.txt')) || file === WORK_LOCK_FILE) continue;
      const field = readField(readFileSync(join(batchDir, todo, file), 'utf8'), 'Feature');
      for (const id of featureIdsIn(field ?? '')) ids.add(id);
    }
  }
  const features: Record<string, string[]> = {};
  for (const feature of listFeatures(nd)) {
    if (!ids.has(feature.id) || feature.touches.length === 0) continue;
    features[feature.id] = feature.touches.map((path) => normalizeClaim(root, path)).filter((c) => c.ok).map((c) => (c as { value: string }).value);
  }
  const all = [...explicit];
  for (const paths of Object.values(features)) for (const path of paths) if (!all.includes(path)) all.push(path);
  return { claims: all, from: { given: explicit, features } };
}
