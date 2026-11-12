// `novadev worktree` (0.16.0): one worktree per task across the project and the sub-repos it
// changes — create, list, status, gate, mr, sync, merge (all or nothing), remove — on real git.
import { describe, expect, test } from 'bun:test';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorktreeSettings } from '../src/worktree.ts';
import { feature, git, project, read, run, setManifest, tempDir, todo, write } from './helpers.ts';

function quiet(repo: string): void {
  git(repo, 'config', 'user.name', 'novadev tests');
  git(repo, 'config', 'user.email', 'novadev@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', '/dev/null');
}

function commit(repo: string, message: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', '--short', 'HEAD').stdout.trim();
}

/** A super-repo on main (deployed, merge rules on) with sub-repos irrippr and irris on master, and a node_modules. */
function superRepo(): { main: string; wts: string } {
  const main = project();
  const wts = join(tempDir(), 'wts');
  setManifest(main, {
    subrepos: ['repos/*'],
    worktree: { dir: wts, share: ['node_modules'], gate: { '.': ['test -f src/app.ts'], irrippr: ['test -n "$NOVADEV_CHANGED"'] } },
  });
  write(main, '.gitignore', 'repos/\nnode_modules/\n');
  write(main, 'node_modules/lib/index.js', 'module.exports = 1;\n');
  write(main, 'src/base.ts', 'export const base = 1;\n');
  todo(main, '2026-11-10_1/01-layout');
  git(main, 'init', '-q', '-b', 'main');
  quiet(main);
  for (const name of ['irrippr', 'irris']) {
    const sub = join(main, 'repos', name);
    write(main, `repos/${name}/a.js`, 'one\n');
    git(sub, 'init', '-q', '-b', 'master');
    quiet(sub);
    commit(sub, 'start');
  }
  expect(run(main, 'deploy').code).toBe(0);
  run(main, 'sync');
  commit(main, 'start');
  return { main, wts };
}

describe('the settings', () => {
  test('every key is checked', () => {
    expect(parseWorktreeSettings(null)).toEqual({ ok: true, value: { dir: null, branchPrefix: '', share: [], linkSubrepos: true, gate: {} } });
    expect(parseWorktreeSettings({ dir: '../_wt', branchPrefix: 'task/', share: ['node_modules'], gate: { '.': ['bun test'] } }).ok).toBe(true);
    expect(parseWorktreeSettings({ folder: 'x' }).ok).toBe(false);
    expect(parseWorktreeSettings({ share: ['a/b'] }).ok).toBe(false);
    expect(parseWorktreeSettings({ gate: { '.': 'bun test' } }).ok).toBe(false);
  });
});

