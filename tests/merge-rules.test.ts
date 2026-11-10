// Merging parallel branches (0.16.0): the .gitattributes block and the driver deploy writes, the log
// repair, and `novadev sync --after-merge`.
import { describe, expect, test } from 'bun:test';
import { MERGE_RULES, repairLog, withMergeRules } from '../src/merge-rules.ts';
import { exists, git, project, read, run, tempDir, write } from './helpers.ts';

/** A project in git on main, deployed (rules + driver), committed; local identity and no hooks. */
function deployedRepo(): string {
  const root = project();
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'novadev tests');
  git(root, 'config', 'user.email', 'novadev@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.hooksPath', '/dev/null');
  expect(run(root, 'deploy').code).toBe(0);
  expect(run(root, 'sync').code).toBe(0);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'deployed');
  return root;
}

/** Record a new memory on the current branch, the way an agent does: the file, the log, sync, commit. */
function remember(root: string, slug: string): void {
  write(
    root,
    `.novadev/knowledge/memories/${slug}.md`,
    `---\ntype: Gotcha\ntitle: ${slug} is a trap\ndescription: When you touch ${slug}.\ntags: [${slug}]\n---\n\nIt bites.\n`,
  );
  write(root, 'payload.json', JSON.stringify({ events: [{ path: `memories/${slug}.md`, event: 'create', by: 'claude-code/test', note: `Learned ${slug}.` }] }));
  expect(run(root, 'knowledge', 'log', 'payload.json').code).toBe(0);
  expect(run(root, 'sync').code).toBe(0);
  git(root, 'add', '-A', '--', '.novadev');
  git(root, 'commit', '-q', '-m', `remember ${slug}`);
}

describe('the .gitattributes block', () => {
  test('is added after the project\'s own rules, and replaced in place on the next deploy', () => {
    const first = withMergeRules('*.png binary\n');
    expect(first.startsWith('*.png binary\n\n# novadev:begin')).toBe(true);
    for (const rule of MERGE_RULES) expect(first).toContain(`${rule}\n`);
    expect(withMergeRules(first)).toBe(first);
    const old = first.replace('.novadev/metrics/latest.json merge=novadev-derived\n', '');
    expect(withMergeRules(`${old}docs/*.md text\n`)).toBe(`${first}docs/*.md text\n`);
    expect(withMergeRules('')).toBe(`${first.slice('*.png binary\n\n'.length)}`);
  });

  test('deploy writes it and defines the driver in the clone; a second deploy changes nothing', () => {
    const root = deployedRepo();
    expect(read(root, '.gitattributes')).toContain('.novadev/knowledge/log.md merge=union');
    expect(git(root, 'config', '--get', 'merge.novadev-derived.driver').stdout.trim()).toBe('true');
    const again = run(root, 'deploy');
    expect(again.stdout).not.toContain('.gitattributes');
    expect(again.stdout).not.toContain('git config');
  });

  test('a clone whose config lacks the driver gets a NEXT ACTION', () => {
    const root = deployedRepo();
    git(root, 'config', '--unset', 'merge.novadev-derived.driver');
    expect(run(root, 'sync').stdout).toContain('this clone does not define the merge driver "novadev-derived"');
  });
});

describe('repairLog', () => {
  test('joins a day split in two and puts the days newest first, keeping each entry once', () => {
    const log = [
      '# Knowledge log',
      '',
      '## 2026-11-10',
      '',
      '* **Creation**: [a](memories/a.md) — A.',
      '',
      '## 2026-11-11',
      '',
      '* **Creation**: [b](memories/b.md) — B.',
      '  continued.',
      '',
      '## 2026-11-10',
      '',
      '* **Creation**: [c](memories/c.md) — C.',
      '* **Creation**: [a](memories/a.md) — A.',
      '',
    ].join('\n');
    expect(repairLog(log)).toBe(
      [
        '# Knowledge log',
        '',
        '## 2026-11-11',
        '',
        '* **Creation**: [b](memories/b.md) — B.',
        '  continued.',
        '',
        '## 2026-11-10',
        '',
        '* **Creation**: [a](memories/a.md) — A.',
        '* **Creation**: [c](memories/c.md) — C.',
        '',
      ].join('\n'),
    );
  });

  test('leaves a healthy log, and one with other problems, alone', () => {
    expect(repairLog('# Knowledge log\n\n## 2026-11-10\n\n* x\n')).toBeNull();
    expect(repairLog('# Knowledge log\n\n## yesterday\n\n* x\n\n## 2026-11-10\n\n* y\n\n## 2026-11-10\n\n* z\n')).toBeNull();
  });
});

