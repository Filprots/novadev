// The read-only questions novadev asks git, on fixture repositories.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { commitPaths, fileAtHead, filesAtCommits, lastCommit, lastCommitBetween, renamedFrom, unchangedSinceHead } from '../src/git.ts';
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

describe('the drift check\'s questions about a merge', () => {
  /** A repository with a merge of `side` (which changed kb/a.md and src/s.ts) into the first branch, which changed other.txt meanwhile. */
  function merged(): { root: string; merge: string; line: string; side: string } {
    const root = tempDir();
    write(root, 'kb/a.md', 'a');
    write(root, 'src/s.ts', 's');
    write(root, 'other.txt', 'o');
    commitAll(root, 'base');
    git(root, 'checkout', '-q', '-b', 'side');
    write(root, 'kb/a.md', 'a — on the side ✓');
    write(root, 'src/s.ts', 's, changed on the side');
    commitAll(root, 'side work');
    git(root, 'checkout', '-q', '-');
    write(root, 'other.txt', 'changed on the line');
    commitAll(root, 'line work');
    git(root, 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
    const [merge, line, side] = git(root, 'rev-parse', 'HEAD', 'HEAD^1', 'HEAD^2').stdout.trim().split('\n');
    return { root, merge: merge!, line: line!, side: side! };
  }

  test('lastCommit names the merge on the first-parent line, with its parents', () => {
    const { root, merge, line, side } = merged();
    expect(lastCommit(join(root, 'src/s.ts'), '2000-01-01T00:00:00Z')).toMatchObject({ commit: merge, parents: [line, side] });
    expect(lastCommit(join(root, 'other.txt'), '2000-01-01T00:00:00Z')).toMatchObject({ commit: line, parents: [expect.any(String)] });
    expect(lastCommit(join(root, 'kb'), '2000-01-01T00:00:00Z')?.commit).toBe(merge); // a folder
  });

  test('lastCommitBetween: what one side of a merge changed that the other has not', () => {
    const { root, merge, line, side } = merged();
    expect(lastCommitBetween(join(root, 'src/s.ts'), [side], [line])).toEqual({ found: { commit: side, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), parents: [expect.any(String)] } });
    expect(lastCommitBetween(join(root, 'src/s.ts'), [line], [side])).toEqual({ found: null });
    expect(lastCommitBetween(join(root, 'other.txt'), [line], [side])?.found?.commit).toBe(line);
    expect(lastCommitBetween(join(root, 'src'), [merge], [line])?.found?.commit).toBe(side); // a folder; the merge took it from the side
    // A commit git does not have, a name that is not a hash, nothing to start from: git cannot tell.
    expect(lastCommitBetween(join(root, 'src/s.ts'), ['0'.repeat(40)], [line])).toBeNull();
    expect(lastCommitBetween(join(root, 'src/s.ts'), ['HEAD'], [line])).toBeNull();
    expect(lastCommitBetween(join(root, 'src/s.ts'), [], [line])).toBeNull();
    expect(lastCommitBetween(join(root, 'nope.ts'), [side], [line])).toBeNull();
  });

  test('filesAtCommits: each file\'s text in each commit — one call, any characters, null where it was not', () => {
    const { root, merge, line, side } = merged();
    expect(
      filesAtCommits(join(root, 'kb'), [
        { commit: line, path: 'a.md' },
        { commit: merge, path: 'a.md' },
        { commit: merge, path: 'b.md' },
        { commit: '0'.repeat(40), path: 'a.md' },
        { commit: merge, path: '../src/s.ts' }, // only a path inside the folder
        { commit: merge, path: '.' }, // a folder is no file
        { commit: merge, path: 'a\nb.md' },
        { commit: side, path: 'a.md' },
      ]),
    ).toEqual(['a', 'a — on the side ✓', null, null, null, null, null, 'a — on the side ✓']);
    expect(filesAtCommits(join(root, 'kb'), [])).toEqual([]);
    expect(filesAtCommits(tempDir(), [{ commit: merge, path: 'a.md' }])).toBeNull();
    expect(filesAtCommits(join(root, 'nope'), [{ commit: merge, path: 'a.md' }])).toBeNull();
  });

  test('renamedFrom: the path a file had before a change moved it, as git\'s rename detection sees it', () => {
    const root = tempDir();
    write(root, 'kb/old.md', 'a page long enough for rename detection to recognise it\n'.repeat(4));
    write(root, 'kb/stays.md', 'stays');
    commitAll(root, 'base');
    git(root, 'mv', 'kb/old.md', 'kb/new.md');
    write(root, 'kb/added.md', 'new');
    commitAll(root, 'moved');
    const [after, before] = git(root, 'rev-parse', 'HEAD', 'HEAD^').stdout.trim().split('\n');
    expect(renamedFrom(join(root, 'kb'), before!, after!, 'new.md')).toBe('old.md');
    expect(renamedFrom(join(root, 'kb'), before!, after!, 'added.md')).toBeNull();
    expect(renamedFrom(join(root, 'kb'), before!, after!, 'stays.md')).toBeNull();
    expect(renamedFrom(join(root, 'kb'), 'HEAD^', 'HEAD', 'new.md')).toBeNull(); // only hashes are asked
    expect(renamedFrom(tempDir(), before!, after!, 'new.md')).toBeNull();
  });
});