describe('create, list, status', () => {
  test('makes the project and the named sub-repo worktrees on one branch, links the rest, registers it', () => {
    const { main, wts } = superRepo();
    const out = run(main, 'worktree', 'create', 'irr-1', 'irrippr', '--claim', 'src/', '--claim', 'irrippr:ps/');
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(`✓ worktree irr-1 → ${join(wts, 'irr-1')}`);
    expect(out.stdout).toContain('branch irr-1 in: project, irrippr (from project main, irrippr master)');
    expect(out.stdout).toContain('claims: src, repos/irrippr/ps');
    const wt = join(wts, 'irr-1');
    expect(git(wt, 'branch', '--show-current').stdout.trim()).toBe('irr-1');
    expect(git(join(wt, 'repos/irrippr'), 'branch', '--show-current').stdout.trim()).toBe('irr-1');
    expect(lstatSync(join(wt, 'repos/irris')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(wt, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(git(wt, 'status', '--porcelain').stdout.trim()).toBe('');

    const list = JSON.parse(run(main, 'worktree', 'list', '--json').stdout).worktrees;
    expect(list).toMatchObject([{ name: 'irr-1', branch: 'irr-1', repos: ['irrippr'], claims: ['src', 'repos/irrippr/ps'], exists: true }]);
    expect(run(main, 'worktree', 'status', 'irr-1').stdout).toMatch(/project +\+0 commit\(s\), 0 behind main, clean/);
    // novadev status lists it with git's worktrees.
    expect(run(main, 'status').stdout).toContain('worktrees — 2 (* = this one)');
  });

  test('refuses a second worktree of that name, an overlapping claim, an unknown sub-repo, a claim in a sub-repo it lacks', () => {
    const { main } = superRepo();
    run(main, 'worktree', 'create', 'irr-1', 'irrippr', '--claim', 'src/');
    expect(run(main, 'worktree', 'create', 'irr-1').stderr).toContain('A worktree "irr-1" exists already');
    const overlap = run(main, 'worktree', 'create', 'irr-2', '--claim', 'src/app.ts');
    expect(overlap.code).toBe(1);
    expect(overlap.stderr).toContain('src/app.ts overlaps src — claimed by worktree irr-1 in');
    expect(run(main, 'worktree', 'create', 'irr-3', 'paper').stderr).toContain('"paper" is not a sub-repo (sub-repos: irrippr, irris)');
    expect(run(main, 'worktree', 'create', 'irr-4', '--claim', 'irris:x').stderr).toContain('Claimed in a sub-repo this worktree does not have: repos/irris/x');
    expect(run(main, 'worktree', 'create', 'Bad Name').stderr).toContain('cannot name a worktree');
  });

  test('a batch started in the worktree claims against the worktree\'s neighbours, and shows in list', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'irr-1', '--claim', 'src/');
    run(main, 'worktree', 'create', 'irr-2', '--claim', 'docs/');
    const wt2 = join(wts, 'irr-2');
    const refused = run(wt2, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test', '--claim', 'src/x.ts');
    expect(JSON.parse(refused.stdout).error).toContain('src/x.ts overlaps src — claimed by worktree irr-1');
    expect(run(wt2, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test', '--claim', 'docs/a.md').code).toBe(0);
    const list = JSON.parse(run(main, 'worktree', 'list', '--json').stdout).worktrees;
    expect(list[1].batches).toEqual([{ batch: '2026-11-10_1', state: 'working', agent: 'claude-code/test' }]);
  });
});

describe('gate and mr', () => {
  test('passes on committed work inside the claims, and fails on dirt, whitespace or a change outside them', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'irr-1', 'irrippr', '--claim', 'src/', '--claim', 'irrippr:a.js');
    const wt = join(wts, 'irr-1');
    write(wt, 'src/app.ts', 'export const app = 1;\n');
    commit(wt, 'app');
    write(wt, 'repos/irrippr/a.js', 'two\n');
    const subHash = commit(join(wt, 'repos/irrippr'), 'two');
    const passed = run(main, 'worktree', 'gate', 'irr-1');
    expect(passed.stdout).toContain('✓ gate passed for irr-1');
    expect(passed.stdout).toContain('project: novadev sync --check → ok');
    expect(passed.stdout).toContain('project: test -f src/app.ts → ok');
    expect(passed.stdout).toContain('irrippr: test -n "$NOVADEV_CHANGED" → ok');
    expect(passed.code).toBe(0);

    const mr = run(main, 'worktree', 'mr', 'irr-1').stdout;
    expect(mr).toContain('**Merge request: irr-1** — branch `irr-1`');
    expect(mr).toContain(`\`irrippr@${subHash}\` two`);
    expect(mr).toContain('Claims: src, repos/irrippr/a.js');

    write(wt, 'docs/notes.md', 'trailing   \n');
    commit(wt, 'notes');
    write(wt, 'src/wip.ts', 'x\n');
    const failed = run(main, 'worktree', 'gate', 'irr-1');
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain('project: 1 uncommitted change(s)');
    expect(failed.stdout).toContain('project: whitespace errors');
    expect(failed.stdout).toContain('project: changed outside the claims (src, repos/irrippr/a.js): docs/notes.md');
  });
});

describe('claims added after create (batch 2026-11-12_1, todos 01 and 04)', () => {
  test('the gate accepts a file `work claim` added to the batch locked there (a lock written by 0.16.0 too); a file under neither still fails', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'irr-1', '--claim', 'src/a.ts');
    const wt = join(wts, 'irr-1');
    expect(run(wt, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test').code).toBe(0);
    expect(run(wt, 'work', 'claim', '2026-11-10_1', 'lib/b.ts').code).toBe(0);
    // The worktree took the claim too, so the gate still accepts it once the lock is released.
    expect(JSON.parse(run(main, 'worktree', 'list', '--json').stdout).worktrees[0].claims).toEqual(['src/a.ts', 'lib/b.ts']);
    // As 0.16.0 left it: the claim in the batch's registry entry only, the worktree's entry untouched.
    const registry = join(main, '.git', 'novadev');
    const patch = (rel: string, claims: string[]) => write(registry, rel, JSON.stringify({ ...JSON.parse(read(registry, rel)), claims }));
    patch('worktrees/irr-1.json', ['src/a.ts']);
    patch('locks/2026-11-10_1.json', ['lib/b.ts']);

    write(wt, 'src/a.ts', 'a\n');
    write(wt, 'lib/b.ts', 'b\n');
    commit(wt, 'a and b');
    expect(run(main, 'worktree', 'gate', 'irr-1').stdout).not.toContain('changed outside the claims');
    expect(run(main, 'worktree', 'mr', 'irr-1').stdout).toContain('Claims: src/a.ts, lib/b.ts');

    write(wt, 'docs/c.md', 'c\n');
    commit(wt, 'c');
    const failed = run(main, 'worktree', 'gate', 'irr-1');
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain('project: changed outside the claims (src/a.ts, lib/b.ts): docs/c.md');
  });

  test('`work start` in a worktree claims the worktree\'s files, not its features\' folders; `worktree claim` adds a file with the overlap check, and the gate sees it', () => {
    const { main, wts } = superRepo();
    feature(main, 'FEAT-0001', 'layout', { touches: 'src/' });
    write(main, '.novadev/todos/2026-11-10_1/01-layout/prompt.md', '# prompt\n\n**Feature:** FEAT-0001\n\nLayout.\n');
    commit(main, 'feature');
    // W2 holds the file F (src/f.ts) inside the folder D (src/) that W1's batch's feature touches.
    run(main, 'worktree', 'create', 'w2', '--claim', 'src/f.ts');
    run(main, 'worktree', 'create', 'w1', '--claim', 'src/g.ts');
    const w1 = join(wts, 'w1');
    const started = JSON.parse(run(w1, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test').stdout);
    expect(started.claims).toEqual(['src/g.ts']);
    expect(started.claimsFrom).toEqual({ given: [], features: {}, worktree: ['src/g.ts'] });
    // Outside a worktree, the same batch still claims its features' folders (and is refused here).
    expect(JSON.parse(run(main, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test', '--take').stdout).error).toContain('src overlaps src/f.ts — claimed by worktree w2');

    const refused = run(main, 'worktree', 'claim', 'w1', 'src/f.ts');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('src/f.ts overlaps src/f.ts — claimed by worktree w2 in');
    expect(refused.stderr).toContain('--allow-overlap when they decided the two may share');
    const allowed = run(main, 'worktree', 'claim', 'w1', 'src/f.ts', '--allow-overlap');
    expect(allowed.code).toBe(0);
    expect(allowed.stdout).toContain('✓ worktree w1 claims src/f.ts');
    expect(allowed.stdout).toContain('  overlaps (allowed): src/f.ts overlaps src/f.ts — claimed by worktree w2');
    expect(allowed.stdout).toContain('  claims: src/g.ts, src/f.ts');
    expect(run(main, 'worktree', 'claim', 'w1', './src/f.ts').stdout).toContain('· worktree w1 holds src/f.ts already');
    expect(run(main, 'worktree', 'claim', 'w1', 'irrippr:x.js').stderr).toContain('Claimed in a sub-repo this worktree does not have: repos/irrippr/x.js');
    expect(run(main, 'worktree', 'claim', 'w1', 'x', '--claim', 'y').stderr).toContain('unknown option --claim');

    write(w1, 'src/f.ts', 'f\n');
    commit(w1, 'f');
    const gate = run(main, 'worktree', 'gate', 'w1').stdout;
    expect(gate).toContain('ran:');
    expect(gate).not.toContain('changed outside the claims');
  });

  test('`work claim` on a paused lock and `work start` agree: a claim accepted once is not judged again on resume', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'w2', '--claim', 'src/f.ts');
    run(main, 'worktree', 'create', 'w1', '--claim', 'src/g.ts');
    const w1 = join(wts, 'w1');
    run(w1, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test');
    write(w1, 'pause.json', JSON.stringify({ stopped: 'Half way.', next: ['Go on.'] }));
    run(w1, 'work', 'pause', '2026-11-10_1', 'pause.json');
    expect(JSON.parse(run(w1, 'work', 'claim', '2026-11-10_1', 'src/f.ts').stdout).error).toContain('src/f.ts overlaps src/f.ts');
    expect(JSON.parse(run(w1, 'work', 'claim', '2026-11-10_1', 'src/f.ts', '--allow-overlap').stdout).added).toEqual(['src/f.ts']);
    const resumed = JSON.parse(run(w1, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test').stdout);
    expect(resumed.resumed).toBe(true);
    expect(resumed.claims).toEqual(['src/g.ts', 'src/f.ts']);
    // A NEW claim on start is still judged.
    expect(JSON.parse(run(w1, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test', '--claim', 'src').stdout).error).toContain('src overlaps src/f.ts — claimed by worktree w2');
  });
});

describe('sync, merge and remove', () => {
  test('merge: a dry run first, then sub-repos and the project, novadev sync --after-merge; remove cleans up', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'irr-1', 'irrippr');
    const wt = join(wts, 'irr-1');
    write(wt, 'src/app.ts', 'export const app = 1;\n');
    commit(wt, 'app');
    write(wt, 'repos/irrippr/a.js', 'two\n');
    commit(join(wt, 'repos/irrippr'), 'two');

    const dry = run(main, 'worktree', 'merge', 'irr-1');
    expect(dry.stdout).toContain('Dry run — every merge would go through. Add --yes to merge, in this order:');
    expect(dry.stdout.indexOf('irrippr: irr-1 → master')).toBeLessThan(dry.stdout.indexOf('project: irr-1 → main'));
    expect(existsSync(join(main, 'src/app.ts'))).toBe(false);

    const merged = run(main, 'worktree', 'merge', 'irr-1', '--yes');
    expect(merged.code).toBe(0);
    expect(merged.stdout).toContain('✓ merged irr-1 into irrippr master');
    expect(merged.stdout).toContain('✓ merged irr-1 into project main');
    expect(merged.stdout).toContain('novadev sync --after-merge:');
    expect(read(main, 'src/app.ts')).toContain('app');
    expect(read(main, 'repos/irrippr/a.js')).toBe('two\n');

    const removed = run(main, 'worktree', 'remove', 'irr-1');
    expect(removed.stdout).toContain('✓ project: worktree removed, branch irr-1 deleted (merged)');
    expect(removed.stdout).toContain('✓ irrippr: worktree removed, branch irr-1 deleted (merged)');
    expect(existsSync(wt)).toBe(false);
    expect(JSON.parse(run(main, 'worktree', 'list', '--json').stdout).worktrees).toEqual([]);
    expect(existsSync(join(main, 'repos/irris/a.js'))).toBe(true);
  });

  test('all or nothing: a conflict anywhere merges nothing; a dirty main checkout or a lock on the branch refuses', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'irr-1', 'irrippr');
    const wt = join(wts, 'irr-1');
    write(wt, 'src/base.ts', 'export const base = 2;\n');
    commit(wt, 'base 2');
    write(wt, 'repos/irrippr/a.js', 'two\n');
    commit(join(wt, 'repos/irrippr'), 'two');
    write(main, 'src/base.ts', 'export const base = 3;\n');
    commit(main, 'base 3');
    const conflict = run(main, 'worktree', 'merge', 'irr-1', '--yes');
    expect(conflict.code).toBe(1);
    expect(conflict.stdout).toContain('✗ project: irr-1 would conflict with main — nothing merged');
    expect(read(main, 'repos/irrippr/a.js')).toBe('one\n');

    write(main, 'src/base.ts', 'dirty\n');
    expect(run(main, 'worktree', 'merge', 'irr-1').stdout).toContain('✗ project: the main checkout has uncommitted changes');
    git(main, 'checkout', '--', 'src/base.ts');

    git(wt, 'reset', '-q', '--hard', 'HEAD~1');
    expect(run(wt, 'work', 'start', '2026-11-10_1', '--agent', 'claude-code/test').code).toBe(0);
    commit(wt, 'lock');
    expect(run(main, 'worktree', 'merge', 'irr-1').stdout).toContain('✗ the branch carries a batch still in work (.novadev/todos/2026-11-10_1/working.md)');
  });

  test('sync merges the default branches into the worktree; remove keeps an unmerged branch unless --force', () => {
    const { main, wts } = superRepo();
    run(main, 'worktree', 'create', 'irr-1');
    const wt = join(wts, 'irr-1');
    write(main, 'src/later.ts', 'later\n');
    commit(main, 'later');
    const synced = run(main, 'worktree', 'sync', 'irr-1');
    expect(synced.stdout).toContain('✓ project: up to date with main');
    expect(read(wt, 'src/later.ts')).toBe('later\n');

    write(wt, 'src/mine.ts', 'mine\n');
    commit(wt, 'mine');
    write(wt, 'src/wip.ts', 'wip\n');
    expect(run(main, 'worktree', 'remove', 'irr-1').stderr).toContain('project: uncommitted changes');
    expect(run(wt, 'worktree', 'remove', 'irr-1').stderr).toContain('Run it from the main checkout');
    const forced = run(main, 'worktree', 'remove', 'irr-1', '--force');
    expect(forced.stdout).toContain('branch irr-1 DROPPED (not merged)');
    expect(git(main, 'branch', '--list', 'irr-1').stdout.trim()).toBe('');
  });
});

describe('the docs', () => {
  const readme = require('node:fs').readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8') as string;

  test('the README documents every new setting, and its worktree example is what the parser accepts', () => {
    for (const key of ['"defaultBranch"', '"subrepos"', '"team"', '"worktree"', 'branchPrefix', 'linkSubrepos', '`share`', '`gate`']) {
      expect(readme).toContain(key);
    }
    const example = /```json\n("worktree": \{[\s\S]*?\n\})\n```/.exec(readme);
    expect(example).not.toBeNull();
    const parsed = parseWorktreeSettings(JSON.parse(`{${example![1]}}`).worktree);
    expect(parsed.ok).toBe(true);
  });

  test('the CLI help names the new commands and flags', () => {
    const help = run(tempDir(), 'help').stdout;
    for (const words of ['novadev worktree', '--after-merge', '"claim <batch> <path>…"', '"review <ref> <payload.json>"', 'on the default branch only', '"claim <name>', '--todo <nn|slug>']) {
      expect(help).toContain(words);
    }
  });
});
