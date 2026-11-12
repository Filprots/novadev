// `novadev worktree` — one isolated worktree per task, across the project and the sub-repos it
// changes, on one branch. Generalised from the IRRIS company's `irris-worktree` (2026-11-10).
// The task is a todo: one todo, one owner, one worktree, one merge request.
//
//   novadev worktree create <name> [<sub-repo>…] [--claim <path>]… [--todo <ref>]…
//                                                                    make it (the builder), for that todo
//   novadev worktree claim <name> <path>… [--allow-overlap]          add paths to its claims
//   novadev worktree list [--json]                                   every worktree novadev made
//   novadev worktree status <name>                                   per repository: ahead/behind, dirty, diffstat
//   novadev worktree gate <name>                                     the checks that must pass before a merge request
//   novadev worktree mr <name>                                       the merge request's text
//   novadev worktree sync <name>                                     merge the default branches into the worktree
//   novadev worktree merge <name> [--yes]                            the LEAD: merge it, all or nothing
//   novadev worktree remove <name> [--force]                         after the merge (or when dropped)
//
// Layout: `<dir>/<name>/` is a worktree of the project's repository on branch `<prefix><name>`,
// made from its default branch; inside it, `<sub-repo folder>/` is a worktree of each sub-repo named
// on `create` ("subrepos", subrepos.ts), on the same branch. A sub-repo it does not change is a link
// to the main checkout's (read it, never write it), so checks find their siblings. Git-ignored heavy
// folders the settings name (`node_modules`) are links to the main checkout's too. Branches stay
// local: novadev never pushes.
//
//   "worktree": {
//     "dir": "../_wt",                    where worktrees go (relative to the main checkout, or absolute);
//                                         default: ../<project folder>-worktrees
//     "branchPrefix": "",                 put before the name to make the branch
//     "share": ["node_modules"],          ignored folders linked from the main checkout, in every repository
//     "linkSubrepos": true,               link the sub-repos a worktree does not change
//     "gate": { ".": ["bun test"], "irrippr": ["npm run lint"] }   commands per repository ("." = the project's)
//   }
//
// Claims (registry.ts): `--claim` paths are the worktree's; one that overlaps a claim of another
// worktree or of work locked elsewhere is refused; `claim` adds more, checked the same way. The
// gate fails on a change outside the worktree's claims and the claims of the locks held in it.
//
// Todos: `create --todo <ref>` records the todo the worktree is for, and `novadev work start` in
// the worktree adds every todo it locks there (registry.ts). `list`, `status` and the merge request
// name them — with the todos whose records the branch changed — after the locks are gone.
//
// The merge: on the main checkout, every repository on its default branch with no uncommitted
// change; every merge is first tried with `git merge-tree` and nothing is merged unless all of them
// would go through; then sub-repos first and the project last (its records never land without their
// code), `--no-ff`; then `novadev sync --after-merge` regenerates and commits novadev's files. A
// branch that still carries a WORKING lock (a todo's working.md, or a batch's) is not merged: stop
// or pause it first. A paused lock travels: a todo's sits in the todo's own folder, so two branches
// that each paused a todo of one batch merge without meeting.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { projectDefaultBranch } from './branch.ts';
import { type ClaimPolicy, claimPolicy, judgeOverlaps, protectedBy, refusalHint, sharedClaims } from './claim-policy.ts';
import { commonGitDir, defaultBranch, worktreeList } from './git.ts';
import { type Parsed, ROOT_DIR_NAME, WORK_LOCK_FILE, isPlainObject, novadevDir, packageDir, pathWithin, readManifest, refuse, requireProjectRoot, todoState } from './lib.ts';
import {
  type Overlap,
  type RegistryWorktree,
  addWorktreeClaims,
  claimHolders,
  claimOverlaps,
  lockRef,
  normalizeClaim,
  overlapText,
  registryLocks,
  registryWorktrees,
  removeRegistryEntry,
  removeRegistryWorktree,
  samePlace,
  writeRegistryWorktree,
} from './registry.ts';
import { type QueueEntry, queueLockHolder, queueOrder, readQueue, withQueueLock, writeQueue } from './queue.ts';
import { requiredReviewerLines } from './owners.ts';
import { forgetSubrepos, listSubrepos } from './subrepos.ts';
import { todoPriority } from './todo-meta.ts';
import { briefTitle, resolveTodo } from './todo.ts';

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** This novadev's own CLI: the gate and the merge run `sync` with the same code as the command. */
const CLI_PATH = join(packageDir(), 'bin', 'novadev.ts');
const GATE_TIMEOUT_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type WorktreeSettings = { dir: string | null; branchPrefix: string; share: string[]; linkSubrepos: boolean; gate: Record<string, string[]> };

/** `"worktree"` in novadev.json; absent or null = every default. */
export function parseWorktreeSettings(value: unknown): Parsed<WorktreeSettings> {
  const out: WorktreeSettings = { dir: null, branchPrefix: '', share: [], linkSubrepos: true, gate: {} };
  if (value === undefined || value === null) return { ok: true, value: out };
  if (!isPlainObject(value)) return refuse('"worktree" must be an object, like { "dir": "../_wt", "share": ["node_modules"] }');
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!['dir', 'branchPrefix', 'share', 'linkSubrepos', 'gate'].includes(key)) return refuse(`"worktree": unknown key "${key}" (dir, branchPrefix, share, linkSubrepos, gate)`);
  }
  if (v.dir !== undefined && v.dir !== null) {
    if (typeof v.dir !== 'string' || v.dir.trim() === '') return refuse('"worktree.dir" must be a folder');
    out.dir = v.dir.trim();
  }
  if (v.branchPrefix !== undefined) {
    if (typeof v.branchPrefix !== 'string' || /\s|\.\.|^\/|[~^:?*[\\]/.test(v.branchPrefix)) return refuse('"worktree.branchPrefix" must be text a branch name may start with, like "task/"');
    out.branchPrefix = v.branchPrefix;
  }
  if (v.share !== undefined) {
    if (!Array.isArray(v.share) || !v.share.every((s) => typeof s === 'string' && /^[^/\\]+$/.test(s))) {
      return refuse('"worktree.share" must be a list of folder names, like ["node_modules"]');
    }
    out.share = v.share as string[];
  }
  if (v.linkSubrepos !== undefined) {
    if (typeof v.linkSubrepos !== 'boolean') return refuse('"worktree.linkSubrepos" must be true or false');
    out.linkSubrepos = v.linkSubrepos;
  }
  if (v.gate !== undefined) {
    if (!isPlainObject(v.gate)) return refuse('"worktree.gate" must map a repository ("." for the project) to a list of commands');
    for (const [repo, commands] of Object.entries(v.gate as Record<string, unknown>)) {
      if (!Array.isArray(commands) || !commands.every((c) => typeof c === 'string' && c.trim() !== '')) {
        return refuse(`"worktree.gate"."${repo}" must be a list of commands`);
      }
      out.gate[repo] = commands as string[];
    }
  }
  return { ok: true, value: out };
}

function settingsOf(main: string): WorktreeSettings {
  const parsed = parseWorktreeSettings(readManifest(novadevDir(main))?.worktree);
  if (!parsed.ok) throw new Error(`novadev.json: ${parsed.error}`);
  return parsed.value;
}

/** Where a worktree goes. */
export function worktreePath(main: string, settings: WorktreeSettings, name: string): string {
  const dir = settings.dir === null ? join(dirname(main), `${basename(main)}-worktrees`) : isAbsolute(settings.dir) ? settings.dir : resolve(main, settings.dir);
  return join(dir, name);
}

