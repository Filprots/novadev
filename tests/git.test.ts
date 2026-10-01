// The read-only questions novadev asks git, on fixture repositories.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { unchangedSinceHead } from '../src/git.ts';
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
