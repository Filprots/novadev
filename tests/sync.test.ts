// `novadev sync` behaviour that existed before the metrics hook and runs through the same code:
// the version gate, derived content, --check, NEXT ACTIONS, and the exit code.
import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURES, WIKI, completed, exists, project, read, run, todo, write } from './helpers.ts';

const LOGIN =
  '---\ntype: Feature\nid: FEAT-0001\ntitle: Login\ndescription: Log in.\nfeature-status: planned\nstatus: draft\narea: auth\ncreated: 2026-10-01\ngenerated: { by: claude-code/test, at: 2026-10-01T00:00:00Z }\n---\n\n# Login\n';

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
    rmSync(join(root, WIKI), { recursive: true });
    todo(root, '2026-10-01_1/01-thing');
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('wiki is MISSING');
    expect(result.stdout).toContain('2026-10-01_1/01-thing has no record yet');
    expect(result.stdout).not.toContain('sync: clean');
  });

  test('stale derived content: sync regenerates it, --check reports it and fails without writing', () => {
    const root = project();
    write(root, `${FEATURES}/FEAT-0001-login/feature.md`, LOGIN);
    const index = read(root, `${FEATURES}/index.md`);

    // work.md, tests.md, the features index, and the root index (which counts the features).
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('derived: 4 file(s) are stale');
    expect(read(root, `${FEATURES}/index.md`)).toBe(index);

    const plain = run(root, 'sync');
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('derived: regenerated 4 file(s)');
    expect(read(root, `${FEATURES}/index.md`)).toContain('FEAT-0001');
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
    write(root, '.novadev/knowledge/features/FEAT-0001-login/feature.md', LOGIN);
    run(root, 'sync');
    const work = '# Work\n\nOnly hand-written text, no markers.\n';
    const tests = '# Tests\n\n<!-- novadev:tests:begin -->\nmine\n<!-- novadev:tests:begin -->\nold\n<!-- novadev:tests:end -->\n';
    write(root, '.novadev/knowledge/features/FEAT-0001-login/work.md', work);
    write(root, '.novadev/knowledge/features/FEAT-0001-login/tests.md', tests);

    const result = run(root, 'sync');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      '✗ knowledge/features/FEAT-0001-login/work.md: missing <!-- novadev:work:begin --> … <!-- novadev:work:end --> block — repair the markers, or delete the file and `novadev sync` writes it again',
    );
    expect(result.stdout).toContain('✗ knowledge/features/FEAT-0001-login/tests.md: the tests block markers are broken');
    expect(read(root, '.novadev/knowledge/features/FEAT-0001-login/work.md')).toBe(work);
    expect(read(root, '.novadev/knowledge/features/FEAT-0001-login/tests.md')).toBe(tests);
  });

  test('the features index is derived whole: a hand-made one for an empty registry is replaced once a feature exists', () => {
    const root = project();
    expect(read(root, `${FEATURES}/index.md`)).toBe('# Features\n');
    write(root, `${FEATURES}/FEAT-0001-login/feature.md`, LOGIN);
    expect(run(root, 'sync').code).toBe(0);
    const index = read(root, `${FEATURES}/index.md`);
    expect(index).toContain('# auth\n\n* [○ FEAT-0001 — Login](FEAT-0001-login/feature.md) - planned · Log in.');
    expect(index).not.toContain('---'); // an index below the bundle root carries no frontmatter
  });

  test('link files with CRLF line endings stay CRLF, and up-to-date ones are not stale', () => {
    const root = project();
    write(root, '.novadev/knowledge/features/FEAT-0001-login/feature.md', LOGIN);
    expect(run(root, 'sync').code).toBe(0);
    const files = ['index.md', 'features/index.md', 'features/FEAT-0001-login/work.md', 'features/FEAT-0001-login/tests.md'];
    for (const rel of files) {
      write(root, `.novadev/knowledge/${rel}`, read(root, `.novadev/knowledge/${rel}`).replace(/\r?\n/g, '\r\n'));
    }

    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(0);
    expect(check.stdout).not.toContain('stale');

    // New derived content is written in the file's own line endings.
    todo(root, '2026-10-01_1/01-login', {
      'ai_completed.md': completed('01-login').replace('none — test fixture', 'FEAT-0001'),
    });
    expect(run(root, 'sync').stdout).toContain('derived: regenerated 1 file(s)');
    const work = read(root, '.novadev/knowledge/features/FEAT-0001-login/work.md');
    expect(work).toContain('`2026-10-01_1/01-login`');
    expect(work.replace(/\r\n/g, '')).not.toContain('\n');
    expect(run(root, 'sync', '--check').code).toBe(0);
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
