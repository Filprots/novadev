// `novadev sync` behaviour that existed before the metrics hook and runs through the same code:
// the version gate, derived content, --check, NEXT ACTIONS, and the exit code.
import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { completed, exists, project, read, run, todo, write } from './helpers.ts';

const LOGIN =
  '---\nid: FEAT-0001\ntitle: Login\nstatus: planned\narea: auth\ncreated: 2026-10-01\nupdated: 2026-10-01\n---\n\n# Login\n';

describe('sync', () => {
  test('a healthy project is clean', () => {
    const result = run(project(), 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('sync: clean. ✓');
  });

  test('refuses an unknown option', () => {
    const result = run(project(), 'sync', '--fast');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unknown option "--fast"');
  });

  test('a repo behind the installed version must migrate first — and its metrics command does not run', () => {
    const root = project({ version: '0.9.0', metrics: 'touch metrics-ran && cat metrics-out.json' });
    const result = run(root, 'sync');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Run `novadev migrate-repo`');
    expect(exists(root, 'metrics-ran')).toBe(false);
  });

  test('a missing wiki and an unrecorded todo are NEXT ACTIONS', () => {
    const root = project();
    rmSync(join(root, '.novadev/wiki/INDEX.md'));
    todo(root, '2026-10-01_1/01-thing');
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('wiki is MISSING');
    expect(result.stdout).toContain('2026-10-01_1/01-thing has no record yet');
    expect(result.stdout).not.toContain('sync: clean');
  });

  test('stale derived content: sync regenerates it, --check reports it and fails without writing', () => {
    const root = project();
    write(
      root,
      '.novadev/features/FEAT-0001-login/feature.md',
      '---\nid: FEAT-0001\ntitle: Login\nstatus: planned\narea: auth\ncreated: 2026-10-01\nupdated: 2026-10-01\n---\n\n# Login\n',
    );
    const index = read(root, '.novadev/features/INDEX.md');

    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('derived: 3 file(s) are stale');
    expect(read(root, '.novadev/features/INDEX.md')).toBe(index);

    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('derived: regenerated 3 file(s)');
    expect(read(root, '.novadev/features/INDEX.md')).toContain('FEAT-0001');
    expect(run(root, 'sync', '--check').code).toBe(0);
  });

  test('the wiki budgets block counts as derived content, beside the link files', () => {
    const root = project({ metrics: 'cat metrics-out.json' });
    write(root, 'metrics-out.json', '{"debt":{"known":1}}');
    write(root, '.novadev/metrics/latest.json', '{"updated":"2026-10-01","debt":{"known":1},"hubs":[]}');
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('derived: 1 file(s) are stale');
    expect(run(root, 'sync').stdout).toContain('derived: regenerated 1 file(s)');
    expect(run(root, 'sync', '--check').code).toBe(0);
  });

  test('a feature file whose block markers are missing or broken is a problem, and stays as it is', () => {
    const root = project();
    write(root, '.novadev/features/FEAT-0001-login/feature.md', LOGIN);
    run(root, 'sync');
    const work = '# Work\n\nOnly hand-written text, no markers.\n';
    const tests = '# Tests\n\n<!-- novadev:tests:begin -->\nmine\n<!-- novadev:tests:begin -->\nold\n<!-- novadev:tests:end -->\n';
    write(root, '.novadev/features/FEAT-0001-login/work.md', work);
    write(root, '.novadev/features/FEAT-0001-login/tests.md', tests);

    const result = run(root, 'sync');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      '✗ features/FEAT-0001-login/work.md: missing <!-- novadev:work:begin --> … <!-- novadev:work:end --> block — repair the markers, or delete the file and `novadev sync` writes it again',
    );
    expect(result.stdout).toContain('✗ features/FEAT-0001-login/tests.md: the tests block markers are broken');
    expect(read(root, '.novadev/features/FEAT-0001-login/work.md')).toBe(work);
    expect(read(root, '.novadev/features/FEAT-0001-login/tests.md')).toBe(tests);
  });

  test('features/INDEX.md: a marker quoted in its hand-written text is never taken for the block', () => {
    const root = project();
    write(root, '.novadev/features/FEAT-0001-login/feature.md', LOGIN);
    const note = 'The table between `<!-- novadev:features-index:begin -->` and its end marker is generated.';
    write(
      root,
      '.novadev/features/INDEX.md',
      `# Features index\n\n${note}\n\n## Hand-written\n\nKeep me.\n\n<!-- novadev:features-index:begin -->\n<!-- novadev:features-index:end -->\n`,
    );
    expect(run(root, 'sync').code).toBe(0);
    const index = read(root, '.novadev/features/INDEX.md');
    expect(index).toContain(`${note}\n\n## Hand-written\n\nKeep me.\n`);
    expect(index).toContain('| [FEAT-0001](FEAT-0001-login/feature.md) |');
  });

  test('a link problem fails sync', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-thing', {
      'ai_completed.md': completed('01-thing').replace('none — test fixture', 'FEAT-0042'),
    });
    const result = run(root, 'sync');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('**Feature:** FEAT-0042 does not exist');
  });

  test('a finished batch is marked and held in todos/ for the grace period', () => {
    const root = project({ archiveGraceDays: 3 });
    todo(root, '2026-10-01_1/01-thing', { 'ai_completed.md': completed('01-thing') });
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('complete, held in todos/ for 3 more day(s)');
    expect(exists(root, '.novadev/todos/2026-10-01_1/completed.md')).toBe(true);
    expect(result.stdout).toContain('sync: clean. ✓');
  });
});
