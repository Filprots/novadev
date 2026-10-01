// What the last commit holds of the open work records: which round a raise belongs to, and which
// `## Debt` words this round wrote. A record is judged by its `## Debt` lines, never by its file —
// the playbook's own close-out edits a record after its commit.
import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { collectRaises, debtNotes, recordHistory } from '../src/debt-budget.ts';
import { commitAll, completed, git, project, tempDir, todo, write } from './helpers.ts';

const DEBT = '\n## Debt\n**Raise:** 230 → 238\nThe kit registry adds eight findings.\n';

/** Each raise as `<ref> <file> <round>`, and each unreadable raise line the same way. */
function rounds(root: string): string[] {
  const found = collectRaises(join(root, '.novadev'), recordHistory(root));
  return [...found.raises, ...found.broken].map((r) => `${r.ref} ${r.file} ${r.round}`);
}

/** The records whose `## Debt` words of this round say why, and those words. */
function notes(root: string): { ref: string; text: string }[] {
  return debtNotes(join(root, '.novadev'), recordHistory(root)).map((note) => ({
    ref: note.ref,
    text: note.text.trim(),
  }));
}

describe('the round of a raise', () => {
  test('without git it is unknown; in a repository with no commit yet it is this round', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', DEBT) });
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md unknown']);
    git(root, 'init', '-q');
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md this']);
  });

  test('a new record is this round; once the commit holds it, it is an earlier round', () => {
    const root = project();
    commitAll(root, 'base');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', DEBT) });
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md this']);
    commitAll(root, 'round 1');
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md earlier']);
  });

  test('edits after the commit — a **Commits:** line, a note, a new reason — leave it in the earlier round', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', DEBT) });
    commitAll(root, 'round 1');
    const edited = completed('01-a', DEBT.replace('eight findings.', 'eight findings, says the review.'))
      .replace('**Feature:**', '**Commits:** abc1234\n**Feature:**')
      .concat('\n## Review\nLooked fine.\n');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': edited });
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md earlier']);
  });

  test('new numbers are a new raise: this round', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', DEBT) });
    commitAll(root, 'round 1');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', DEBT.replace('230 → 238', '238 → 245')) });
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md this']);
  });

  test('a record that moves from ai_progress.md to ai_completed.md keeps its round', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_progress.md': `# ai_progress — 01-a\n${DEBT}` });
    commitAll(root, 'round 1');
    rmSync(join(root, '.novadev/todos/2026-10-01_1/01-a/ai_progress.md'));
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', DEBT) });
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md earlier']);
  });

  test('another todo with the same numbers is a raise of its own: this round', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', DEBT) });
    commitAll(root, 'round 1');
    todo(root, '2026-10-01_1/02-b', { 'ai_completed.md': completed('02-b', DEBT) });
    expect(rounds(root).sort()).toEqual([
      '2026-10-01_1/01-a ai_completed.md earlier',
      '2026-10-01_1/02-b ai_completed.md this',
    ]);
  });

  test('a raise line that cannot be read keeps its round as well', () => {
    const root = project();
    const broken = DEBT.replace('230 → 238', '230 → 1 238');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', broken) });
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md unknown']);
    commitAll(root, 'round 1');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': `${completed('01-a', broken)}\n## Review\nnoted\n` });
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md earlier']);
  });

  test('a project in a sub-folder of the repository is judged the same way', () => {
    const repo = tempDir();
    write(repo, 'README.md', 'repo\n');
    const root = join(repo, 'app');
    write(repo, 'app/.novadev/todos/2026-10-01_1/01-a/prompt.md', '# prompt\n');
    write(repo, 'app/.novadev/todos/2026-10-01_1/01-a/ai_completed.md', completed('01-a', DEBT));
    commitAll(repo, 'round 1');
    write(repo, 'app/.novadev/todos/2026-10-01_1/01-a/ai_completed.md', `**Commits:** abc1234\n${completed('01-a', DEBT)}`);
    expect(rounds(root)).toEqual(['2026-10-01_1/01-a ai_completed.md earlier']);
  });
});

describe('the words this round wrote', () => {
  test('without git, every line of a "## Debt" section counts', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\nWorkbench grew: the importer.\n') });
    expect(notes(root)).toEqual([{ ref: '2026-10-01_1/01-a', text: 'Workbench grew: the importer.' }]);
  });

  test('a committed record says nothing new — unchanged, or changed outside its "## Debt" section', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\nWorkbench grew: the importer.\n') });
    expect(notes(root)).toHaveLength(1);
    commitAll(root, 'round 1');
    expect(notes(root)).toEqual([]);
    todo(root, '2026-10-01_1/01-a', {
      'ai_completed.md': `**Commits:** abc1234\n${completed('01-a', '\n## Debt\nWorkbench grew: the importer.\n')}`,
    });
    expect(notes(root)).toEqual([]);
  });

  test('a line added to an old record is this round\'s, and only that line', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\nWorkbench grew: the importer.\n') });
    commitAll(root, 'round 1');
    todo(root, '2026-10-01_1/01-a', {
      'ai_completed.md': completed('01-a', '\n## Debt\nWorkbench grew: the importer.\nStage3D grew too: the new camera rig.\n'),
    });
    expect(notes(root)).toEqual([{ ref: '2026-10-01_1/01-a', text: 'Stage3D grew too: the new camera rig.' }]);
  });

  test('a record that moved files brings no new words with it', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', { 'ai_progress.md': '# ai_progress — 01-a\n\n## Debt\nWorkbench grew: the importer.\n' });
    commitAll(root, 'round 1');
    rmSync(join(root, '.novadev/todos/2026-10-01_1/01-a/ai_progress.md'));
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\nWorkbench grew: the importer.\n') });
    expect(notes(root)).toEqual([]);
  });

  test('a section that only says "None." is no note', () => {
    const root = project();
    commitAll(root, 'base');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\nNone.\n') });
    expect(notes(root)).toEqual([]);
  });
});
