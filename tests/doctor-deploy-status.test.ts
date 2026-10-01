// `novadev deploy`, `novadev doctor` and `novadev status` around the metrics folder and settings.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { NOVADEV_VERSION, todayStamp } from '../src/lib.ts';
import { exists, project, read, readJson, run, setManifest, tempDir, write } from './helpers.ts';

/** A deployed project with a complete wiki: what doctor calls healthy. */
function deployed(): string {
  const root = project();
  const result = run(root, 'deploy');
  expect(result.code).toBe(0);
  return root;
}

describe('deploy', () => {
  test('a first deploy creates metrics/ with its README and shows both settings, off', () => {
    const root = tempDir();
    expect(run(root, 'deploy').code).toBe(0);
    expect(read(root, '.novadev/metrics/README.md')).toContain('# metrics — the project\'s own numbers');
    expect(readJson(root, '.novadev/novadev.json')).toEqual({
      novadev: true,
      version: NOVADEV_VERSION,
      deployedAt: todayStamp(),
      metrics: null,
      debtBudget: null,
    });
  });

  test('a re-deploy keeps every setting — and does not bring back settings someone deleted', () => {
    const root = tempDir();
    run(root, 'deploy');
    const budget = { maxKnown: 238, raises: [{ by: '2026-10-01_1/01-a', from: 230, to: 238, on: '2026-10-01' }] };
    setManifest(root, { metrics: 'bun scripts/metrics.ts', debtBudget: budget, archiveGraceDays: 5 });
    run(root, 'deploy');
    expect(readJson(root, '.novadev/novadev.json')).toMatchObject({
      metrics: 'bun scripts/metrics.ts',
      debtBudget: budget,
      archiveGraceDays: 5,
    });

    const manifest = readJson(root, '.novadev/novadev.json');
    delete manifest.metrics;
    delete manifest.debtBudget;
    write(root, '.novadev/novadev.json', JSON.stringify(manifest, null, 2) + '\n');
    run(root, 'deploy');
    const after = readJson(root, '.novadev/novadev.json');
    expect('metrics' in after).toBe(false);
    expect('debtBudget' in after).toBe(false);
  });

  test('refuses a repo that still needs migrating, changes nothing, and goes ahead after migrate-repo', () => {
    const root = project({ version: '0.9.0' });
    const before = read(root, '.novadev/novadev.json');
    const result = run(root, 'deploy');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('this repo is at 0.9.0, and novadev');
    expect(result.stderr).toContain('Run `novadev migrate-repo` first, then `novadev deploy` again. Nothing was changed.');
    expect(read(root, '.novadev/novadev.json')).toBe(before);
    expect(exists(root, '.novadev/skills')).toBe(false);
    expect(exists(root, 'AGENTS.md')).toBe(false);

    expect(run(root, 'migrate-repo', '--force').stdout).toContain('▸ 0.10.0');
    expect(run(root, 'deploy').code).toBe(0);
    expect(readJson(root, '.novadev/novadev.json').version).toBe(NOVADEV_VERSION);
  });

  test('refuses a repo deployed by a newer novadev, instead of stamping it older', () => {
    const root = project({ version: '99.0.0' });
    const result = run(root, 'deploy');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('this repo is at 99.0.0, newer than the installed novadev');
    expect(readJson(root, '.novadev/novadev.json').version).toBe('99.0.0');
  });

  test("keeps a folder README that is the project's own, and says so — novadev's own are refreshed", () => {
    const root = tempDir();
    write(root, '.novadev/metrics/README.md', '# Our weekly numbers\n');
    const result = run(root, 'deploy');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'kept:     .novadev/metrics/README.md — the project\'s own (no "managed by `novadev deploy`" line), so not replaced',
    );
    expect(read(root, '.novadev/metrics/README.md')).toBe('# Our weekly numbers\n');

    write(root, '.novadev/todos/README.md', '# todos\n\n<!-- managed by `novadev deploy`. -->\n\nan old version\n');
    run(root, 'deploy');
    expect(read(root, '.novadev/todos/README.md')).toContain('# todos — task batches');
  });

  test('refuses a novadev.json it cannot read — a merge conflict, or JSON that is not an object — and changes nothing', () => {
    for (const text of ['{\n  "novadev": true,\n<<<<<<< HEAD\n  "debtBudget": { "maxKnown": 238 }\n=======\n  "debtBudget": { "maxKnown": 235 }\n>>>>>>> other\n}\n', '[]\n']) {
      const root = tempDir();
      write(root, '.novadev/novadev.json', text);
      const result = run(root, 'deploy');
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        'novadev: .novadev/novadev.json is not a valid JSON object (a merge conflict?) — fix it, then run `novadev deploy` again. Nothing was changed.',
      );
      expect(read(root, '.novadev/novadev.json')).toBe(text);
      expect(exists(root, '.novadev/skills')).toBe(false);
      expect(exists(root, 'AGENTS.md')).toBe(false);
    }
  });

  test('a file where a novadev folder belongs: the rest is deployed, then it fails and says what to move', () => {
    const root = tempDir();
    write(root, '.novadev/metrics', 'a file');
    const result = run(root, 'deploy');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('.novadev/metrics is a file where novadev needs a folder — move it away');
    expect(result.stderr).not.toContain('ENOTDIR');
    expect(exists(root, '.novadev/todos/README.md')).toBe(true);
    expect(read(root, '.novadev/metrics')).toBe('a file');
  });
});

