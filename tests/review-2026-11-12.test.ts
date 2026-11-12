// The independent review of batch 2026-11-12_2, before the release: each finding as a test.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { claimPolicy, parseProtectedPaths, protectedBy } from '../src/claim-policy.ts';
import { completed, exists, git, project, read, run, setManifest, tempDir, todo, write } from './helpers.ts';

function commit(at: string, message: string): void {
  git(at, 'add', '-A');
  git(at, 'commit', '-q', '-m', message);
}

function repo(manifest: Record<string, unknown> = {}, gate: string[] = []): { main: string; wts: string } {
  const main = project();
  const wts = join(tempDir(), 'wts');
  setManifest(main, { worktree: { dir: wts, gate: { '.': gate } }, ...manifest });
  for (const t of ['01-one', '02-two', '03-hotfix']) todo(main, `2026-11-12_2/${t}`);
  write(main, 'src/base.ts', 'base\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.name', 'novadev tests');
  git(main, 'config', 'user.email', 'novadev@example.invalid');
  git(main, 'config', 'commit.gpgsign', 'false');
  git(main, 'config', 'core.hooksPath', '/dev/null');
  expect(run(main, 'deploy').code).toBe(0);
  run(main, 'sync');
  commit(main, 'start');
  return { main, wts };
}

describe('what is checked is what lands', () => {
  test('a commit added to the branch while the gate runs does not land: the entry fails, nothing merges', () => {
    // The gate command itself adds a commit once — a builder still committing while the lead merges.
    const sneak = 'test -f "$NOVADEV_WORKTREE/../sneaked" || { touch "$NOVADEV_WORKTREE/../sneaked"; echo x > UNCHECKED.txt; git add UNCHECKED.txt; git -c user.name=t -c user.email=t@example.invalid commit -q -m sneak; }';
    const { main, wts } = repo({}, [sneak]);
    run(main, 'worktree', 'create', 'w1');
    write(join(wts, 'w1'), 'src/a.ts', 'a\n');
    commit(join(wts, 'w1'), 'a');
    run(main, 'worktree', 'queue', 'add', 'w1');
    const ran = run(main, 'worktree', 'queue', 'run');
    expect(ran.code).toBe(1);
    expect(ran.stdout).toContain('got a new commit while the checks ran');
    expect(exists(main, 'UNCHECKED.txt')).toBe(false);
    expect(exists(main, 'src/a.ts')).toBe(false);
    // Queued again, the whole branch is checked — and lands.
    run(main, 'worktree', 'queue', 'add', 'w1');
    expect(run(main, 'worktree', 'queue', 'run').code).toBe(0);
    expect(exists(main, 'UNCHECKED.txt')).toBe(true);
  });

  test('a main checkout that is not ready stops the queue without failing any entry', () => {
    const { main, wts } = repo();
    for (const name of ['w1', 'w2']) {
      run(main, 'worktree', 'create', name);
      write(join(wts, name), `src/${name}.ts`, 'x\n');
      commit(join(wts, name), name);
      run(main, 'worktree', 'queue', 'add', name);
    }
    write(main, 'src/base.ts', 'dirty\n');
    const ran = run(main, 'worktree', 'queue', 'run');
    expect(ran.code).toBe(1);
    expect(ran.stdout).toContain('the queue stopped: the main checkout is not ready for a merge');
    expect(ran.stdout).toContain('merge queue: 0 landed, 0 failed, 2 still waiting');
    git(main, 'checkout', '--', 'src/base.ts');
    expect(run(main, 'worktree', 'queue', 'run').stdout).toContain('merge queue: 2 landed, 0 failed, 0 still waiting');
  });
});

