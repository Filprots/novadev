// The registry of work in progress, shared by EVERY worktree of a repository.
//
// A batch's lock is `todos/<batch>/working.md` (work.ts): tracked, on the branch it was taken on,
// so its trail and its pause record travel with the branch and reach any machine. But a worktree
// on another branch cannot see that file. So every `novadev work` command also writes one small
// entry here, in the common git folder all worktrees of the repository share:
//
//   <common git dir>/novadev/locks/<batch>.json      who holds the batch, in which worktree, on
//                                                    which branch, where the work is, and the
//                                                    paths the batch claims
//   <common git dir>/novadev/worktrees/<name>.json   a worktree `novadev worktree create` made
//                                                    (worktree.ts): its branch, its sub-repos, its
//                                                    claims, what it linked in
//
// It is never committed (it lives inside .git), and it is only a mirror: the lock that counts in a
// worktree is that worktree's working.md; the registry answers "is this batch in work ELSEWHERE,
// and which paths does that work own?". An entry whose worktree is gone is ignored, and removed
// by the next `novadev work` command.
//
// Claims — "one owner per file". A batch in work claims the paths it will change: the ones given
// with `--claim` / `novadev work claim`, and the `touches:` of the features its todos name. A
// claim may be written `<sub-repo>:<path>` (`irrippr:ps/layouting/`), which is the sub-repo's
// folder plus the path. A worktree made by `novadev worktree create --claim` claims paths too.
// `novadev work start` refuses a batch whose claims overlap the claims of a batch in work in
// another worktree, or of another worktree; `novadev worktree create` refuses the same.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonGitDir, worktreeList } from './git.ts';
import { BATCH_RE, comparablePath, featureIdsIn, isPlainObject, listDirs, listFeatures, listFiles, pathsOverlap, readField } from './lib.ts';
import { listSubrepos } from './subrepos.ts';

export const REGISTRY_DIR = 'novadev';

/** One batch in work, as the registry keeps it. */
export type RegistryLock = {
  batch: string;
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
};

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
  return {
    batch,
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
  };
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
      if (lock !== null) out.push(lock);
    } catch {
      // An entry nobody can read says nothing; the next write replaces it.
    }
  }
  return out;
}

/** Write (or replace) a batch's entry. Nothing outside git. */
export function writeRegistryLock(root: string, lock: RegistryLock): void {
  const dir = registryDir(root);
  if (dir === null) return;
  mkdirSync(join(dir, 'locks'), { recursive: true });
  writeFileSync(join(dir, 'locks', `${lock.batch}.json`), `${JSON.stringify(lock, null, 2)}\n`);
}

/** Remove a batch's entry — only when it is this worktree's, unless `any`. */
export function removeRegistryLock(root: string, batch: string, any = false): void {
  const dir = registryDir(root);
  if (dir === null) return;
  const path = join(dir, 'locks', `${batch}.json`);
  if (!existsSync(path)) return;
  if (!any) {
    const entry = registryLocks(root).find((lock) => lock.batch === batch);
    if (entry !== undefined && !samePlace(entry.worktree, root)) return;
  }
  rmSync(path, { force: true });
}

/** The worktrees git knows for this repository, as real paths; null outside git. */
function liveWorktrees(root: string): Set<string> | null {
  const list = worktreeList(root);
  return list === null ? null : new Set(list.map((w) => real(w.path)));
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
    .map((lock) => ({ ...lock, gone: !existsSync(lock.worktree) || (worktrees !== null && !worktrees.has(real(lock.worktree))) }));
}

/** Remove the entries whose worktree is gone; returns their batches. */
export function pruneGone(root: string): string[] {
  const gone = locksElsewhere(root).filter((lock) => lock.gone);
  for (const lock of gone) removeRegistryLock(root, lock.batch, true);
  return gone.map((lock) => lock.batch);
}

/** The batches in work (or paused) in another worktree that still exists. */
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
  const prefixed = /^([A-Za-z0-9][\w.-]*):(.*)$/.exec(text);
  if (prefixed && !/^[A-Za-z]:\//.test(text)) {
    const repo = listSubrepos(root).repos.find((r) => r.name === prefixed[1]);
    if (repo === undefined) return { ok: false, error: `claim "${raw}": "${prefixed[1]}" is not a sub-repo (see "subrepos" in novadev.json)` };
    text = `${repo.rel}/${prefixed[2]!.replace(/^\/+/, '')}`;
  }
  const path = comparablePath(text);
  if (path === '' || path === '.' || path.startsWith('/') || path.split('/').includes('..')) {
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

export function removeRegistryWorktree(root: string, name: string): void {
  const dir = registryDir(root);
  if (dir !== null) rmSync(join(dir, 'worktrees', `${name}.json`), { force: true });
}

// ---------------------------------------------------------------------------
// Overlaps
// ---------------------------------------------------------------------------

/** Who holds claims: a batch in work, or a worktree novadev made. */
export type ClaimHolder = { kind: 'batch' | 'worktree'; id: string; worktree: string; branch: string | null; agent: string | null; claims: string[] };

/** Every holder of claims in the repository whose worktree still exists, except those in `exceptPlace`. */
export function claimHolders(root: string, exceptPlace: string | null): ClaimHolder[] {
  const out: ClaimHolder[] = [];
  const worktrees = liveWorktrees(root);
  const exists = (path: string) => existsSync(path) && (worktrees === null || worktrees.has(real(path)));
  for (const lock of registryLocks(root)) {
    if (!exists(lock.worktree) || (exceptPlace !== null && samePlace(lock.worktree, exceptPlace))) continue;
    out.push({ kind: 'batch', id: lock.batch, worktree: lock.worktree, branch: lock.branch, agent: lock.agent, claims: lock.claims });
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
    if (holder.kind === 'batch' && holder.id === exceptBatch) continue;
    for (const claim of claims) {
      for (const theirs of holder.claims) {
        if (pathsOverlap(claim, theirs)) out.push({ claim, theirs, holder });
      }
    }
  }
  return out;
}

/** "src/a.ts overlaps src — claimed by batch 2026-11-10_2 in /wt/x on branch b (claude-code/…)". */
export function overlapText(overlap: Overlap): string {
  const h = overlap.holder;
  const where = `${h.worktree}${h.branch ? ` on branch ${h.branch}` : ''}`;
  return `${overlap.claim} overlaps ${overlap.theirs} — claimed by ${h.kind} ${h.id} in ${where}${h.agent ? ` (${h.agent})` : ''}`;
}

/**
 * The paths a batch claims: the ones given (`--claim`, `work claim`, a resumed lock's), and the
 * `touches:` of every feature a `**Feature:**` line in the batch's files names. Throws on a claim
 * that is not a path inside the project.
 */
export function batchClaims(root: string, nd: string, batch: string, given: readonly string[]): { claims: string[]; from: { given: string[]; features: Record<string, string[]> } } {
  const explicit: string[] = [];
  for (const raw of given) {
    const claim = normalizeClaim(root, raw);
    if (!claim.ok) throw new Error(claim.error);
    if (!explicit.includes(claim.value)) explicit.push(claim.value);
  }
  const batchDir = join(nd, 'todos', batch);
  const ids = new Set<string>();
  for (const todo of listDirs(batchDir)) {
    for (const file of listFiles(join(batchDir, todo))) {
      if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
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