// ---------------------------------------------------------------------------
// git, and the repositories of a worktree
// ---------------------------------------------------------------------------

type Run = { ok: boolean; code: number; out: string; err: string };

/** git in `cwd`, without the variables a hook exports (each repository answers for itself). */
function git(cwd: string, ...args: string[]): Run {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE)$/.test(k)));
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env, timeout: 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { ok: run.status === 0, code: run.status ?? -1, out: (run.stdout ?? '').trim(), err: (run.stderr ?? '').trim() };
}

function must(run: Run, what: string): string {
  if (!run.ok) throw new Error(`${what} failed: ${run.err || run.out || `exit ${run.code}`}`);
  return run.out;
}

/** The project's main checkout (git's first worktree). The project must sit at its repository's top. */
function mainCheckout(root: string): string {
  const top = git(root, 'rev-parse', '--show-toplevel');
  if (!top.ok) throw new Error('novadev worktree needs a git repository.');
  if (!samePlace(top.out, root)) throw new Error(`novadev worktree needs ${ROOT_DIR_NAME}/ at the top of its repository (it is at ${root}, the repository at ${top.out}).`);
  const list = worktreeList(root);
  if (list === null || list.length === 0) throw new Error('git lists no worktree here.');
  return list[0]!.path;
}

/** One repository of a worktree: "." is the project's own. */
type Repo = { name: string; rel: string; path: string; main: string; base: string };

function reposOf(entry: RegistryWorktree): Repo[] {
  const own: Repo = { name: '.', rel: '', path: entry.path, main: entry.main, base: entry.base['.']?.branch ?? 'main' };
  return [own, ...entry.repos.map((r) => ({ name: r.name, rel: r.rel, path: join(entry.path, r.rel), main: join(entry.main, r.rel), base: entry.base[r.name]?.branch ?? 'main' }))];
}

function label(repo: Repo): string {
  return repo.name === '.' ? 'project' : repo.name;
}

function find(root: string, name: string | undefined): RegistryWorktree {
  if (name === undefined || name === '') throw new Error('Name the worktree (novadev worktree list shows them).');
  const entry = registryWorktrees(root).find((w) => w.name === name);
  if (entry === undefined) {
    const known = registryWorktrees(root).map((w) => w.name);
    throw new Error(`No worktree "${name}".${known.length > 0 ? ` Known: ${known.join(', ')}.` : ''}`);
  }
  return entry;
}

function dirty(path: string, untracked = true): string[] {
  const out = git(path, 'status', '--porcelain', `--untracked-files=${untracked ? 'normal' : 'no'}`);
  return out.ok ? out.out.split('\n').filter(Boolean) : ['(git status failed)'];
}

function aheadBehind(path: string, base: string, branch: string): { ahead: number; behind: number } {
  const out = git(path, 'rev-list', '--left-right', '--count', `${base}...${branch}`);
  const [behind = '0', ahead = '0'] = out.ok ? out.out.split(/\s+/) : [];
  return { ahead: Number(ahead), behind: Number(behind) };
}

