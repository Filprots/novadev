// `novadev migrate-repo`: the 0.9.0 → 0.10.0 step (the metrics settings), the 0.10.0 → 0.11.0 step
// (the placement settings), and the invariants every migration relies on.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOVADEV_VERSION, compareVersions, todayStamp } from '../src/lib.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import { REPO, commitAll, exists, git, project, read, readJson, run, setManifest, todo, write } from './helpers.ts';

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

describe('a novadev.json migrate-repo cannot read', () => {
  test('is refused, not taken for "no version recorded" — and left as it is', () => {
    const root = project();
    const conflicted = '{\n  "novadev": true,\n<<<<<<< HEAD\n  "version": "0.9.0"\n=======\n  "version": "0.10.0"\n>>>>>>> other\n}\n';
    write(root, '.novadev/novadev.json', conflicted);
    const result = run(root, 'migrate-repo', '--force');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'novadev: .novadev/novadev.json is not a valid JSON object (a merge conflict?) — fix it, then run `novadev migrate-repo` again. Nothing was changed.',
    );
    expect(result.stdout).not.toContain('run `novadev deploy` first');
    expect(read(root, '.novadev/novadev.json')).toBe(conflicted);
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

  test("a README of the project's own, or a latest.json that is not a snapshot, is reported too", () => {
    const own = project({ version: '0.9.0' });
    write(own, '.novadev/metrics/README.md', '# Our weekly numbers\n');
    write(own, '.novadev/metrics/latest.json', '{"loc": 12}');
    expect(run(own, 'migrate-repo', '--force').stdout).toContain(
      'SKIP .novadev/metrics/ — it already holds README.md, latest.json',
    );

    const managed = project({ version: '0.9.0' });
    write(managed, '.novadev/metrics/README.md', '# metrics\n\n<!-- managed by `novadev deploy`. -->\n');
    write(managed, '.novadev/metrics/latest.json', '{"debt":{"known":1}}');
    expect(run(managed, 'migrate-repo', '--force').stdout).not.toContain('SKIP');
  });

  test('a file named metrics is reported, not a crash', () => {
    const root = project({ version: '0.9.0' });
    write(root, '.novadev/metrics', 'a file');
    const result = run(root, 'migrate-repo', '--force');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('SKIP .novadev/metrics — it is a file');
  });

  test('then sync runs on the migrated repo', () => {
    const root = project({ version: '0.9.0' });
    run(root, 'migrate-repo', '--force');
    const result = run(root, 'sync');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('sync: clean. ✓');
  });
});

describe('0.10.0 → 0.11.0', () => {
  test('adds "hubs" as null and "placementSince" as today, keeps every other setting, stamps the version', () => {
    const root = project({ version: '0.10.0', metrics: 'bun scripts/metrics.ts', debtBudget: { maxKnown: 5 }, archiveGraceDays: 5 });
    const result = run(root, 'migrate-repo', '--force');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('▸ 0.11.0 — a "## Placement" section in records');
    expect(result.stdout).toContain(
      `add "hubs": null and "placementSince": "${todayStamp()}" to novadev.json — records dated before "placementSince" are not checked for a "## Placement" section (README, "Placement")`,
    );
    expect(result.stdout).not.toContain('▸ 0.10.0');
    expect(readJson(root, '.novadev/novadev.json')).toMatchObject({
      version: NOVADEV_VERSION,
      metrics: 'bun scripts/metrics.ts',
      debtBudget: { maxKnown: 5 },
      archiveGraceDays: 5,
      hubs: null,
      placementSince: todayStamp(),
    });
    expect(run(root, 'migrate-repo').stdout).toContain(`already at ${NOVADEV_VERSION}`);
  });

  test('never changes a setting that is already there — a list, a day, or null', () => {
    const set = project({ version: '0.10.0', hubs: ['src/wb/'], placementSince: '2026-09-01' });
    const quiet = run(set, 'migrate-repo', '--force');
    expect(quiet.stdout).toContain('▸ 0.11.0');
    expect(quiet.stdout).toContain('(nothing to do)');
    expect(readJson(set, '.novadev/novadev.json')).toMatchObject({ hubs: ['src/wb/'], placementSince: '2026-09-01' });

    const off = project({ version: '0.10.0', placementSince: null });
    expect(run(off, 'migrate-repo', '--force').stdout).toContain('add "hubs": null to novadev.json');
    expect(readJson(off, '.novadev/novadev.json').placementSince).toBeNull();
  });

  test('--dry-run says what it would do and changes nothing', () => {
    const root = project({ version: '0.10.0' });
    const before = read(root, '.novadev/novadev.json');
    const result = run(root, 'migrate-repo', '--dry-run');
    expect(result.stdout).toContain(`would add "hubs": null and "placementSince": "${todayStamp()}"`);
    expect(read(root, '.novadev/novadev.json')).toBe(before);
  });

  test('a 0.9.0 repo runs both steps in one go', () => {
    const root = project({ version: '0.9.0' });
    const result = run(root, 'migrate-repo', '--force');
    expect(result.stdout).toContain('2 migration(s) to apply: 0.10.0 → 0.11.0');
    expect(readJson(root, '.novadev/novadev.json')).toMatchObject({
      metrics: null,
      debtBudget: null,
      hubs: null,
      placementSince: todayStamp(),
    });
  });

  test('records written before the migration day are not checked; a new record that changed a hub is', () => {
    const root = project({ version: '0.10.0' });
    write(root, 'src/wb/workbench.ts', 'a\n');
    commitAll(root, 'base');
    write(root, 'src/wb/workbench.ts', 'b\n');
    git(root, 'commit', '-q', '--no-verify', '-am', 'hub work');
    const hash = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
    const record = (date: string) =>
      `# ai_completed — x\n\n**Date:** ${date}\n**Feature:** none — fixture\n**Commits:** ${hash}\n\n## What I did\nWork.\n`;
    todo(root, '2020-01-01_1/01-old', { 'ai_completed.md': record('2020-01-01') });
    commitAll(root, 'old record');
    expect(run(root, 'migrate-repo').code).toBe(0);
    setManifest(root, { hubs: ['src/wb/'] });
    expect(run(root, 'sync').stdout).not.toContain('## Placement');

    todo(root, '2020-01-01_1/02-new', { 'ai_completed.md': record(todayStamp()) });
    const synced = run(root, 'sync');
    expect(synced.code).toBe(1);
    expect(synced.stdout).toContain(`2020-01-01_1/02-new/ai_completed.md: commit ${hash} changed the hub src/wb/`);
    expect(synced.stdout).not.toContain('01-old');
  });
});
