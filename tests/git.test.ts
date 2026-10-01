// The read-only questions novadev asks git, on fixture repositories.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { commitPaths, fileAtHead, unchangedSinceHead } from '../src/git.ts';
import { commitAll, git, tempDir, write } from './helpers.ts';

describe('unchangedSinceHead', () => {
  test('null where git cannot tell: not a repository', () => {
    expect(unchangedSinceHead(tempDir(), 'todos')).toBeNull();
  });

  test('a repository with no commit yet: nothing is unchanged', () => {
    const root = tempDir();
    git(root, 'init', '-q');
    write(root, 'todos/a.md', 'a');
    expect(unchangedSinceHead(root, 'todos')).toEqual(new Set());
  });

  test('only files the last commit holds, unchanged in the index and the working tree', () => {
    const root = tempDir();
    for (const name of ['same', 'edited', 'staged', 'deleted']) write(root, `todos/${name}.md`, name);
    write(root, 'other/outside.md', 'not asked about');
    commitAll(root, 'base');
    write(root, 'todos/edited.md', 'changed');
    write(root, 'todos/staged.md', 'changed');
    git(root, 'add', 'todos/staged.md');
    git(root, 'rm', '-q', 'todos/deleted.md');
    write(root, 'todos/new.md', 'new');
    expect(unchangedSinceHead(root, 'todos')).toEqual(new Set([join(root, 'todos/same.md')]));
  });

  test('a project in a sub-folder of the repository gets paths in that sub-folder', () => {
    const repo = tempDir();
    write(repo, 'app/todos/a.md', 'a');
    commitAll(repo, 'base');
    expect(unchangedSinceHead(join(repo, 'app'), 'todos')).toEqual(new Set([join(repo, 'app/todos/a.md')]));
  });
});

describe('fileAtHead', () => {
  test('the content the last commit holds — not what the working tree holds now', () => {
    const root = tempDir();
    write(root, 'todos/a.md', 'committed');
    commitAll(root, 'base');
    write(root, 'todos/a.md', 'edited since');
    expect(fileAtHead(root, 'todos/a.md')).toBe('committed');
  });

  test('null where the last commit cannot say: a new file, no commit yet, no repository', () => {
    const root = tempDir();
    git(root, 'init', '-q');
    write(root, 'todos/a.md', 'a');
    expect(fileAtHead(root, 'todos/a.md')).toBeNull();
    commitAll(root, 'base');
    write(root, 'todos/new.md', 'new');
    expect(fileAtHead(root, 'todos/new.md')).toBeNull();
    expect(fileAtHead(tempDir(), 'todos/a.md')).toBeNull();
  });

  test('a path is relative to the project, also in a sub-folder of the repository', () => {
    const repo = tempDir();
    write(repo, 'app/todos/a.md', 'in the app');
    commitAll(repo, 'base');
    expect(fileAtHead(join(repo, 'app'), 'todos/a.md')).toBe('in the app');
    expect(fileAtHead(join(repo, 'app'), 'todos\\a.md')).toBe('in the app');
  });
});

describe('commitPaths', () => {
  /** Commit `files` and return the full hash. */
  const commit = (root: string, files: Record<string, string>, message = 'work'): string => {
    for (const [rel, content] of Object.entries(files)) write(root, rel, content);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '--no-verify', '-m', message);
    return git(root, 'rev-parse', 'HEAD').stdout.trim();
  };

  test('null where git cannot tell: not a repository', () => {
    expect(commitPaths(tempDir(), ['abc1234'])).toBeNull();
  });

  test('the files each commit changed, keyed by the hash as it was given — short or full', () => {
    const root = tempDir();
    git(root, 'init', '-q');
    commit(root, { 'src/a.ts': 'a', 'src/b.ts': 'b' }, 'base');
    const full = commit(root, { 'src/b.ts': 'b2', 'docs/c.md': 'c' });
    const short = full.slice(0, 8);
    expect(commitPaths(root, [short, full])).toEqual(
      new Map([
        [short, ['docs/c.md', 'src/b.ts']],
        [full, ['docs/c.md', 'src/b.ts']],
      ]),
    );
  });

  test('a hash git does not know as a commit is left out: missing, or naming a file\'s content', () => {
    const root = tempDir();
    git(root, 'init', '-q');
    const hash = commit(root, { 'a.txt': 'a' });
    const blob = git(root, 'rev-parse', 'HEAD:a.txt').stdout.trim();
    expect(commitPaths(root, ['deadbeef', blob, hash])).toEqual(new Map([[hash, ['a.txt']]]));
    expect(commitPaths(root, [])).toEqual(new Map());
  });

  test('file names come out exactly as they are: spaces, quotes, other alphabets', () => {
    const root = tempDir();
    git(root, 'init', '-q');
    const names = ['we ird/a "q" b.ts', 'данные/ä.ts'];
    const hash = commit(root, Object.fromEntries(names.map((name) => [name, 'x'])));
    expect(commitPaths(root, [hash])!.get(hash)).toEqual([...names].sort());
  });

  test('a project in a sub-folder: paths relative to it, and only the files inside it', () => {
    const repo = tempDir();
    git(repo, 'init', '-q');
    const hash = commit(repo, { 'app/src/a.ts': 'a', 'other/b.ts': 'b' });
    const outside = commit(repo, { 'other/b.ts': 'b2' });
    expect(commitPaths(join(repo, 'app'), [hash, outside])).toEqual(
      new Map([
        [hash, ['src/a.ts']],
        [outside, []],
      ]),
    );
  });

  test('in a shallow clone, a commit whose parent was not fetched is unknown, not "every file changed"', () => {
    const source = tempDir();
    git(source, 'init', '-q');
    commit(source, { 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' }, 'base');
    const older = commit(source, { 'a.txt': 'a2' }, 'older');
    const newer = commit(source, { 'b.txt': 'b2' }, 'newer');
    const clone = join(tempDir(), 'clone');
    git(source, 'clone', '-q', '--depth', '2', `file://${source}`, clone);
    // `older` is the deepest commit the clone has: its parent is missing.
    expect(commitPaths(clone, [older, newer])).toEqual(new Map([[newer, ['b.txt']]]));
    // The full history knows both.
    expect(commitPaths(source, [older, newer])).toEqual(
      new Map([
        [older, ['a.txt']],
        [newer, ['b.txt']],
      ]),
    );
  });
});
