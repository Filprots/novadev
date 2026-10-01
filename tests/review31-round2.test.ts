// The second review of novadev 0.10.0 (thph-consumer-test batch 2026-09-30_2/31), kept as written:
// each test here failed before the fixes. The themed test files cover the same behaviour in more
// detail.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeMetrics, runMetricsCommand } from '../src/metrics.ts';
import {
  REPO,
  cleanEnv,
  commitAll,
  completed,
  metricsOutput,
  metricsProject,
  project,
  read,
  readJson,
  run,
  tempDir,
  todo,
  write,
} from './helpers.ts';

describe('[major] findings', () => {
  test('no new block on every run with an unclosed fence', () => {
    const root = metricsProject({ debt: { known: 1 }, hubs: [] });
    write(root, '.novadev/wiki/architecture.md', '# Architecture\n\nAn example:\n\n```sh\nnovadev sync\n\nMore hand-written text.\n');
    run(root, 'sync');
    const first = read(root, '.novadev/wiki/architecture.md');
    run(root, 'sync');
    run(root, 'sync');
    const third = read(root, '.novadev/wiki/architecture.md');
    expect(third.split('<!-- novadev:budgets:begin -->').length - 1).toBeLessThanOrEqual(1);
    expect(third).toBe(first);
  });

  test("the gate fails when THIS round's record has no raise", () => {
    const root = metricsProject({ debt: { known: 229 }, hubs: [] }, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-a', {
      'ai_completed.md': completed('01-a', '\n## Debt\n**Raise:** 230 → 100000\nBig refactor ahead.\n'),
    });
    expect(run(root, 'sync').code).toBe(0);
    commitAll(root, 'round 1');
    todo(root, '2026-10-01_1/02-b', { 'ai_completed.md': completed('02-b') });
    metricsOutput(root, { debt: { known: 5000 }, hubs: [] });
    run(root, 'sync');
    commitAll(root, 'round 2');
    expect(run(root, 'sync', '--check').code).not.toBe(0);
    expect(readJson(root, '.novadev/novadev.json').debtBudget.maxKnown).toBe(230);
  });
});

describe('[minor] findings', () => {
  test('a folder at metrics/latest.json is not an EISDIR crash', () => {
    const root = metricsProject({ debt: { known: 1 }, hubs: [] });
    mkdirSync(join(root, '.novadev/metrics/latest.json'), { recursive: true });
    expect(run(root, 'sync').stderr).not.toContain('EISDIR');
  });

  test('a command that leaves a child holding stdout keeps its good output', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'm.json'), '{"debt":{"known":3}}');
    const result = await runMetricsCommand(root, '(sleep 7391 &); cat m.json; sleep 0.3; exit 0', 1);
    expect(result.ok).toBe(true);
  });

  test('a hub path that leaves the project is refused', () => {
    expect(normalizeMetrics({ hubs: [{ name: 'a', measure: 1, path: '../other-repo/src/' }] }).ok).toBe(false);
  });

  test('a "Raise:" line in prose is nobody\'s problem when there is no debt budget', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-a', {
      'ai_completed.md': completed('01-a', '\n## Debt\n- Raise: the API client timeout should be configurable.\n'),
    });
    expect(run(root, 'sync').code).toBe(0);
  });

  test('a raise that was too small is not answered with "add a section"', () => {
    const root = metricsProject({ debt: { known: 238 } }, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\n**Raise:** 230 → 235\nWhy.') });
    expect(run(root, 'sync').stdout).not.toContain('add a "## Debt" section with "**Raise:** 235 → 238"');
  });

  test('a test run leaves no fixture folders behind', () => {
    const tmp = tempDir();
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', 'tests/sync.test.ts'],
      cwd: REPO,
      env: { ...cleanEnv(), TMPDIR: tmp },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    expect(readdirSync(tmp).filter((name) => name.startsWith('novadev-test-'))).toEqual([]);
  });

  test('link files in CRLF are not stale once they are up to date', () => {
    const root = project();
    write(
      root,
      '.novadev/features/FEAT-0001-login/feature.md',
      '---\nid: FEAT-0001\ntitle: Login\nstatus: planned\narea: auth\ncreated: 2026-10-01\nupdated: 2026-10-01\n---\n\n# Login\n',
    );
    expect(run(root, 'sync').code).toBe(0);
    for (const rel of ['features/INDEX.md', 'features/FEAT-0001-login/work.md', 'features/FEAT-0001-login/tests.md']) {
      const path = join(root, '.novadev', rel);
      writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    expect(run(root, 'sync', '--check').stdout).not.toContain('stale');
  });
});
