// The independent review of batch 2026-11-10_1 (0.16.0, before the release): one test per finding
// it reproduced, so none comes back.
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withMergeRules } from '../src/merge-rules.ts';
import { normalizeClaim } from '../src/registry.ts';
import { commitRefsIn } from '../src/subrepos.ts';
import { commitAll, completed, git, project, read, run, setManifest, tempDir, todo, write } from './helpers.ts';

const AGENT = 'claude-code/test';

function json(out: { stdout: string }): Record<string, any> {
  return JSON.parse(out.stdout);
}

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

/** A repository on main whose project sits in app/, not at the top; a second worktree on task/a. */
function nestedProject(): { main: string; wt: string } {
  const top = tempDir();
  const app = project();
  git(top, 'init', '-q', '-b', 'main');
  quiet(top);
  // Move the fixture project into top/app.
  Bun.spawnSync({ cmd: ['cp', '-a', `${app}/.`, join(top, 'app')] });
  todo(join(top, 'app'), '2026-11-10_1/01-a');
  todo(join(top, 'app'), '2026-11-10_2/01-b');
  commit(top, 'start');
  const wt = join(tempDir(), 'wt');
  git(top, 'worktree', 'add', '-q', '-b', 'task/a', wt);
  return { main: join(top, 'app'), wt: join(wt, 'app') };
}

describe('1. a project below its repository top', () => {
  test('a lock and its claims in another worktree are seen, not taken for gone', () => {
    const { main, wt } = nestedProject();
    expect(run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT, '--claim', 'src/auth/').code).toBe(0);
    expect(json(run(main, 'work', 'start', '2026-11-10_1', '--agent', AGENT)).error).toContain('is in work in another worktree');
    expect(json(run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT, '--claim', 'src/auth/login.ts')).error).toContain('src/auth/login.ts overlaps src/auth');
    expect(run(main, 'status').stdout).toMatch(/\/wt {2}task\/a — 2026-11-10_1 in work/);
  });
});

describe('2. worktree merge is all or nothing', () => {
  function superRepo(): { main: string; wt: string } {
    const main = project();
    setManifest(main, { subrepos: ['repos/*'], worktree: { dir: join(tempDir(), 'wts') } });
    write(main, '.gitignore', 'repos/\n');
    write(main, 'src/a.ts', 'a\n');
    git(main, 'init', '-q', '-b', 'main');
    quiet(main);
    const lib = join(main, 'repos/lib');
    write(main, 'repos/lib/x.js', 'one\n');
    git(lib, 'init', '-q', '-b', 'main');
    quiet(lib);
    commit(lib, 'start');
    commit(main, 'start');
    run(main, 'worktree', 'create', 't1', 'lib');
    const wt = JSON.parse(run(main, 'worktree', 'list', '--json').stdout).worktrees[0].path;
    write(wt, 'feature.txt', 'from the branch\n');
    commit(wt, 'feature');
    write(wt, 'repos/lib/x.js', 'two\n');
    commit(join(wt, 'repos/lib'), 'two');
    return { main, wt };
  }

  test('an untracked file the branch would write refuses before anything merges', () => {
    const { main } = superRepo();
    write(main, 'feature.txt', 'mine, untracked\n');
    const out = run(main, 'worktree', 'merge', 't1', '--yes');
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('✗ project: the main checkout has untracked files the branch would write (feature.txt)');
    expect(read(main, 'repos/lib/x.js')).toBe('one\n');
  });

  test('a merge that fails late (a hook) undoes the merges this run made', () => {
    const { main } = superRepo();
    const hooks = join(tempDir(), 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-merge-commit'), '#!/bin/sh\necho refused by the hook >&2\nexit 1\n');
    chmodSync(join(hooks, 'pre-merge-commit'), 0o755);
    git(main, 'config', 'core.hooksPath', hooks);
    const before = git(join(main, 'repos/lib'), 'rev-parse', 'HEAD').stdout.trim();
    const out = run(main, 'worktree', 'merge', 't1', '--yes');
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('Undone: lib. Nothing is merged.');
    expect(git(join(main, 'repos/lib'), 'rev-parse', 'HEAD').stdout.trim()).toBe(before);
    expect(existsSync(join(main, 'feature.txt'))).toBe(false);
  });
});

describe('3. team mode: derived files do not depend on the clone', () => {
  test('work.md is the same before and after the merge, so --check holds on the committed record', () => {
    const root = project({ team: true, defaultBranch: 'main' });
    write(root, '.novadev/knowledge/features/index.md', '# Features\n');
    git(root, 'init', '-q', '-b', 'main');
    quiet(root);
    const feature = `---\ntype: Feature\nid: FEAT-0001\ntitle: Login\ndescription: Log in.\nfeature-status: shipped\nstatus: stable\narea: auth\ncreated: 2026-10-01\ntags: []\ntouches: []\ndepends-on: []\nsupersedes: []\nsuperseded-by: []\nconflicts-with: []\ngenerated: { by: claude-code/test, at: 2026-10-01T00:00:00Z }\n---\n\n# FEAT-0001 — Login\n`;
    write(root, '.novadev/knowledge/features/FEAT-0001-login/feature.md', feature);
    todo(root, '2026-11-10_1/01-login', {
      'ai_completed.md': completed('01-login').replace('**Feature:** none — test fixture', '**Feature:** FEAT-0001\n**Commits:** none'),
      'ai_review.md': '# ai_review — 01-login\n\n**Date:** 2026-11-10\n**Verdict:** APPROVE\n**Reviewer:** claude-code/r\n\n## Checks\n\n- looked\n',
    });
    run(root, 'sync');
    commit(root, 'record');
    expect(run(root, 'sync', '--check').code).toBe(0);
    expect(read(root, '.novadev/knowledge/features/FEAT-0001-login/work.md')).toContain('`2026-11-10_1/01-login` — completed');
  });
});

describe('4. commit refs and claims with any sub-repo name', () => {
  test('_common@, .dotfiles@ and my+lib@ are read whole', () => {
    expect(commitRefsIn('_common@abcdef0, .dotfiles@1234567, my+lib@7654321').map((r) => r.text)).toEqual([
      '_common@abcdef0',
      '.dotfiles@1234567',
      'my+lib@7654321',
    ]);
    expect(commitRefsIn('fix-abc1234 fil@example.org xabc1234')).toEqual([]);
  });

  test('a claim _common:src/ names the sub-repo, not a literal path', () => {
    const root = project({ subrepos: ['repos/*'] });
    write(root, 'repos/_common/a.js', 'a\n');
    git(join(root, 'repos/_common'), 'init', '-q');
    expect(normalizeClaim(root, '_common:src/')).toEqual({ ok: true, value: 'repos/_common/src' });
    expect(normalizeClaim(root, 'C:/x').ok).toBe(false);
  });
});

describe('5 and 6. a takeover across worktrees', () => {
  function twoWorktrees(): { main: string; wt: string } {
    const main = project();
    todo(main, '2026-11-10_1/01-a');
    todo(main, '2026-11-10_2/01-b');
    git(main, 'init', '-q', '-b', 'main');
    commitAll(main);
    const wt = join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'task/b', wt);
    return { main, wt };
  }

  test('the old holder cannot write its stale lock, and stop --take there leaves the new entry alone', () => {
    const { main, wt } = twoWorktrees();
    run(main, 'work', 'start', '2026-11-10_1', '--agent', AGENT, '--claim', 'src/auth/');
    expect(run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT, '--take', '--claim', 'src/auth/').code).toBe(0);
    write(main, 'wp.json', JSON.stringify({ note: 'still here' }));
    const stale = run(main, 'work', 'waypoint', '2026-11-10_1', 'wp.json');
    expect(stale.code).toBe(1);
    expect(json(stale).error).toContain('was taken over in another worktree');
    expect(run(main, 'work', 'stop', '2026-11-10_1', '--take').code).toBe(0);
    // The entry is still the worktree's: its claim still holds.
    expect(json(run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT, '--claim', 'src/auth/login.ts')).error).toContain('overlaps src/auth');
    // And the worktree resumes its own lock.
    expect(run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT).code).toBe(0);
  });
});

