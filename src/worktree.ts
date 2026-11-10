// `novadev worktree` — one isolated worktree per task, across the project and the sub-repos it
// changes, on one branch. Generalised from the IRRIS company's `irris-worktree` (2026-11-10).
//
//   novadev worktree create <name> [<sub-repo>…] [--claim <path>]…   make it (the builder)
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
// worktree or of a batch in work elsewhere is refused. The gate fails on a change outside them.
//
// The merge: on the main checkout, every repository on its default branch with no uncommitted
// change; every merge is first tried with `git merge-tree` and nothing is merged unless all of them
// would go through; then sub-repos first and the project last (its records never land without their
// code), `--no-ff`; then `novadev sync --after-merge` regenerates and commits novadev's files. A
// branch that still carries a batch's lock (working.md) is not merged: stop or pause it first.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { projectDefaultBranch } from './branch.ts';
import { commonGitDir, defaultBranch, worktreeList } from './git.ts';
import { type Parsed, ROOT_DIR_NAME, WORK_LOCK_FILE, isPlainObject, novadevDir, packageDir, pathWithin, readManifest, refuse, requireProjectRoot } from './lib.ts';
import {
  type RegistryWorktree,
  claimHolders,
  claimOverlaps,
  normalizeClaim,
  overlapText,
  registryLocks,
  registryWorktrees,
  removeRegistryLock,
  removeRegistryWorktree,
  samePlace,
  writeRegistryWorktree,
} from './registry.ts';
import { forgetSubrepos, listSubrepos } from './subrepos.ts';

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

export function createWorktree(root: string, name: string, repoNames: readonly string[], rawClaims: readonly string[], allowOverlap = false): string[] {
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

  const claims: string[] = [];
  for (const raw of rawClaims) {
    const claim = normalizeClaim(main, raw);
    if (!claim.ok) throw new Error(claim.error);
    if (!claims.includes(claim.value)) claims.push(claim.value);
  }
  const outside = claims.filter((c) => subrepos.repos.some((r) => pathWithin(c, r.rel) && !chosen.includes(r)));
  if (outside.length > 0) throw new Error(`Claimed in a sub-repo this worktree does not have: ${outside.join(', ')} — name the sub-repo on create.`);
  const overlaps = claimOverlaps(main, claims, undefined, claimHolders(main, null));
  if (overlaps.length > 0 && !allowOverlap) {
    throw new Error(`One owner per file — these claims are taken:\n${overlaps.map((o) => `  ${overlapText(o)}`).join('\n')}\nAsk the lead; --allow-overlap when they decided the two may share.`);
  }

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
    name, branch, path, main, repos: chosen.map((r) => ({ name: r.name, rel: r.rel })), claims, links, base, created: new Date().toISOString(),
  });
  lines.push(`✓ worktree ${name} → ${path}`);
  lines.push(`  branch ${branch} in: project${chosen.map((r) => `, ${r.name}`).join('')} (from ${Object.entries(base).map(([k, b]) => `${k === '.' ? 'project' : k} ${b.branch}`).join(', ')})`);
  if (claims.length > 0) lines.push(`  claims: ${claims.join(', ')}`);
  if (overlaps.length > 0) lines.push(`  overlaps (allowed): ${overlaps.map(overlapText).join('; ')}`);
  if (links.length > 0) lines.push(`  linked from the main checkout: ${links.map((l) => relative(path, l)).join(', ')}`);
  lines.push('  Work and commit only there. When done: novadev worktree gate, then novadev worktree mr.');
  return lines;
}

// ---------------------------------------------------------------------------
// list / status
// ---------------------------------------------------------------------------