describe('a merge of two branches that both recorded knowledge', () => {
  test('merges without a conflict, and sync --after-merge regenerates and commits', () => {
    const root = deployedRepo();
    git(root, 'checkout', '-q', '-b', 'task/a');
    remember(root, 'alpha');
    git(root, 'checkout', '-q', 'main');
    remember(root, 'beta');
    const merged = git(root, 'merge', '-q', '--no-edit', 'task/a');
    expect(merged.code).toBe(0);
    // The derived index kept main's copy: alpha is missing from it until sync runs.
    expect(read(root, '.novadev/knowledge/memories/index.md')).not.toContain('alpha');
    expect(read(root, '.novadev/knowledge/log.md')).toContain('memories/alpha.md');
    expect(read(root, '.novadev/knowledge/log.md')).toContain('memories/beta.md');

    const out = run(root, 'sync', '--after-merge');
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/after merge: committed \d+ file\(s\) of \.novadev\/ as [0-9a-f]+/);
    expect(read(root, '.novadev/knowledge/memories/index.md')).toContain('alpha');
    expect(git(root, 'status', '--porcelain', '--', '.novadev').stdout.trim()).toBe('');
    expect(git(root, 'log', '-1', '--format=%s').stdout).toContain('novadev sync after merge');
    expect(run(root, 'sync', '--check').code).toBe(0);

    // Nothing left to regenerate: no second commit.
    expect(run(root, 'sync', '--after-merge').stdout).toContain('nothing in .novadev/ needed regenerating — no commit');
  });

  test('refuses during a merge, with uncommitted .novadev/ changes, outside git, and with --check', () => {
    const root = deployedRepo();
    write(root, '.novadev/sparks/idea.md', 'An idea.\n');
    const dirty = run(root, 'sync', '--after-merge');
    expect(dirty.code).toBe(1);
    expect(dirty.stderr).toContain('.novadev/ has uncommitted changes');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'idea');

    write(root, 'a.txt', 'one\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'a');
    git(root, 'checkout', '-q', '-b', 'task/b');
    write(root, 'a.txt', 'two\n');
    git(root, 'commit', '-q', '-am', 'b');
    git(root, 'checkout', '-q', 'main');
    write(root, 'a.txt', 'three\n');
    git(root, 'commit', '-q', '-am', 'c');
    expect(Bun.spawnSync({ cmd: ['git', 'merge', 'task/b'], cwd: root, stdout: 'pipe', stderr: 'pipe' }).exitCode).not.toBe(0);
    const during = run(root, 'sync', '--after-merge');
    expect(during.code).toBe(1);
    expect(during.stderr).toContain('a merge is still in progress');

    const outside = project();
    expect(run(outside, 'sync', '--after-merge').stderr).toContain('--after-merge needs a git repository');
    expect(run(outside, 'sync', '--after-merge', '--check').code).toBe(1);
    expect(exists(tempDir(), '.gitattributes')).toBe(false);
  });
});

describe('the docs', () => {
  test('the README shows the block deploy writes, line for line', () => {
    const readme = Bun.file(`${import.meta.dir}/../README.md`).text();
    return readme.then((text) => expect(text).toContain(withMergeRules('').trimEnd()));
  });
});
