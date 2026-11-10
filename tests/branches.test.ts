// Archiving on the default branch only (0.16.0): a task branch lists what the default branch will
// archive, and moves nothing.
import { describe, expect, test } from 'bun:test';
import { defaultBranch } from '../src/git.ts';
import { commitAll, completed, exists, git, project, read, run, setManifest, tempDir, todo, write } from './helpers.ts';

/** A project in git on `main`, with one finished batch whose grace is over. */
function finishedOnMain(manifest: Record<string, unknown> = {}): string {
  const root = project({ archiveGraceDays: 0, ...manifest });
  todo(root, '2026-01-05_1/01-done', { 'ai_completed.md': completed('01-done') });
  git(root, 'init', '-q', '-b', 'main');
  commitAll(root);
  return root;
}

describe('archiving and the branch', () => {
  test('on the default branch, sync archives a finished batch as before', () => {
    const root = finishedOnMain();
    const out = run(root, 'sync');
    expect(out.stdout).toContain('archived: 1 item(s)');
    expect(exists(root, '.novadev/archive/2026/todos/2026-01-05_1/01-done/ai_completed.md')).toBe(true);
    expect(exists(root, '.novadev/todos/2026-01-05_1')).toBe(false);
  });

  test('on a task branch, sync moves nothing and says what the default branch will archive', () => {
    const root = finishedOnMain();
    git(root, 'checkout', '-q', '-b', 'task/one');
    const out = run(root, 'sync');
    expect(out.stdout).not.toContain('archived:');
    expect(out.stdout).toContain('not archived here — this is branch task/one, not main; main archives 1 item(s) after the merge:');
    expect(out.stdout).toContain('todos/2026-01-05_1 → archive/2026/todos/2026-01-05_1');
    expect(exists(root, '.novadev/todos/2026-01-05_1/01-done/ai_completed.md')).toBe(true);
    // The marker is derived alike on every branch.
    expect(read(root, '.novadev/todos/2026-01-05_1/completed.md')).toContain('# Batch complete — 2026-01-05_1');
  });

  test('a reviewed test round stays where it is on a task branch', () => {
    const root = finishedOnMain();
    write(
      root,
      '.novadev/totest/login/test-plan.md',
      '---\nid: login\ncreated: 2026-01-05\nupdated: 2026-01-06\nstatus: reviewed\nrevision: 1\nverdict: passed\nlast-tested: 2026-01-06\ntodos:\n---\n\n# Test plan\n',
    );
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'round');
    git(root, 'checkout', '-q', '-b', 'task/two');
    const out = run(root, 'sync');
    expect(out.stdout).toContain('totest/login → archive/2026/totest/login/rev1-2026-01-06');
    expect(exists(root, '.novadev/totest/login/test-plan.md')).toBe(true);
  });

  test('a detached HEAD is not the default branch', () => {
    const root = finishedOnMain();
    git(root, 'checkout', '-q', '--detach');
    const out = run(root, 'sync');
    expect(out.stdout).toContain('not archived here — HEAD is detached, not on main');
    expect(exists(root, '.novadev/todos/2026-01-05_1')).toBe(true);
  });

  test('"defaultBranch" in novadev.json names the branch that archives', () => {
    const root = finishedOnMain({ defaultBranch: 'develop' });
    expect(run(root, 'sync').stdout).toContain('not archived here — this is branch main, not develop');
    git(root, 'checkout', '-q', '-b', 'develop');
    expect(run(root, 'sync').stdout).toContain('archived: 1 item(s)');
  });

  test('`novadev archive` refuses on a task branch, explicit or --done', () => {
    const root = finishedOnMain();
    git(root, 'checkout', '-q', '-b', 'task/three');
    for (const args of [['archive', '--done'], ['archive', '2026-01-05_1']]) {
      const out = run(root, ...args);
      expect(out.code).toBe(1);
      expect(out.stderr).toContain('archiving happens on the default branch only — this is branch task/three, not main');
    }
    expect(exists(root, '.novadev/todos/2026-01-05_1')).toBe(true);
    git(root, 'checkout', '-q', 'main');
    expect(run(root, 'archive', '2026-01-05_1').code).toBe(0);
  });

  test('a repository whose branches are none of the usual names archives as before', () => {
    const root = project({ archiveGraceDays: 0 });
    todo(root, '2026-01-05_1/01-done', { 'ai_completed.md': completed('01-done') });
    git(root, 'init', '-q', '-b', 'trunk');
    commitAll(root);
    expect(run(root, 'sync').stdout).toContain('archived: 1 item(s)');
  });

  test('an unreadable "defaultBranch" setting leaves the choice to git', () => {
    const root = finishedOnMain();
    setManifest(root, { defaultBranch: 'two words' });
    expect(run(root, 'sync').stdout).toContain('archived: 1 item(s)');
  });
});

describe('defaultBranch (git.ts)', () => {
  test('the remote\'s default wins over the local names', () => {
    const root = tempDir();
    git(root, 'init', '-q', '-b', 'main');
    write(root, 'a.txt', 'a\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'a');
    expect(defaultBranch(root)).toBe('main');
    git(root, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    expect(defaultBranch(root)).toBe('trunk');
    expect(defaultBranch(root, 'release')).toBe('release');
  });

  test('null outside a repository', () => {
    expect(defaultBranch(tempDir())).toBeNull();
  });
});