describe('8. the merge and locks', () => {
  test('a paused lock may travel, and a lock committed on main before does not block an unrelated worktree', () => {
    const main = project({ worktree: { dir: join(tempDir(), 'wts') } });
    todo(main, '2026-11-10_1/01-a');
    todo(main, '2026-11-10_2/01-b');
    git(main, 'init', '-q', '-b', 'main');
    quiet(main);
    run(main, 'work', 'start', '2026-11-10_2', '--agent', AGENT);
    write(main, 'p.json', JSON.stringify({ stopped: 'Half way.', next: ['Go on.'] }));
    run(main, 'work', 'pause', '2026-11-10_2', 'p.json');
    commit(main, 'start, with a paused batch');
    run(main, 'worktree', 'create', 't2');
    const wt = JSON.parse(run(main, 'worktree', 'list', '--json').stdout).worktrees[0].path;
    run(wt, 'work', 'start', '2026-11-10_1', '--agent', AGENT);
    run(wt, 'work', 'pause', '2026-11-10_1', join(main, 'p.json'));
    write(wt, 'src/x.ts', 'x\n');
    commit(wt, 'x, and the pause');
    const out = run(main, 'worktree', 'merge', 't2', '--yes');
    expect(out.stdout).toContain('✓ merged t2 into project main');
  });
});

describe('9 and 10. normalizing', () => {
  test('a claim has one spelling', () => {
    const root = project();
    for (const raw of ['src//auth/', 'src/./auth', './src/auth', 'src/auth']) expect(normalizeClaim(root, raw)).toEqual({ ok: true, value: 'src/auth' });
    expect(normalizeClaim(root, 'src/../../x').ok).toBe(false);
  });

  test('an orphaned begin line never costs the project its own .gitattributes lines', () => {
    const orphan = '*.png binary\n# novadev:begin — old\n.novadev/knowledge/log.md merge=union\n*.sh text eol=lf\n';
    const once = withMergeRules(orphan);
    const twice = withMergeRules(once);
    expect(twice).toBe(once);
    expect(twice).toContain('*.png binary\n*.sh text eol=lf\n');
    expect(twice.match(/# novadev:begin/g)).toHaveLength(1);
  });
});

describe('7 and the gate order. after a merge', () => {
  test('worktree sync always ends with sync --after-merge, even when nothing new came in', () => {
    const main = project({ worktree: { dir: join(tempDir(), 'wts') } });
    git(main, 'init', '-q', '-b', 'main');
    quiet(main);
    commit(main, 'start');
    run(main, 'worktree', 'create', 't3');
    expect(run(main, 'worktree', 'sync', 't3').stdout).toContain('novadev sync --after-merge:');
  });

  test('a repo that must migrate first is told so before the log is touched', () => {
    const root = project();
    git(root, 'init', '-q', '-b', 'main');
    quiet(root);
    setManifest(root, { version: '0.15.0' });
    write(root, '.novadev/knowledge/log.md', `${read(root, '.novadev/knowledge/log.md')}\n## 2026-10-01\n\n* x\n`);
    commit(root, 'start');
    const out = run(root, 'sync', '--after-merge');
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('Run `novadev migrate-repo`');
    expect(git(root, 'status', '--porcelain').stdout.trim()).toBe('');
  });
});