describe('doctor', () => {
  test('a deployed project with metrics/ is healthy — the folder is novadev\'s', () => {
    const root = deployed();
    expect(exists(root, '.novadev/metrics/README.md')).toBe(true);
    const result = run(root, 'doctor');
    expect(result.stdout.trim()).toBe('doctor: structure is healthy.');
    expect(result.code).toBe(0);
  });

  test('a folder novadev does not know is still only a note', () => {
    const root = deployed();
    write(root, '.novadev/drafts/x.md', 'x');
    const result = run(root, 'doctor');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('.novadev/drafts/: not a novadev folder (tolerated)');
    expect(result.stdout).not.toContain('.novadev/metrics/');
  });

  test('a malformed snapshot, a bad setting, and a stale budgets block are problems', () => {
    const root = deployed();
    setManifest(root, { metrics: 'cat metrics-out.json', debtBudget: { maxKnown: 'lots' } });
    write(root, '.novadev/metrics/latest.json', '{ broken');
    const broken = run(root, 'doctor');
    expect(broken.code).toBe(1);
    expect(broken.stdout).toContain('✗ metrics/latest.json: not valid JSON');
    expect(broken.stdout).toContain('✗ novadev.json: "debtBudget.maxKnown" must be a whole number');

    setManifest(root, { debtBudget: { maxKnown: 230 } });
    write(root, '.novadev/metrics/latest.json', '{"updated":"2026-10-01","debt":{"known":230},"hubs":[]}');
    const stale = run(root, 'doctor');
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain('✗ wiki/architecture.md: budgets block missing — run `novadev sync`');

    write(root, 'metrics-out.json', '{"debt":{"known":230},"hubs":[]}');
    expect(run(root, 'sync').code).toBe(0);
    expect(run(root, 'doctor').stdout.trim()).toBe('doctor: structure is healthy.');
  });

  test('a file where the metrics folder belongs is a problem, not a crash', () => {
    const root = deployed();
    rmSync(join(root, '.novadev/metrics'), { recursive: true });
    write(root, '.novadev/metrics', 'a file');
    const result = run(root, 'doctor');
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('✗ metrics: a file, not a folder');
  });

  test('a folder where the snapshot belongs is a problem, not a crash', () => {
    const root = deployed();
    mkdirSync(join(root, '.novadev/metrics/latest.json'));
    const result = run(root, 'doctor');
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('✗ metrics/latest.json: a folder, not a file');
  });

  test('a debt budget the stored snapshot cannot check is a note', () => {
    const root = deployed();
    setManifest(root, { metrics: 'cat metrics-out.json', debtBudget: { maxKnown: 230 } });
    write(root, '.novadev/metrics/latest.json', '{"updated":"2026-10-01","hubs":[]}');
    expect(run(root, 'doctor').stdout).toContain(
      'debtBudget is set, but metrics/latest.json has no "debt" count to check it against — the metrics command must print one',
    );
  });

  test('never runs the metrics command', () => {
    const root = deployed();
    setManifest(root, { metrics: 'touch doctor-ran' });
    run(root, 'doctor');
    expect(exists(root, 'doctor-ran')).toBe(false);
  });
});

describe('status', () => {
  test('one line about metrics: off, waiting for a first snapshot, or the numbers', () => {
    const root = project();
    expect(run(root, 'status').stdout).toContain('metrics — off (no "metrics" command in novadev.json)');

    setManifest(root, { metrics: 'cat metrics-out.json', debtBudget: { maxKnown: 240 } });
    expect(run(root, 'status').stdout).toContain('metrics — on, no snapshot yet');

    write(
      root,
      'metrics-out.json',
      '{"debt":{"known":238,"new":1},"hubs":[{"name":"A","measure":5},{"name":"B","measure":6}]}',
    );
    run(root, 'sync');
    expect(run(root, 'status').stdout).toContain(
      `metrics — known debt 238 of 240, 1 new, 2 hub(s), as of ${todayStamp()}`,
    );

    write(root, '.novadev/metrics/latest.json', '{\n<<<<<<< HEAD\n}\n');
    expect(run(root, 'status').stdout).toContain(
      'metrics — ⚠ metrics/latest.json cannot be read (not valid JSON); `novadev doctor` says more',
    );
  });
});