describe('protected paths', () => {
  test('a name pattern protects that name in any folder; patterns novadev does not read are refused; without "notice" the setting is inert', () => {
    const policy = { mode: 'notice' as const, protectedPaths: ['*.sql'] };
    expect(protectedBy(policy, 'root.sql')).toBe('*.sql');
    expect(protectedBy(policy, 'db/sub/x.sql')).toBe('*.sql');
    expect(protectedBy(policy, 'db/sub/x.ts')).toBeNull();
    const { main } = repo();
    expect(parseProtectedPaths(main, ['db/{a,b}/**']).ok).toBe(false);
    expect(parseProtectedPaths(main, ['src/[ab].ts']).ok).toBe(false);
    setManifest(main, { protectedPaths: ['nosuch:core/'] });
    commit(main, 'setting');
    expect(claimPolicy(main)).toEqual({ mode: 'lock', protectedPaths: [] });
    expect(run(main, 'worktree', 'create', 'w1', '--claim', 'src/').code).toBe(0);
    expect(run(main, 'worktree', 'mr', 'w1').code).toBe(0);
  });

  test('the rules are the main checkout\'s: a task branch that edits novadev.json loosens nothing for itself', () => {
    const { main, wts } = repo({ claims: 'notice', protectedPaths: ['src/format/'], wipLimit: 1 });
    run(main, 'worktree', 'create', 'w1');
    const w1 = join(wts, 'w1');
    setManifest(w1, { claims: 'notice', protectedPaths: [], wipLimit: 0, lead: ['paperclip/dev-1'] });
    write(w1, 'src/format/save.ts', 'x\n');
    commit(w1, 'loosen');
    expect(run(main, 'worktree', 'gate', 'w1').stdout).toContain('changed under a protected path this worktree does not hold: src/format/save.ts');
    expect(JSON.parse(run(w1, 'work', 'start', '2026-11-12_2/01', '--agent', 'paperclip/dev-1').stdout).taken).toBe(true);
    expect(JSON.parse(run(w1, 'work', 'start', '2026-11-12_2/02', '--agent', 'paperclip/dev-1').stdout).error).toContain('Work-in-progress limit');
    // Not the lead: the branch's own "lead" line does not count.
    write(w1, 'p.json', JSON.stringify({ by: 'paperclip/dev-1', reason: 'I say so' }));
    expect(run(w1, 'todo', 'priority', '2026-11-12_2/02', 'urgent', 'p.json').code).not.toBe(0);
  });
});

describe('the limit and the express lane', () => {
  test('with a limit, a start that does not say who it is is refused', () => {
    const { main } = repo({ wipLimit: 1 });
    expect(JSON.parse(run(main, 'work', 'start', '2026-11-12_2/01').stdout).error).toContain('say who starts — `--agent <actor>`');
    const free = repo();
    expect(JSON.parse(run(free.main, 'work', 'start', '2026-11-12_2/01').stdout).taken).toBe(true);
  });

  test('an urgent start pauses only what takes a slot, and a lock it cannot pause never refuses it', () => {
    const { main } = repo({ wipLimit: 1 });
    const A = 'paperclip/dev-1';
    expect(JSON.parse(run(main, 'work', 'start', '2026-11-12_2/01', '--agent', A).stdout).taken).toBe(true);
    // A finished todo whose lock was never released: it takes no slot, and is not paused.
    setManifest(main, { wipLimit: 2 });
    expect(JSON.parse(run(main, 'work', 'start', '2026-11-12_2/02', '--agent', A).stdout).taken).toBe(true);
    write(main, '.novadev/todos/2026-11-12_2/02-two/ai_completed.md', completed('two'));
    setManifest(main, { wipLimit: 1 });
    expect(run(main, 'todo', 'priority', '2026-11-12_2/03', 'urgent', '--by', 'human:filipp').code).toBe(0);
    const started = JSON.parse(run(main, 'work', 'start', '2026-11-12_2/03', '--agent', A).stdout);
    expect(started.taken).toBe(true);
    expect(started.expressLane.paused).toEqual([{ ref: '2026-11-12_2/01-one', waypoint: 1 }]);
    expect(read(main, '.novadev/todos/2026-11-12_2/02-two/working.md')).toContain('state: working');
  });
});

describe('area owners', () => {
  test('in a worktree the branch\'s own changes name the reviewers, whatever the record\'s Commits line says', () => {
    const { main, wts } = repo({ owners: { paths: { 'src/**': { reviewers: ['human:anna'] } } } });
    run(main, 'worktree', 'create', 'w1', '--todo', '2026-11-12_2/01');
    const w1 = join(wts, 'w1');
    write(w1, 'src/a.ts', 'a\n');
    write(w1, '.novadev/todos/2026-11-12_2/01-one/ai_completed.md', completed('one').replace(/\*\*Commits:\*\*.*/, '**Commits:** none'));
    commit(w1, 'a, recorded without its commit');
    write(w1, 'review.json', JSON.stringify({ verdict: 'APPROVE', by: 'claude-code/builder', checks: ['looked at it'] }));
    const partial = JSON.parse(run(w1, 'todo', 'review', '2026-11-12_2/01', 'review.json').stdout);
    expect(partial).toMatchObject({ verdict: 'PARTIAL', approved: false });
    write(w1, 'review.json', JSON.stringify({ verdict: 'APPROVE', by: 'human:anna', checks: ['read the diff'] }));
    expect(JSON.parse(run(w1, 'todo', 'review', '2026-11-12_2/01', 'review.json').stdout)).toMatchObject({ verdict: 'APPROVE', approved: true });
  });
});