export function listData(root: string): Record<string, unknown>[] {
  const main = mainCheckout(root);
  const locks = registryLocks(main);
  return registryWorktrees(main).map((w) => ({
    name: w.name,
    branch: w.branch,
    path: w.path,
    exists: existsSync(w.path),
    repos: w.repos.map((r) => r.name),
    claims: w.claims,
    batches: locks.filter((l) => samePlace(l.worktree, w.path)).map((l) => ({ batch: l.batch, state: l.state, agent: l.agent })),
  }));
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

export function gateWorktree(root: string, name: string): { passed: boolean; lines: string[] } {
  const entry = find(mainCheckout(root), name);
  const settings = settingsOf(entry.main);
  const fails: string[] = [];
  const ran: string[] = [];
  for (const repo of reposOf(entry)) {
    if (!existsSync(repo.path)) {
      fails.push(`${label(repo)}: the worktree is missing (${repo.path})`);
      continue;
    }
    const changes = dirty(repo.path);
    if (changes.length > 0) fails.push(`${label(repo)}: ${changes.length} uncommitted change(s) — commit or drop them first`);
    if (!git(repo.path, 'diff', '--check', `${repo.base}...${entry.branch}`).ok) fails.push(`${label(repo)}: whitespace errors (git diff --check ${repo.base}...${entry.branch})`);
    const changed = changedFiles(repo, entry.branch);
    if (entry.claims.length > 0) {
      const outside = changed.filter((f) => !f.startsWith(`${ROOT_DIR_NAME}/`) && !entry.claims.some((c) => pathWithin(f, c)));
      if (outside.length > 0) fails.push(`${label(repo)}: changed outside the claims (${entry.claims.join(', ')}): ${outside.slice(0, 10).join(', ')}${outside.length > 10 ? ` … +${outside.length - 10}` : ''}`);
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
  if (fails.length === 0) lines.push('  The merge request still names the targeted checks you ran, with their results (novadev worktree mr).');
  return { passed: fails.length === 0, lines };
}

export function mrText(root: string, name: string): string {
  const entry = find(mainCheckout(root), name);
  const lines = [`**Merge request: ${entry.name}** — branch \`${entry.branch}\` (worktree \`${entry.path}\`)`, ''];
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
  const batches = registryLocks(entry.main).filter((l) => samePlace(l.worktree, entry.path)).map((l) => l.batch);
  lines.push(
    '',
    `Claims: ${entry.claims.join(', ') || 'none'}`,
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

export function mergeWorktree(root: string, name: string, yes: boolean): { ok: boolean; lines: string[] } {
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
  // A batch still WORKING on the branch would land on the default branch as in work. Only the locks
  // the branch added or changed count, and a paused one may go: its pause record travels on purpose.
  const own = reposOf(entry)[0]!;
  const touched = git(entry.main, 'diff', '--name-only', '--diff-filter=AM', `${own.base}...${entry.branch}`, '--', `${ROOT_DIR_NAME}/todos`).out.split('\n');
  const working = touched
    .filter((f) => f.endsWith(`/${WORK_LOCK_FILE}`))
    .filter((f) => /^state:\s*working\s*$/m.test(git(entry.main, 'show', `${entry.branch}:${f}`).out));
  if (working.length > 0) return stop(`✗ the branch carries a batch still in work (${working.join(', ')}) — stop it (or pause it) in the worktree, commit, then merge`);
  const plan = repos.filter((repo) => aheadBehind(repo.main, repo.base, entry.branch).ahead > 0);
  if (plan.length === 0) return { ok: true, lines: [`nothing to merge: ${entry.branch} has no commit ahead of the default branches`] };
  // All or nothing: every merge is tried first, and nothing merges unless all would.
  for (const repo of plan) {
    const tried = git(repo.main, 'merge-tree', '--write-tree', repo.base, entry.branch);
    if (tried.code === 1) return stop(`✗ ${label(repo)}: ${entry.branch} would conflict with ${repo.base} — nothing merged. Send it back: the builder runs \`novadev worktree sync ${entry.name}\`.`);
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
  for (const lock of itsLocks) removeRegistryLock(main, lock.batch, true);
  removeRegistryWorktree(main, entry.name);
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

const USAGE = `usage: novadev worktree create <name> [<sub-repo>…] [--claim <path>]… [--allow-overlap]
       novadev worktree list [--json]
       novadev worktree status <name>
       novadev worktree gate <name>
       novadev worktree mr <name>
       novadev worktree sync <name>
       novadev worktree merge <name> [--yes]
       novadev worktree remove <name> [--force]`;

export function worktree(args: string[]): void {
  const [command, ...rest] = args;
  const root = requireProjectRoot();
  const flags = rest.filter((a) => a.startsWith('--'));
  const positional: string[] = [];
  const claims: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--claim') {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) return void fail('--claim needs a path');
      claims.push(value);
      i++;
    } else if (!rest[i]!.startsWith('--')) positional.push(rest[i]!);
  }
  const known: Record<string, string[]> = { create: ['--claim', '--allow-overlap'], list: ['--json'], status: [], gate: [], mr: [], sync: [], merge: ['--yes'], remove: ['--force'] };
  if (command === undefined || !(command in known)) return void fail(USAGE, 2);
  const unknown = flags.filter((f) => !known[command]!.includes(f));
  if (unknown.length > 0) return void fail(`unknown option ${unknown.join(', ')}\n${USAGE}`, 2);
  try {
    switch (command) {
      case 'create':
        if (positional[0] === undefined) return void fail(USAGE, 2);
        console.log(createWorktree(root, positional[0], positional.slice(1), claims, flags.includes('--allow-overlap')).join('\n'));
        return;
      case 'list': {
        const data = listData(root);
        if (flags.includes('--json')) return void console.log(JSON.stringify({ worktrees: data }, null, 2));
        if (data.length === 0) return void console.log('no worktrees made by novadev (novadev worktree create <name> …)');
        for (const w of data as { name: string; branch: string; path: string; exists: boolean; repos: string[]; claims: string[]; batches: { batch: string; state: string }[] }[]) {
          console.log(`${w.name.padEnd(24)} ${w.branch.padEnd(32)} repos: ${w.repos.join(', ') || '-'}  claims: ${w.claims.join(', ') || '-'}${w.batches.length > 0 ? `  in work: ${w.batches.map((b) => `${b.batch}${b.state === 'paused' ? ' (paused)' : ''}`).join(', ')}` : ''}${w.exists ? '' : '  [MISSING]'}`);
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
