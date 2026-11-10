// Locks every worktree sees, and claims between batches (0.16.0): the registry in the common git
// folder (src/registry.ts), mirrored by every `novadev work` command.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { commitAll, completed, feature, git, project, read, run, setManifest, tempDir, todo, write } from './helpers.ts';

const AGENT = 'claude-code/test';

/** A project in git on main with two batches, committed, and a second worktree on branch task/a. */
function twoWorktrees(): { main: string; wt: string } {
  const main = project();
  feature(main, 'FEAT-0001', 'auth', { touches: 'src/auth/' });
  todo(main, '2026-11-10_1/01-login');
  todo(main, '2026-11-10_2/01-export');
  git(main, 'init', '-q', '-b', 'main');
  commitAll(main);
  const wt = join(tempDir(), 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'task/a', wt);
  return { main, wt };
}

function json(out: { stdout: string }): Record<string, any> {
  return JSON.parse(out.stdout);
}

function registryEntry(main: string, batch: string): Record<string, any> | null {
  const path = join(main, '.git', 'novadev', 'locks', `${batch}.json`);
  return existsSync(path) ? JSON.parse(read('/', path.slice(1))) : null;
}

describe('a lock is visible from every worktree', () => {
  test('a batch taken in one worktree is listed by status and sync in the other', () => {
    const { main, wt } = twoWorktrees();
    expect(run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT).code).toBe(0);
    const entry = registryEntry(main, '2026-11-10_1')!;
    expect(entry.branch).toBe('task/a');
    expect(entry.state).toBe('working');

    const status = run(main, 'status').stdout;
    expect(status).toContain('worktrees — 2 (* = this one)');
    expect(status).toMatch(/\* \S+ {2}main {2}\[main checkout\]/);
    expect(status).toMatch(/\/wt {2}task\/a — 2026-11-10_1 in work \(claude-code\/test\)/);
    const data = json(run(main, 'status', '--json'));
    expect(data.worktrees).toHaveLength(2);
    expect(data.worktrees[1].batches[0].batch).toBe('2026-11-10_1');

    expect(run(main, 'sync').stdout).toMatch(/◦ 2026-11-10_1 — WORKING in another worktree: \S+\/wt \(branch task\/a\) — claude-code\/test/);
  });

  test('starting it in another worktree is refused while it is live, and --take moves it', () => {
    const { main, wt } = twoWorktrees();
    run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT);
    const refused = run(main, 'work', 'start', '2026-11-10_1', '--agent', AGENT);
    expect(refused.code).toBe(1);
    expect(json(refused).error).toContain('Batch 2026-11-10_1 is in work in another worktree:');
    const taken = json(run(main, 'work', 'start', '2026-11-10_1', '--agent', AGENT, '--take'));
    expect(taken.takenFromWorktree.branch).toBe('task/a');
    expect(registryEntry(main, '2026-11-10_1')!.branch).toBe('main');
  });

  test('a batch paused in another worktree resumes there, not here', () => {
    const { main, wt } = twoWorktrees();
    run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT);
    write(wt, 'pause.json', JSON.stringify({ stopped: 'Half of the login form.', next: ['Finish it.'] }));
    expect(run(wt, 'work', 'pause', '2026-11-10_1', 'pause.json').code).toBe(0);
    expect(registryEntry(main, '2026-11-10_1')!.state).toBe('paused');
    expect(json(run(main, 'work', 'start', '2026-11-10_1', '--agent', AGENT)).error).toContain('is paused in another worktree');
  });

  test('an abandoned lock elsewhere is taken over; one whose worktree is gone is pruned', () => {
    const { main, wt } = twoWorktrees();
    const locks = join(main, '.git', 'novadev', 'locks');
    mkdirSync(locks, { recursive: true });
    const base = { state: 'working', agent: 'claude-code/other', host: hostname(), session: null, started: '2026-11-10T08:00:00+01:00', updated: new Date().toISOString(), todo: null, phase: null, claims: [] };
    // In the real second worktree, but its process (on this host) is gone: abandoned.
    writeFileSync(join(locks, '2026-11-10_1.json'), JSON.stringify({ ...base, batch: '2026-11-10_1', worktree: wt, branch: 'task/a', pid: 2 ** 22 + 12345 }));
    // In a folder that is no worktree of this repository at all: gone.
    writeFileSync(join(locks, '2026-11-10_2.json'), JSON.stringify({ ...base, batch: '2026-11-10_2', worktree: '/nowhere/at/all', branch: 'y', pid: null }));
    expect(run(main, 'sync').stdout).toContain('◦ 2026-11-10_1 — ABANDONED in another worktree');
    const taken = json(run(main, 'work', 'start', '2026-11-10_1', '--agent', AGENT));
    expect(taken.takenFromWorktree).toMatchObject({ branch: 'task/a', agent: 'claude-code/other' });
    expect(registryEntry(main, '2026-11-10_1')!.worktree).toBe(main);
    expect(run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT).code).toBe(0);
    expect(registryEntry(main, '2026-11-10_2')!.worktree).toBe(main);
  });

  test('stop releases the entry, and then the other worktree may start', () => {
    const { main, wt } = twoWorktrees();
    run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT);
    expect(run(wt, 'work', 'stop', '2026-11-10_1').code).toBe(0);
    expect(registryEntry(main, '2026-11-10_1')).toBeNull();
    expect(run(main, 'work', 'start', '2026-11-10_1', '--agent', AGENT).code).toBe(0);
  });

  test('a finished batch in work elsewhere is not complete here, nor archivable', () => {
    const { main, wt } = twoWorktrees();
    run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT);
    write(main, '.novadev/todos/2026-11-10_1/01-login/ai_completed.md', completed('01-login'));
    run(main, 'sync');
    expect(existsSync(join(main, '.novadev/todos/2026-11-10_1/completed.md'))).toBe(false);
    const archived = run(main, 'archive', '2026-11-10_1');
    expect(archived.code).toBe(1);
    expect(archived.stderr).toContain('is in work in another worktree');
  });

  test('`todo addendum` is refused behind a live lock in another worktree', () => {
    const { main, wt } = twoWorktrees();
    run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT);
    write(main, 'add.json', JSON.stringify({ text: 'Also the logout.' }));
    const out = run(main, 'todo', 'addendum', '2026-11-10_1/01-login', 'add.json');
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('is in work right now in another worktree');
  });
});