/** Add `/rel` to the repository's info/exclude (a link git would otherwise list as untracked). */
function exclude(repoPath: string, rel: string): void {
  const common = commonGitDir(repoPath);
  if (common === null) return;
  const file = join(common, 'info', 'exclude');
  mkdirSync(dirname(file), { recursive: true });
  const have = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const line = `/${rel}`;
  if (!have.includes(line)) writeFileSync(file, `${have.join('\n').replace(/\n*$/, '\n')}${line}\n`);
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export function createWorktree(root: string, name: string, repoNames: readonly string[], rawClaims: readonly string[], allowOverlap = false, todoRefs: readonly string[] = []): string[] {
  if (!NAME_RE.test(name)) throw new Error(`"${name}" cannot name a worktree: lower-case letters, digits, ".", "_" and "-", up to 64.`);
  const main = mainCheckout(root);
  const settings = settingsOf(main);
  forgetSubrepos();
  const subrepos = listSubrepos(main);
  if (subrepos.problems.length > 0) throw new Error(subrepos.problems.join('; '));
  const chosen = repoNames.map((repoName) => {
    const repo = subrepos.repos.find((r) => r.name === repoName);
    if (repo === undefined) {
      throw new Error(`"${repoName}" is not a sub-repo${subrepos.repos.length > 0 ? ` (sub-repos: ${subrepos.repos.map((r) => r.name).join(', ')})` : ' — "subrepos" in novadev.json names none'}.`);
    }
    return repo;
  });
  if (registryWorktrees(main).some((w) => w.name === name)) throw new Error(`A worktree "${name}" exists already (novadev worktree status ${name}).`);
  const path = worktreePath(main, settings, name);
  if (existsSync(path)) throw new Error(`${path} exists already.`);
  const branch = `${settings.branchPrefix}${name}`;
  if (git(main, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).ok) throw new Error(`Branch ${branch} exists already in the project's repository.`);

  const claims = worktreeClaims(main, rawClaims, chosen.map((r) => r.name), 'name the sub-repo on create');
  const policy = claimPolicy(main);
  const { hard: overlaps, soft: shares } = judgeOverlaps(policy, claimOverlaps(main, claims, undefined, claimHolders(main, null)));
  if (overlaps.length > 0 && !allowOverlap) throw new Error(takenText(overlaps, policy));
  // The todos it is made for, as the main checkout's `todos/` names them (a typo is refused here).
  const todos = todoRefs.map((ref) => resolveTodo(novadevDir(main), ref).ref).filter((ref, i, all) => all.indexOf(ref) === i);
  // One todo, one owner: who else is on it is said, not refused — the todo's lock is the gate
  // (`novadev work start` in the new worktree refuses a todo that is in work elsewhere).
  const shared = todos.flatMap((todo) => [
    ...registryWorktrees(main).filter((w) => w.todos.includes(todo)).map((w) => `todo ${todo} is also the task of worktree ${w.name}`),
    ...registryLocks(main)
      .filter((l) => existsSync(l.worktree) && `${l.batch}/` === todo.slice(0, l.batch.length + 1) && (l.covers === null || l.covers.includes(todo.slice(l.batch.length + 1))))
      .map((l) => `todo ${todo} is ${l.state === 'paused' ? 'paused' : 'in work'} in ${l.worktree} (${l.agent})`),
  ]);

  const base: RegistryWorktree['base'] = {};
  const made: { repoMain: string; path: string }[] = [];
  const links: string[] = [];
  const lines: string[] = [];
  try {
    const ownBase = projectDefaultBranch(main);
    if (ownBase === null) throw new Error('git cannot name the project\'s default branch — set "defaultBranch" in novadev.json.');
    must(git(main, 'worktree', 'add', '-q', '-b', branch, path, ownBase), `git worktree add (project, from ${ownBase})`);
    made.push({ repoMain: main, path });
    base['.'] = { branch: ownBase, commit: must(git(path, 'rev-parse', 'HEAD'), 'git rev-parse') };
    for (const repo of chosen) {
      const subBase = defaultBranch(repo.path, null, true);
      if (subBase === null) throw new Error(`git cannot name ${repo.name}'s default branch.`);
      if (git(repo.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).ok) throw new Error(`Branch ${branch} exists already in ${repo.name}.`);
      const target = join(path, repo.rel);
      mkdirSync(dirname(target), { recursive: true });
      must(git(repo.path, 'worktree', 'add', '-q', '-b', branch, target, subBase), `git worktree add (${repo.name}, from ${subBase})`);
      made.push({ repoMain: repo.path, path: target });
      base[repo.name] = { branch: subBase, commit: must(git(target, 'rev-parse', 'HEAD'), 'git rev-parse') };
    }
    // Ignored heavy folders the checks need, linked from each repository's main checkout.
    if (settings.share.length > 0) {
      for (const { repoMain, path: wtPath } of made) {
        const ignored = git(repoMain, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory');
        for (const entry of ignored.ok ? ignored.out.split('\n') : []) {
          const rel = entry.replace(/\/$/, '');
          if (rel === '' || !settings.share.includes(basename(rel))) continue;
          if (subrepos.repos.some((r) => repoMain === main && pathWithin(rel, r.rel))) continue;
          const target = join(wtPath, rel);
          if (existsSync(target) || isLink(target)) continue;
          mkdirSync(dirname(target), { recursive: true });
          symlinkSync(join(repoMain, rel), target);
          exclude(repoMain, rel);
          links.push(target);
        }
      }
    }
    // The sub-repos it does not change: links to the main checkout's, read-only by rule.
    if (settings.linkSubrepos) {
      for (const repo of subrepos.repos) {
        if (chosen.includes(repo)) continue;
        const target = join(path, repo.rel);
        if (existsSync(target) || isLink(target)) continue;
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(repo.path, target);
        exclude(main, repo.rel);
        links.push(target);
      }
    }
  } catch (error) {
    for (const link of links) if (isLink(link)) unlinkSync(link);
    for (const m of [...made].reverse()) {
      git(m.repoMain, 'worktree', 'remove', '--force', m.path);
      git(m.repoMain, 'branch', '-D', branch);
    }
    throw error;
  }
  writeRegistryWorktree(main, {
    name, branch, path, main, repos: chosen.map((r) => ({ name: r.name, rel: r.rel })), claims, todos, links, base, created: new Date().toISOString(),
  });
  lines.push(`✓ worktree ${name} → ${path}`);
  lines.push(`  branch ${branch} in: project${chosen.map((r) => `, ${r.name}`).join('')} (from ${Object.entries(base).map(([k, b]) => `${k === '.' ? 'project' : k} ${b.branch}`).join(', ')})`);
  if (claims.length > 0) lines.push(`  claims: ${claims.join(', ')}`);
  if (overlaps.length > 0) lines.push(`  overlaps (allowed): ${overlaps.map(overlapText).join('; ')}`);
  if (shares.length > 0) lines.push(`  shared (a notice, not a lock): ${shares.map(overlapText).join('; ')}`);
  if (todos.length > 0) lines.push(`  for: ${todos.join(', ')} — take its lock there first: novadev work start ${todos[0]}`);
  for (const note of shared) lines.push(`  note: ${note}`);
  if (links.length > 0) lines.push(`  linked from the main checkout: ${links.map((l) => relative(path, l)).join(', ')}`);
  lines.push('  Work and commit only there. When done: novadev worktree gate, then novadev worktree mr.');
  return lines;
}

/** Claims normalised, each once; refused when one lies in a sub-repo the worktree has no worktree of. */
function worktreeClaims(main: string, rawClaims: readonly string[], repoNames: readonly string[], hint: string): string[] {
  const claims: string[] = [];
  for (const raw of rawClaims) {
    const claim = normalizeClaim(main, raw);
    if (!claim.ok) throw new Error(claim.error);
    if (!claims.includes(claim.value)) claims.push(claim.value);
  }
  const repos = listSubrepos(main).repos;
  const outside = claims.filter((c) => repos.some((r) => pathWithin(c, r.rel) && !repoNames.includes(r.name)));
  if (outside.length > 0) throw new Error(`Claimed in a sub-repo this worktree does not have: ${outside.join(', ')} — ${hint}.`);
  return claims;
}

function takenText(overlaps: Overlap[], policy: ClaimPolicy): string {
  return `One owner per file — these claims are taken:\n${overlaps.map((o) => `  ${overlapText(o)}`).join('\n')}\n${refusalHint(policy)}`;
}

// ---------------------------------------------------------------------------
// claim — more paths for an existing worktree
// ---------------------------------------------------------------------------

/**
 * Add paths to a worktree's claims, with the same check as `create`: one that overlaps a claim of
 * another worktree, or of a batch in work in another worktree, is refused unless `allowOverlap`.
 * The batches locked IN this worktree are its own work and never block it. The gate reads them.
 */
export function claimWorktree(root: string, name: string, rawClaims: readonly string[], allowOverlap = false): string[] {
  const main = mainCheckout(root);
  const entry = find(main, name);
  if (rawClaims.length === 0) throw new Error(`Name the paths to claim.\n${USAGE}`);
  forgetSubrepos();
  const claims = worktreeClaims(main, rawClaims, entry.repos.map((r) => r.name), 'make a new worktree that has that sub-repo');
  const fresh = claims.filter((c) => !entry.claims.includes(c));
  const policy = claimPolicy(main);
  const { hard: overlaps, soft: shares } = judgeOverlaps(policy, claimOverlaps(main, fresh, undefined, claimHolders(main, entry.path)));
  if (overlaps.length > 0 && !allowOverlap) throw new Error(takenText(overlaps, policy));
  addWorktreeClaims(main, entry, fresh);
  const lines = [fresh.length > 0 ? `✓ worktree ${name} claims ${fresh.join(', ')}` : `· worktree ${name} holds ${claims.join(', ')} already`];
  if (overlaps.length > 0) lines.push(`  overlaps (allowed): ${overlaps.map(overlapText).join('; ')}`);
  if (shares.length > 0) lines.push(`  shared (a notice, not a lock): ${shares.map(overlapText).join('; ')}`);
  lines.push(`  claims: ${[...entry.claims, ...fresh].join(', ')}`);
  return lines;
}

// ---------------------------------------------------------------------------
// list / status
// ---------------------------------------------------------------------------

export function listData(root: string): Record<string, unknown>[] {
  const main = mainCheckout(root);
  const locks = registryLocks(main);
  const shared = sharedClaims(main);
  const queue = readQueue(main);
  const order = queueOrder(queue);
  return registryWorktrees(main).map((w) => ({
    name: w.name,
    branch: w.branch,
    path: w.path,
    exists: existsSync(w.path),
    repos: w.repos.map((r) => r.name),
    claims: w.claims,
    // The paths it claims that another worktree claims too: `path` and who the other is.
    shares: shared.flatMap((s) => (samePlace(s.worktrees[0], w.path) ? [{ path: s.path, with: s.between[1] }] : samePlace(s.worktrees[1], w.path) ? [{ path: s.path, with: s.between[0] }] : [])),
    // Its place in the merge queue, when it is there: `position` counts from 1; a failed one has its reason.
    ...queueInfo(w.name, queue, order),
    // The todos it is for (create --todo, and every todo locked in it), `<batch>/<todo>`.
    todos: w.todos,
    // The locks held in it now: a batch's as before; a todo's names its `todo`; a 0.17.0 part its `covers`.
    batches: locks
      .filter((l) => samePlace(l.worktree, w.path))
      .map((l) => ({ batch: l.batch, state: l.state, agent: l.agent, ...(l.unit === 'todo' ? { todo: l.covers![0], ref: lockRef(l) } : l.covers !== null ? { covers: l.covers } : {}) })),
  }));
}

function queueInfo(name: string, queue: readonly QueueEntry[], order: readonly QueueEntry[]): { queue?: { state: QueueEntry['state']; position: number | null; express: boolean; reason: string | null } } {
  const entry = queue.find((e) => e.name === name);
  if (entry === undefined) return {};
  const at = order.findIndex((e) => e.name === name);
  return { queue: { state: entry.state, position: at === -1 ? null : at + 1, express: entry.express, reason: entry.reason ?? null } };
}

export function statusLines(root: string, name: string): string[] {
  const entry = find(mainCheckout(root), name);
  const lines = [`${entry.name}  ${entry.branch}  ${entry.path}`];
  for (const repo of reposOf(entry)) {
    if (!existsSync(repo.path)) {
      lines.push(`  ${label(repo).padEnd(20)} (missing: ${repo.path})`);
      continue;
    }
    const { ahead, behind } = aheadBehind(repo.path, repo.base, entry.branch);
    const changes = dirty(repo.path);
    lines.push(`  ${label(repo).padEnd(20)} +${ahead} commit(s), ${behind} behind ${repo.base}, ${changes.length > 0 ? `DIRTY ${changes.length} file(s)` : 'clean'}`);
    if (ahead > 0) lines.push(`    ${git(repo.path, 'diff', '--shortstat', `${repo.base}...${entry.branch}`).out}`);
  }
  if (entry.claims.length > 0) lines.push(`  claims: ${entry.claims.join(', ')}`);
  if (entry.todos.length > 0) lines.push(`  for: ${entry.todos.join(', ')}`);
  return lines;
}

// ---------------------------------------------------------------------------
// gate / mr
// ---------------------------------------------------------------------------

/** The files the worktree's branch changed in a repository, project-relative. */
function changedFiles(repo: Repo, branch: string): string[] {
  const out = git(repo.path, 'diff', '--name-only', `${repo.base}...${branch}`);
  return out.ok ? out.out.split('\n').filter(Boolean).map((f) => (repo.rel === '' ? f : `${repo.rel}/${f}`)) : [];
}

/**
 * The paths a worktree's changes may touch: its own claims, and the claims of every lock held in it
 * — a todo's or a batch's (`novadev work claim` adds those, and 0.16.0 kept them in the lock only).
 */
function gateClaims(entry: RegistryWorktree): string[] {
  const claims = [...entry.claims];
  for (const lock of registryLocks(entry.main)) {
    if (!samePlace(lock.worktree, entry.path)) continue;
    for (const claim of lock.claims) if (!claims.includes(claim)) claims.push(claim);
  }
  return claims;
}

export function gateWorktree(root: string, name: string): { passed: boolean; lines: string[] } {
  const entry = find(mainCheckout(root), name);
  const settings = settingsOf(entry.main);
  const claims = gateClaims(entry);
  const policy = claimPolicy(entry.main);
  const fails: string[] = [];
  const ran: string[] = [];
  const allChanged: string[] = [];
  for (const repo of reposOf(entry)) {
    if (!existsSync(repo.path)) {
      fails.push(`${label(repo)}: the worktree is missing (${repo.path})`);
      continue;
    }
    const changes = dirty(repo.path);
    if (changes.length > 0) fails.push(`${label(repo)}: ${changes.length} uncommitted change(s) — commit or drop them first`);
    if (!git(repo.path, 'diff', '--check', `${repo.base}...${entry.branch}`).ok) fails.push(`${label(repo)}: whitespace errors (git diff --check ${repo.base}...${entry.branch})`);
    const changed = changedFiles(repo, entry.branch);
    allChanged.push(...changed);
    if (policy.mode === 'notice') {
      // Claims are notices: only a protected path is a lock, and a file under one must be held here.
      const unheld = changed.filter((f) => !f.startsWith(`${ROOT_DIR_NAME}/`) && protectedBy(policy, f) !== null && !claims.some((c) => pathWithin(f, c)));
      if (unheld.length > 0) {
        fails.push(`${label(repo)}: changed under a protected path this worktree does not hold: ${unheld.slice(0, 10).map((f) => `${f} (${protectedBy(policy, f)})`).join(', ')}${unheld.length > 10 ? ` … +${unheld.length - 10}` : ''} — claim it first (\`novadev worktree claim ${entry.name} <path>\`)`);
      }
    } else if (entry.claims.length > 0) {
      const outside = changed.filter((f) => !f.startsWith(`${ROOT_DIR_NAME}/`) && !claims.some((c) => pathWithin(f, c)));
      if (outside.length > 0) fails.push(`${label(repo)}: changed outside the claims (${claims.join(', ')}): ${outside.slice(0, 10).join(', ')}${outside.length > 10 ? ` … +${outside.length - 10}` : ''}`);
    }
    const env = {
      ...process.env,
      NOVADEV_WORKTREE: entry.path,
      NOVADEV_BRANCH: entry.branch,
      NOVADEV_BASE: repo.base,
      NOVADEV_CHANGED: changed.map((f) => (repo.rel === '' ? f : f.slice(repo.rel.length + 1))).join('\n'),
    };
    const commands = [...(repo.name === '.' && existsSync(novadevDir(repo.path)) ? [`"${process.execPath}" "${CLI_PATH}" sync --check`] : []), ...(settings.gate[repo.name] ?? [])];
    for (const command of commands) {
      const run = spawnSync(command, { cwd: repo.path, shell: true, encoding: 'utf8', env, timeout: GATE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      const shown = command.includes(CLI_PATH) ? 'novadev sync --check' : command;
      ran.push(`${label(repo)}: ${shown} → ${run.status === 0 ? 'ok' : `FAILED (exit ${run.status ?? 'none'})`}`);
      if (run.status !== 0) {
        const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-5).join('\n      ');
        fails.push(`${label(repo)}: \`${shown}\` failed${tail ? `:\n      ${tail}` : ''}`);
      }
    }
  }
  const lines = fails.length > 0 ? [`✗ gate FAILED for ${entry.name}`, ...fails.map((f) => `  - ${f}`)] : [`✓ gate passed for ${entry.name}`];
  if (ran.length > 0) lines.push('  ran:', ...ran.map((r) => `    ${r}`));
  const shared = policy.mode === 'notice' ? sharedFiles(entry, allChanged) : [];
  if (shared.length > 0) lines.push('  shared with other open worktrees (a notice — the merge checks the combination):', ...shared.slice(0, 15).map((s) => `    ${s}`), ...(shared.length > 15 ? [`    … +${shared.length - 15}`] : []));
  if (fails.length === 0) lines.push('  The merge request still names the targeted checks you ran, with their results (novadev worktree mr).');
  return { passed: fails.length === 0, lines };
}

/**
 * The files this worktree's branch changed that another open worktree is in too: its branch changed
 * the same file, or it (or a lock held in it) claims a path the file lies under. One line per file.
 */
function sharedFiles(entry: RegistryWorktree, changed: readonly string[]): string[] {
  const mine = changed.filter((f) => !f.startsWith(`${ROOT_DIR_NAME}/`));
  if (mine.length === 0) return [];
  const who = new Map<string, string[]>();
  const add = (file: string, what: string) => {
    const list = who.get(file) ?? [];
    if (!list.includes(what)) list.push(what);
    who.set(file, list);
  };
  for (const other of registryWorktrees(entry.main)) {
    if (other.name === entry.name || !existsSync(other.path)) continue;
    const theirs = new Set(reposOf(other).flatMap((repo) => (existsSync(repo.path) ? changedFiles(repo, other.branch) : [])));
    const claims = gateClaims(other);
    for (const file of mine) {
      if (theirs.has(file)) add(file, `also changed in worktree ${other.name}`);
      else if (claims.some((c) => pathWithin(file, c))) add(file, `claimed by worktree ${other.name}`);
    }
  }
  return mine.filter((f) => who.has(f)).map((f) => `${f} — ${who.get(f)!.join('; ')}`);
}

/**
 * The todos a worktree's merge request is about, `<batch>/<todo>`: the ones it was made for and
 * locked (its registry entry), the ones locked in it now, and the ones whose records its branch
 * wrote. Each with its title and its state as the worktree's files have them.
 */
function mrTodos(entry: RegistryWorktree): { ref: string; title: string; state: string }[] {
  const refs = [...entry.todos];
  const add = (ref: string) => void (refs.includes(ref) || refs.push(ref));
  const nd = novadevDir(entry.path);
  for (const lock of registryLocks(entry.main)) {
    if (samePlace(lock.worktree, entry.path) && lock.covers !== null) for (const todo of lock.covers) add(`${lock.batch}/${todo}`);
  }
  const own = reposOf(entry)[0]!;
  const changed = git(entry.path, 'diff', '--name-only', `${own.base}...${entry.branch}`, '--', `${ROOT_DIR_NAME}/todos`);
  for (const file of changed.ok ? changed.out.split('\n') : []) {
    const m = new RegExp(`^${ROOT_DIR_NAME}/todos/([^/]+)/([^/]+)/ai_[^/]+\\.md$`).exec(file);
    if (m) add(`${m[1]}/${m[2]}`);
  }
  return refs.map((ref) => {
    const dir = join(nd, 'todos', ref);
    const brief = join(dir, 'prompt.md');
    return { ref, title: existsSync(brief) ? briefTitle(readFileSync(brief, 'utf8')) : '', state: existsSync(dir) ? todoState(dir, { merged: false }) : 'not in this worktree' };
  });
}

export function mrText(root: string, name: string): string {
  const entry = find(mainCheckout(root), name);
  const todos = mrTodos(entry);
  const lines = [
    `**Merge request: ${entry.name}** — branch \`${entry.branch}\` (worktree \`${entry.path}\`)`,
    ...todos.map((t) => `Todo: \`${t.ref}\`${t.title ? ` — ${t.title}` : ''} (${t.state})`),
    '',
  ];
  for (const repo of reposOf(entry)) {
    if (!existsSync(repo.path)) continue;
    const { ahead, behind } = aheadBehind(repo.path, repo.base, entry.branch);
    if (ahead === 0) continue;
    lines.push(`- **${label(repo)}**: ${ahead} commit(s), ${behind} behind ${repo.base} — ${git(repo.path, 'diff', '--shortstat', `${repo.base}...${entry.branch}`).out}`);
    for (const commit of git(repo.path, 'log', '--format=%h %s', `${repo.base}..${entry.branch}`).out.split('\n').filter(Boolean).slice(0, 30)) {
      const [hash, ...subject] = commit.split(' ');
      lines.push(`  - \`${repo.name === '.' ? hash : `${repo.name}@${hash}`}\` ${subject.join(' ').slice(0, 100)}`);
    }
  }
  const held = registryLocks(entry.main).filter((l) => samePlace(l.worktree, entry.path));
  const batches = held.filter((l) => l.unit === 'batch').map((l) => l.batch);
  const locked = held.filter((l) => l.unit === 'todo').map(lockRef);
  const shared = claimPolicy(entry.main).mode === 'notice' ? sharedFiles(entry, reposOf(entry).flatMap((repo) => (existsSync(repo.path) ? changedFiles(repo, entry.branch) : []))) : [];
  // Area owners (owners.ts): who must review the files this branch changed — nothing in a project without them.
  const reviewers = requiredReviewerLines(existsSync(novadevDir(entry.path)) ? entry.path : entry.main, reposOf(entry).flatMap((repo) => (existsSync(repo.path) ? changedFiles(repo, entry.branch) : [])));
  lines.push(
    ...(reviewers.length > 0 ? ['', ...reviewers] : []),
    '',
    `Claims: ${gateClaims(entry).join(', ') || 'none'}`,
    ...(shared.length > 0 ? ['Shared with other open worktrees (the merge checks the combination):', ...shared.slice(0, 15).map((s) => `- ${s}`), ...(shared.length > 15 ? [`- … +${shared.length - 15}`] : [])] : []),
    ...(locked.length > 0 ? [`Todos in work there: ${locked.join(', ')} — stop (or pause) them before the merge`] : []),
    ...(batches.length > 0 ? [`Batches in work there: ${batches.join(', ')} — stop (or pause) them before the merge`] : []),
    `Gate: run \`novadev worktree gate ${entry.name}\` and paste its result.`,
    'Targeted checks run (command → result): …',
    'What the reviewer should look at first: …',
    'Known risks / not verified: …',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// sync / merge / remove
// ---------------------------------------------------------------------------

export function syncWorktree(root: string, name: string): { ok: boolean; lines: string[] } {
  const entry = find(mainCheckout(root), name);
  const lines: string[] = [];
  for (const repo of reposOf(entry)) {
    if (dirty(repo.path).length > 0) return { ok: false, lines: [...lines, `✗ ${label(repo)}: commit first (uncommitted changes in ${repo.path})`] };
  }
  for (const repo of reposOf(entry)) {
    const before = git(repo.path, 'rev-parse', 'HEAD').out;
    const merge = git(repo.path, 'merge', '--no-edit', repo.base);
    if (!merge.ok) return { ok: false, lines: [...lines, `✗ ${label(repo)}: conflicts merging ${repo.base} — resolve them in ${repo.path}, commit, then sync again`] };
    const moved = git(repo.path, 'rev-parse', 'HEAD').out !== before;
    lines.push(`✓ ${label(repo)}: up to date with ${repo.base}${moved ? '' : ' (nothing new)'}`);
  }
  // Always, not only when the project moved in THIS run: an earlier run may have merged the project
  // and stopped at a sub-repo's conflict before regenerating. Nothing to regenerate = no commit.
  if (existsSync(novadevDir(entry.path))) lines.push(...afterMerge(entry.path));
  return { ok: true, lines };
}

/** `novadev sync --after-merge` in a checkout, as a person would run it. */
function afterMerge(path: string): string[] {
  const run = spawnSync(process.execPath, [CLI_PATH, 'sync', '--after-merge'], { cwd: path, encoding: 'utf8', timeout: GATE_TIMEOUT_MS });
  const said = `${run.stdout ?? ''}`.split('\n').find((l) => l.startsWith('after merge:'));
  return [run.status === 0 ? `  novadev sync --after-merge: ${said?.replace(/^after merge: /, '') ?? 'ok'}` : `  novadev sync --after-merge: PROBLEMS — run \`novadev sync\` in ${path}: ${`${run.stderr ?? ''}${said ?? ''}`.trim().split('\n')[0]}`];
}

/**
 * `worktree merge`: without --yes the dry run; with it, THE merge of this clone (one at a time) —
 * the branch is brought onto the newest default branches, checked there, and only then landed.
 */
export function mergeWorktree(root: string, name: string, yes: boolean): { ok: boolean; lines: string[] } {
  if (!yes) {
    const dry = tryMerge(root, name, false);
    return dry.ok && dry.lines[0]?.startsWith('Dry run') ? { ok: true, lines: [...dry.lines, '  Before anything lands, the gate runs on the merged result (the branch on top of the newest default branches).'] } : dry;
  }
  const main = mainCheckout(root);
  find(main, name);
  return withQueueLock(main, `worktree merge ${name}`, () => {
    const landed = landWorktree(root, name);
    // Landed directly: it no longer waits in the queue.
    if (landed.ok) writeQueue(main, readQueue(main).filter((e) => e.name !== name));
    return landed;
  });
}

function repoHeads(repos: readonly Repo[]): string {
  return repos.map((repo) => git(repo.main, 'rev-parse', repo.base).out).join(' ');
}

/**
 * Land one worktree, as the queue and `worktree merge --yes` both do it (the caller holds the queue
 * lock): every merge is tried first (all or nothing); the default branches are merged INTO the
 * branch, in the worktree, so its tree is the merged result; the gate — and the project's gate
 * commands — run there; and only when they pass is the branch merged into the default branches.
 * Nothing lands on a failure. The merges into the branch stay: they are what `worktree sync` makes,
 * and the builder fixes on top of them.
 */
function landWorktree(root: string, name: string): { ok: boolean; lines: string[]; reason?: string } {
  const entry = find(mainCheckout(root), name);
  const repos = reposOf(entry);
  const lines: string[] = [];
  const stop = (result: { lines: string[] }, extra: string[] = []) => {
    const all = [...lines, ...result.lines, ...extra];
    return { ok: false, lines: all, reason: (result.lines.find((l) => l.startsWith('✗')) ?? result.lines[0] ?? 'failed').replace(/^✗\s*/, '') };
  };
  for (let round = 1; ; round++) {
    const heads = repoHeads(repos);
    const dry = tryMerge(root, name, false);
    if (!dry.ok) return stop(dry);
    if (!dry.lines[0]?.startsWith('Dry run')) return { ok: true, lines: [...lines, ...dry.lines] };
    if (repos.some((repo) => aheadBehind(repo.path, repo.base, entry.branch).behind > 0)) {
      const synced = syncWorktree(root, name);
      if (!synced.ok) {
        for (const repo of repos) git(repo.path, 'merge', '--abort');
        return stop(synced);
      }
      lines.push(...synced.lines.map((l) => l.replace(/^✓ /, '✓ on the newest default branch — ')));
    }
    const gate = gateWorktree(root, name);
    if (!gate.passed) {
      return {
        ok: false,
        lines: [...lines, ...gate.lines, '✗ the checks failed on the merged result — nothing merged. Back to the builder: fix it in the worktree, then queue it again.'],
        reason: `the checks failed on the merged result: ${gate.lines.filter((l) => l.startsWith('  - ')).map((l) => l.slice(4).split('\n')[0]).join('; ') || 'see the gate'}`,
      };
    }
    lines.push('✓ the gate passed on the merged result');
    // Someone committed to a default branch while the checks ran: what was checked is no longer
    // what would land. Again, on the newer one.
    if (repoHeads(repos) !== heads) {
      if (round >= 3) return stop({ lines: ['✗ the default branches keep moving under the merge (three tries) — nothing merged. Nobody commits there while a merge runs; try again.'] });
      lines.push('· a default branch moved while the checks ran — again, on the newest');
      continue;
    }
    const merged = tryMerge(root, name, true);
    return merged.ok ? { ok: true, lines: [...lines, ...merged.lines] } : stop(merged);
  }
}

// ---------------------------------------------------------------------------
// The merge queue
// ---------------------------------------------------------------------------

export function queueAdd(root: string, name: string, opts: { by: string | null; express: boolean }, now: Date = new Date()): string[] {
  const main = mainCheckout(root);
  const entry = find(main, name);
  if (!existsSync(entry.path)) throw new Error(`Worktree ${name} is missing (${entry.path}).`);
  const queue = readQueue(main);
  const was = queue.find((e) => e.name === name);
  // The express lane: asked for (--express), or the worktree carries an urgent todo — as the main
  // checkout or the worktree itself has its priority. It skips no check; it only goes first.
  const urgent = mrTodos(entry).map((t) => t.ref).filter((ref) => [entry.main, entry.path].some((at) => existsSync(join(novadevDir(at), 'todos', ref)) && todoPriority(join(novadevDir(at), 'todos', ref)) === 'urgent'));
  opts = { ...opts, express: opts.express || urgent.length > 0 };
  if (was?.state === 'queued' && was.express === opts.express) {
    return [`· ${name} is in the merge queue already (place ${queueOrder(queue).findIndex((e) => e.name === name) + 1})`];
  }
  const next: QueueEntry[] = [...queue.filter((e) => e.name !== name), { name, state: 'queued', added: now.toISOString(), by: opts.by, express: opts.express }];
  writeQueue(main, next);
  const place = queueOrder(next).findIndex((e) => e.name === name) + 1;
  const lines = [`✓ ${name} queued for merge — place ${place} of ${queueOrder(next).length}${opts.express ? ` (express lane${urgent.length > 0 ? `: urgent ${urgent.join(', ')}` : ''} — behind other express entries, ahead of the rest; every check still runs)` : ''}${was?.state === 'failed' ? ' (again, after its failure)' : ''}`];
  const dry = tryMerge(root, name, false);
  if (!dry.ok) lines.push(`  note: as it stands it would not merge — ${(dry.lines.find((l) => l.startsWith('✗')) ?? dry.lines[0] ?? '').replace(/^✗\s*/, '')}`);
  lines.push('  The lead runs the queue: novadev worktree queue run');
  return lines;
}

export function queueRemove(root: string, name: string): string[] {
  const main = mainCheckout(root);
  const queue = readQueue(main);
  if (!queue.some((e) => e.name === name)) throw new Error(`${name} is not in the merge queue (novadev worktree queue list).`);
  writeQueue(main, queue.filter((e) => e.name !== name));
  return [`✓ ${name} taken out of the merge queue`];
}

/** The queue for `queue list` and `status`: what runs next first, then the failed ones; and the merge running now. */
export function queueData(root: string): { running: { what: string; since: string; pid: number; host: string } | null; entries: (QueueEntry & { position: number | null })[] } {
  const main = mainCheckout(root);
  const queue = readQueue(main);
  const order = queueOrder(queue);
  const lock = queueLockHolder(main);
  return {
    running: lock === null ? null : { what: lock.what, since: lock.at, pid: lock.pid, host: lock.host },
    entries: [...order.map((e, i) => ({ ...e, position: i + 1 })), ...queue.filter((e) => e.state === 'failed').map((e) => ({ ...e, position: null }))],
  };
}

export function queueLines(root: string): string[] {
  const data = queueData(root);
  if (data.entries.length === 0 && data.running === null) return ['the merge queue is empty (novadev worktree queue add <name>)'];
  const lines: string[] = [];
  if (data.running !== null) lines.push(`running: ${data.running.what} (pid ${data.running.pid} on ${data.running.host}, since ${data.running.since})`);
  for (const e of data.entries) {
    lines.push(
      e.state === 'queued'
        ? `${String(e.position).padStart(2)}. ${e.name}${e.express ? '  [express]' : ''}  queued ${e.added}${e.by ? ` by ${e.by}` : ''}`
        : ` ✗ ${e.name}  FAILED ${e.failedAt ?? ''} — ${e.reason ?? 'no reason recorded'} (fix in the worktree, then: novadev worktree queue add ${e.name})`,
    );
  }
  return lines;
}

/**
 * Run the queue: take the head, land it (`landWorktree`), go on to the next — until none waits, or
 * after one with `one`. A failure lands nothing, marks the entry failed with its reason, and the
 * queue goes on. One run at a time in the whole clone.
 */
export function queueRun(root: string, one: boolean, now: () => Date = () => new Date()): { ok: boolean; lines: string[] } {
  const main = mainCheckout(root);
  if (queueOrder(readQueue(main)).length === 0) return { ok: true, lines: ['nothing waits in the merge queue'] };
  return withQueueLock(main, 'worktree queue run', () => {
    const lines: string[] = [];
    let failed = 0;
    let landed = 0;
    const tried = new Set<string>();
    for (;;) {
      // Read again each time: an entry may have been added or removed while a merge ran.
      const head = queueOrder(readQueue(main)).find((e) => !tried.has(e.name));
      if (head === undefined) break;
      tried.add(head.name);
      lines.push(`— ${head.name}${head.express ? ' (express lane)' : ''}`);
      let result: { ok: boolean; lines: string[]; reason?: string };
      try {
        result = landWorktree(root, head.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = { ok: false, lines: [`✗ ${message}`], reason: message };
      }
      lines.push(...result.lines.map((l) => `  ${l}`));
      const queue = readQueue(main);
      if (result.ok) {
        landed++;
        writeQueue(main, queue.filter((e) => e.name !== head.name));
      } else {
        failed++;
        writeQueue(main, queue.map((e) => (e.name === head.name ? { ...e, state: 'failed' as const, reason: (result.reason ?? 'failed').slice(0, 600), failedAt: now().toISOString() } : e)));
        lines.push(`  ✗ ${head.name} failed — nothing of it merged; the queue goes on`);
      }
      if (one) break;
    }
    lines.push(`merge queue: ${landed} landed, ${failed} failed, ${queueOrder(readQueue(main)).length} still waiting`);
    return { ok: failed === 0, lines };
  });
}

/** The merge itself, with every refusal that needs no check to be run: dry (`yes` false) or for real. */
function tryMerge(root: string, name: string, yes: boolean): { ok: boolean; lines: string[] } {
  const entry = find(mainCheckout(root), name);
  const repos = reposOf(entry);
  const lines: string[] = [];
  const stop = (line: string) => ({ ok: false, lines: [...lines, line] });
  for (const repo of repos) {
    if (!existsSync(repo.path)) return stop(`✗ ${label(repo)}: the worktree is missing (${repo.path})`);
    if (dirty(repo.path).length > 0) return stop(`✗ ${label(repo)}: the worktree has uncommitted changes — the builder commits them first`);
    const current = git(repo.main, 'branch', '--show-current').out;
    if (current !== repo.base) return stop(`✗ ${label(repo)}: the main checkout (${repo.main}) is on ${current || 'a detached HEAD'}, not ${repo.base}`);
    if (dirty(repo.main, false).length > 0) return stop(`✗ ${label(repo)}: the main checkout has uncommitted changes — nobody should write there; sort it out first`);
    // git merge-tree cannot see untracked files, and `git merge` refuses to overwrite one: an
    // untracked file the branch would write must go first, or the merge stops half way.
    const writes = new Set(git(repo.main, 'diff', '--name-only', '--diff-filter=AMR', `${repo.base}...${entry.branch}`).out.split('\n').filter(Boolean));
    const blocking = git(repo.main, 'ls-files', '--others', '--exclude-standard').out.split('\n').filter((f) => writes.has(f));
    if (blocking.length > 0) return stop(`✗ ${label(repo)}: the main checkout has untracked files the branch would write (${blocking.slice(0, 5).join(', ')}) — move them away first`);
  }
  // A lock still WORKING on the branch — a todo's or a batch's — would land on the default branch as
  // in work. Only the locks the branch added or changed count, and a paused one may go: its pause
  // record travels on purpose.
  const own = reposOf(entry)[0]!;
  const touched = git(entry.main, 'diff', '--name-only', '--diff-filter=AM', `${own.base}...${entry.branch}`, '--', `${ROOT_DIR_NAME}/todos`).out.split('\n');
  const locks = touched.filter((f) => f.endsWith(`/${WORK_LOCK_FILE}`));
  const working = locks.filter((f) => /^state:\s*working\s*$/m.test(git(entry.main, 'show', `${entry.branch}:${f}`).out));
  if (working.length > 0) {
    const what = working.every((f) => isBatchLock(f)) ? 'a batch' : 'a todo';
    return stop(`✗ the branch carries ${what} still in work (${working.join(', ')}) — stop it (or pause it) in the worktree, commit, then merge`);
  }
  const plan = repos.filter((repo) => aheadBehind(repo.main, repo.base, entry.branch).ahead > 0);
  if (plan.length === 0) return { ok: true, lines: [`nothing to merge: ${entry.branch} has no commit ahead of the default branches`] };
  // All or nothing: every merge is tried first, and nothing merges unless all would.
  for (const repo of plan) {
    const tried = git(repo.main, 'merge-tree', '--write-tree', repo.base, entry.branch);
    if (tried.code === 1) {
      // Two locks 0.17.0 took on parts of one batch share one file, the batch-root working.md: the
      // second paused part cannot land beside the first. (A todo's own lock never meets another.)
      const second = repo.name !== '.' ? [] : locks.filter((f) => isBatchLock(f) && new RegExp(`\\t${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(tried.out));
      if (second.length > 0) {
        return stop(
          `✗ ${label(repo)}: ${entry.branch} carries a paused lock on part of a batch (${second.join(', ')}), and ${repo.base} already holds another part's — two parts of one batch share that one file. Nothing merged. Finish or stop this part in the worktree (\`novadev work stop ${second[0]!.split('/').at(-2)}\`), commit, then merge.`,
        );
      }
      return stop(`✗ ${label(repo)}: ${entry.branch} would conflict with ${repo.base} — nothing merged. Send it back: the builder runs \`novadev worktree sync ${entry.name}\`.`);
    }
    if (!tried.ok) return stop(`✗ ${label(repo)}: git merge-tree could not try the merge (${tried.err.split('\n')[0] || `exit ${tried.code}`}) — it needs git 2.38 or newer. Nothing merged.`);
  }
  const order = [...plan.filter((r) => r.name !== '.'), ...plan.filter((r) => r.name === '.')];
  if (!yes) {
    return { ok: true, lines: ['Dry run — every merge would go through. Add --yes to merge, in this order:', ...order.map((r) => `  ${label(r)}: ${entry.branch} → ${r.base} (${aheadBehind(r.main, r.base, entry.branch).ahead} commit(s))`)] };
  }
  const done: { repo: Repo; before: string }[] = [];
  for (const repo of order) {
    const before = must(git(repo.main, 'rev-parse', 'HEAD'), `git rev-parse (${label(repo)})`);
    const merge = git(repo.main, 'merge', '--no-ff', '-m', `Merge ${entry.branch} (worktree ${entry.name})`, entry.branch);
    if (!merge.ok) {
      git(repo.main, 'merge', '--abort');
      // All or nothing, even when a merge fails late (a hook, a file appearing): the merges this run
      // made are undone — they are its own commits, a moment old, never pushed.
      const undone = [...done].reverse().map(({ repo: r, before: b }) => (git(r.main, 'reset', '--keep', b).ok ? label(r) : `${label(r)} (COULD NOT UNDO — reset it to ${b})`));
      return stop(
        `✗ ${label(repo)}: the merge failed (${(merge.err || merge.out).split('\n')[0] || 'conflicts'}) — aborted there.` +
          (undone.length > 0 ? ` Undone: ${undone.join(', ')}. Nothing is merged.` : ' Nothing is merged.'),
      );
    }
    done.push({ repo, before });
    lines.push(`✓ merged ${entry.branch} into ${label(repo)} ${repo.base}`);
  }
  if (plan.some((r) => r.name === '.') && existsSync(novadevDir(entry.main))) lines.push(...afterMerge(entry.main));
  lines.push(`Next: novadev worktree remove ${entry.name}. Pushing is not novadev's.`);
  return { ok: true, lines };
}

/** Is this path (project-relative) a lock at a batch's root — `.novadev/todos/<batch>/working.md` — not a todo's? */
function isBatchLock(file: string): boolean {
  return file.split('/').length === 4;
}

export function removeWorktree(root: string, name: string, force: boolean): string[] {
  const main = mainCheckout(root);
  const entry = find(main, name);
  if (samePlace(root, entry.path)) throw new Error(`Run it from the main checkout (${entry.main}), not from inside the worktree.`);
  const repos = reposOf(entry).reverse();
  if (!force) {
    for (const repo of repos) {
      if (existsSync(repo.path) && dirty(repo.path).length > 0) throw new Error(`${label(repo)}: uncommitted changes in ${repo.path} — commit them, or --force to drop them.`);
    }
  }
  const lines: string[] = [];
  const itsLocks = registryLocks(main).filter((lock) => samePlace(lock.worktree, entry.path));
  for (const link of entry.links) if (isLink(link)) unlinkSync(link);
  for (const repo of repos) {
    if (existsSync(repo.path)) {
      const removed = git(repo.main, 'worktree', 'remove', ...(force ? ['--force'] : []), repo.path);
      if (!removed.ok) throw new Error(`${label(repo)}: git worktree remove failed: ${removed.err}`);
    }
    const merged = git(repo.main, 'branch', '--merged', repo.base, '--list', entry.branch).out !== '';
    if (merged || force) {
      git(repo.main, 'branch', merged ? '-d' : '-D', entry.branch);
      lines.push(`✓ ${label(repo)}: worktree removed, branch ${entry.branch} ${merged ? 'deleted (merged)' : 'DROPPED (not merged)'}`);
    } else {
      lines.push(`✓ ${label(repo)}: worktree removed, branch ${entry.branch} kept (not merged — --force drops it)`);
    }
  }
  for (const lock of itsLocks) removeRegistryEntry(main, lock);
  removeRegistryWorktree(main, entry.name);
  if (readQueue(main).some((e) => e.name === entry.name)) writeQueue(main, readQueue(main).filter((e) => e.name !== entry.name));
  try {
    if (existsSync(entry.path) && readdirSync(entry.path).length === 0) rmdirSync(entry.path);
  } catch {
    // a folder someone still uses stays
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

const USAGE = `usage: novadev worktree create <name> [<sub-repo>…] [--claim <path>]… [--todo <ref>]… [--allow-overlap]
       novadev worktree claim <name> <path>… [--allow-overlap]
       novadev worktree list [--json]
       novadev worktree status <name>
       novadev worktree gate <name>
       novadev worktree mr <name>
       novadev worktree sync <name>
       novadev worktree merge <name> [--yes]
       novadev worktree queue add <name> [--express] [--agent <actor>] | list [--json] | run [--one] | remove <name>
       novadev worktree remove <name> [--force]`;

export function worktree(args: string[]): void {
  const [command, ...rest] = args;
  const root = requireProjectRoot();
  const flags = rest.filter((a) => a.startsWith('--'));
  const positional: string[] = [];
  const claims: string[] = [];
  const todos: string[] = [];
  let agent: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--claim' || rest[i] === '--todo' || rest[i] === '--agent') {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) return void fail(rest[i] === '--claim' ? '--claim needs a path' : rest[i] === '--agent' ? '--agent needs an actor' : '--todo needs a todo (<batch>/<todo>)');
      if (rest[i] === '--agent') agent = value;
      else (rest[i] === '--claim' ? claims : todos).push(value);
      i++;
    } else if (!rest[i]!.startsWith('--')) positional.push(rest[i]!);
  }
  const known: Record<string, string[]> = { create: ['--claim', '--todo', '--allow-overlap'], claim: ['--allow-overlap'], list: ['--json'], status: [], gate: [], mr: [], sync: [], merge: ['--yes'], remove: ['--force'], queue: ['--json', '--one', '--express', '--agent'] };
  if (command === undefined || !(command in known)) return void fail(USAGE, 2);
  const unknown = flags.filter((f) => !known[command]!.includes(f));
  if (unknown.length > 0) return void fail(`unknown option ${unknown.join(', ')}\n${USAGE}`, 2);
  try {
    switch (command) {
      case 'create':
        if (positional[0] === undefined) return void fail(USAGE, 2);
        console.log(createWorktree(root, positional[0], positional.slice(1), claims, flags.includes('--allow-overlap'), todos).join('\n'));
        return;
      case 'claim':
        if (positional[0] === undefined) return void fail(USAGE, 2);
        console.log(claimWorktree(root, positional[0], positional.slice(1), flags.includes('--allow-overlap')).join('\n'));
        return;
      case 'list': {
        const data = listData(root);
        if (flags.includes('--json')) return void console.log(JSON.stringify({ worktrees: data }, null, 2));
        if (data.length === 0) return void console.log('no worktrees made by novadev (novadev worktree create <name> …)');
        for (const w of data as { name: string; branch: string; path: string; exists: boolean; repos: string[]; claims: string[]; todos: string[]; batches: { batch: string; state: string; ref?: string }[] }[]) {
          // What it is for is said once: a todo in work there is named under "in work".
          const inWork = w.batches.map((b) => `${b.ref ?? b.batch}${b.state === 'paused' ? ' (paused)' : ''}`);
          const waiting = w.todos.filter((todo) => !w.batches.some((b) => b.ref === todo));
          console.log(`${w.name.padEnd(24)} ${w.branch.padEnd(32)} repos: ${w.repos.join(', ') || '-'}  claims: ${w.claims.join(', ') || '-'}${inWork.length > 0 ? `  in work: ${inWork.join(', ')}` : ''}${waiting.length > 0 ? `  for: ${waiting.join(', ')}` : ''}${w.exists ? '' : '  [MISSING]'}`);
        }
        return;
      }
      case 'status':
        console.log(statusLines(root, positional[0]!).join('\n'));
        return;
      case 'gate': {
        const result = gateWorktree(root, positional[0]!);
        console.log(result.lines.join('\n'));
        if (!result.passed) process.exit(1);
        return;
      }
      case 'mr':
        console.log(mrText(root, positional[0]!));
        return;
      case 'sync':
      case 'merge': {
        const result = command === 'sync' ? syncWorktree(root, positional[0]!) : mergeWorktree(root, positional[0]!, flags.includes('--yes'));
        console.log(result.lines.join('\n'));
        if (!result.ok) process.exit(1);
        return;
      }
      case 'queue': {
        const [action, target] = positional;
        if (action === 'list' || action === undefined) {
          if (flags.includes('--json')) return void console.log(JSON.stringify(queueData(root), null, 2));
          return void console.log(queueLines(root).join('\n'));
        }
        if (action === 'run') {
          const result = queueRun(root, flags.includes('--one'));
          console.log(result.lines.join('\n'));
          if (!result.ok) process.exit(1);
          return;
        }
        if ((action !== 'add' && action !== 'remove') || target === undefined) return void fail(USAGE, 2);
        console.log((action === 'add' ? queueAdd(root, target, { by: agent, express: flags.includes('--express') }) : queueRemove(root, target)).join('\n'));
        return;
      }
      case 'remove':
        console.log(removeWorktree(root, positional[0]!, flags.includes('--force')).join('\n'));
        return;
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function fail(message: string, code = 1): never {
  console.error(`novadev worktree: ${message}`);
  process.exit(code);
}
