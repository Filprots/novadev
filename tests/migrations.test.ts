// `novadev migrate-repo`: the 0.9.0 → 0.10.0 step (the metrics settings), and the invariants every
// migration relies on.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOVADEV_VERSION, compareVersions } from '../src/lib.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import { REPO, exists, project, read, readJson, run, write } from './helpers.ts';

describe('the migration list', () => {
  test('is in ascending version order and ends at or below the installed version', () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      expect(compareVersions(MIGRATIONS[i - 1]!.to, MIGRATIONS[i]!.to)).toBeLessThan(0);
    }
    expect(compareVersions(MIGRATIONS.at(-1)!.to, NOVADEV_VERSION)).toBeLessThanOrEqual(0);
  });

  test('package.json and NOVADEV_VERSION agree', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    expect(pkg.version).toBe(NOVADEV_VERSION);
  });
});

describe('0.9.0 → 0.10.0', () => {
  test('adds "metrics" and "debtBudget" as null, keeps every other setting, stamps the version', () => {
    const root = project({ version: '0.9.0', archiveGraceDays: 5 });
    const result = run(root, 'migrate-repo', '--force');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('▸ 0.10.0 — metrics hook + debt budget');
    expect(result.stdout).toContain('add "metrics": null and "debtBudget": null to novadev.json — off until you set them');
    const manifest = readJson(root, '.novadev/novadev.json');
    expect(manifest).toMatchObject({ version: NOVADEV_VERSION, archiveGraceDays: 5, metrics: null, debtBudget: null });

    // Safe to re-run: nothing left to do.
    expect(run(root, 'migrate-repo').stdout).toContain(`already at ${NOVADEV_VERSION}`);
  });

  test('never overwrites a setting that is already there', () => {
    const root = project({ version: '0.9.0', metrics: 'bun scripts/metrics.ts' });
    const result = run(root, 'migrate-repo', '--force');
    expect(result.stdout).toContain('add "debtBudget": null to novadev.json — off until you set it');
    expect(readJson(root, '.novadev/novadev.json').metrics).toBe('bun scripts/metrics.ts');

    const both = project({ version: '0.9.0', metrics: null, debtBudget: { maxKnown: 3 } });
    const quiet = run(both, 'migrate-repo', '--force');
    expect(quiet.stdout).toContain('▸ 0.10.0');
    expect(quiet.stdout).toContain('(nothing to do)');
    expect(readJson(both, '.novadev/novadev.json').debtBudget).toEqual({ maxKnown: 3 });
  });

  test('--dry-run says what it would do and changes nothing', () => {
    const root = project({ version: '0.9.0' });
    const before = read(root, '.novadev/novadev.json');
    const result = run(root, 'migrate-repo', '--dry-run');
    expect(result.stdout).toContain('would add "metrics": null and "debtBudget": null');
    expect(read(root, '.novadev/novadev.json')).toBe(before);
  });

  test('files a project already kept in .novadev/metrics/ are reported, not touched', () => {
    const root = project({ version: '0.9.0' });
    write(root, '.novadev/metrics/weekly.csv', 'week,loc\n');
    const result = run(root, 'migrate-repo', '--force');
    expect(result.stdout).toContain('SKIP .novadev/metrics/ — it already holds weekly.csv');
    expect(exists(root, '.novadev/metrics/weekly.csv')).toBe(true);
  });

  test('then sync runs on the migrated repo', () => {
    const root = project({ version: '0.9.0' });
    run(root, 'migrate-repo', '--force');
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('sync: clean. ✓');
  });
});