describe('claims: one owner per file', () => {
  test('overlapping claims are refused across worktrees, and --allow-overlap lets the lead decide', () => {
    const { main, wt } = twoWorktrees();
    const first = json(run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT, '--claim', 'src/auth/'));
    expect(first.claims).toEqual(['src/auth']);
    expect(read(wt, '.novadev/todos/2026-11-10_1/working.md')).toContain('claims: src/auth');

    const refused = run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT, '--claim', './src/auth/login.ts');
    expect(refused.code).toBe(1);
    expect(json(refused).error).toContain('src/auth/login.ts overlaps src/auth — claimed by batch 2026-11-10_1 in');
    expect(json(refused).error).toContain('on branch task/a');

    const allowed = json(run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT, '--claim', 'src/auth/login.ts', '--allow-overlap'));
    expect(allowed.overlaps[0]).toContain('src/auth/login.ts overlaps src/auth');
  });

  test('neighbouring paths are not an overlap; `work claim` adds and checks', () => {
    const { main, wt } = twoWorktrees();
    run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT, '--claim', 'src/auth');
    const started = json(run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT, '--claim', 'src/auth2'));
    expect(started.claims).toEqual(['src/auth2']);
    const added = json(run(main, 'work', 'claim', '2026-11-10_2', 'docs/'));
    expect(added.claims).toEqual(['src/auth2', 'docs']);
    const refused = run(main, 'work', 'claim', '2026-11-10_2', 'src/auth/x.ts');
    expect(refused.code).toBe(1);
    expect(json(refused).error).toContain('src/auth/x.ts overlaps src/auth');
    expect(registryEntry(main, '2026-11-10_2')!.claims).toEqual(['src/auth2', 'docs']);
  });

  test('a batch claims the touches of the features its files name', () => {
    const { main } = twoWorktrees();
    write(main, '.novadev/todos/2026-11-10_1/01-login/prompt.md', '# prompt\n\n**Feature:** FEAT-0001\n\nFix login.\n');
    const started = json(run(main, 'work', 'start', '2026-11-10_1', '--agent', AGENT));
    expect(started.claims).toEqual(['src/auth']);
    expect(started.claimsFrom.features).toEqual({ 'FEAT-0001': ['src/auth'] });
  });

  test('a batch that claims nothing is told so; a claim outside the project is refused', () => {
    const { main } = twoWorktrees();
    expect(json(run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT)).claimNote).toContain('this batch claims no path');
    expect(json(run(main, 'work', 'claim', '2026-11-10_2', '../elsewhere')).error).toContain('must be a path inside the project');
  });

  test('a claim may name a sub-repo path as <repo>:<path>', () => {
    const { main } = twoWorktrees();
    setManifest(main, { subrepos: ['repos/*'] });
    write(main, 'repos/irrippr/ps/a.js', 'a\n');
    git(join(main, 'repos/irrippr'), 'init', '-q');
    const started = json(run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT, '--claim', 'irrippr:ps/layouting/'));
    expect(started.claims).toEqual(['repos/irrippr/ps/layouting']);
    expect(json(run(main, 'work', 'claim', '2026-11-10_2', 'irris:x')).error).toContain('"irris" is not a sub-repo');
  });
});
