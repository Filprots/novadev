// The review of novadev 0.10.0 (thph-consumer-test batch 2026-09-30_2/31), kept as written: each
// test here failed before the fixes. The themed test files cover the same behaviour in more detail.
// One change since: the last test runs git through the helpers (no hooks, no signing, no GIT_*
// variables from a parent process), as every fixture must.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debtRaiseIn } from '../src/debt-budget.ts';
import { normalizeMetrics } from '../src/metrics.ts';
import { commitAll, completed, metricsProject, project, read, readJson, run, setManifest, todo, write } from './helpers.ts';

const SNAP = '{"updated":"2026-10-01","debt":{"known":1},"hubs":[]}';
function blockProject(page: string, out = '{"debt":{"known":2},"hubs":[]}'): string {
  const root = project({ metrics: 'cat metrics-out.json' });
  write(root, '.novadev/metrics/latest.json', SNAP);
  write(root, 'metrics-out.json', out);
  write(root, '.novadev/knowledge/wiki/architecture.md', page);
  return root;
}

describe('[major] the budgets block never rewrites hand-written wiki text', () => {
  test('a begin marker quoted in prose ABOVE the real block does not delete the text in between', () => {
    const root = blockProject(
      '# Architecture\n\nSync rewrites what follows `<!-- novadev:budgets:begin -->`.\n\n' +
        '## Components\n\nHand-written text that must survive.\n\n' +
        '## Budgets\n\n<!-- novadev:budgets:begin -->\nold\n<!-- novadev:budgets:end -->\n',
    );
    run(root, 'sync');
    expect(read(root, '.novadev/knowledge/wiki/architecture.md')).toContain('Hand-written text that must survive.');
  });
  test('both markers quoted inline in one sentence are not "the block"', () => {
    const sentence = 'It sits between `<!-- novadev:budgets:begin -->` and `<!-- novadev:budgets:end -->`.';
    const root = blockProject(`# Architecture\n\n${sentence}\n`);
    run(root, 'sync');
    expect(read(root, '.novadev/knowledge/wiki/architecture.md')).toContain(sentence);
  });
  test('an example of the block inside a code fence is left alone', () => {
    const example = '```markdown\n<!-- novadev:budgets:begin -->\n(example rows)\n<!-- novadev:budgets:end -->\n```';
    const root = blockProject(`# Architecture\n\n${example}\n`);
    run(root, 'sync');
    expect(read(root, '.novadev/knowledge/wiki/architecture.md')).toContain(example);
  });
});

describe('[minor] the ## Debt raise syntax', () => {
  test('a reason written on the Raise line itself counts as a reason', () => {
    expect(debtRaiseIn('## Debt\n**Raise:** 230 → 238 because the kit registry adds eight findings\n')).toEqual({ from: 230, to: 238 });
  });
  test('an unrecognised separator is an error, not a raise to the FIRST number', () => {
    for (const line of ['230 – 238', '230 ⟶ 238', '1 230 → 1 238', '1.230 → 1.238']) {
      const found = debtRaiseIn(`## Debt\n**Raise:** ${line}\nThe kit registry adds eight findings.\n`);
      expect(found === null || 'error' in found || found.to >= 238).toBe(true);
    }
  });
  test('a Raise line the parser cannot read is reported, not silently ignored', () => {
    for (const line of ['**Raise**: 230 → 238', '- **Raise:** 230 → 238']) {
      expect(debtRaiseIn(`## Debt\n${line}\nThe kit registry adds eight findings.\n`)).not.toBeNull();
    }
  });
  test('when the record already holds the exact raise the NEXT ACTION asks for, sync says why it is not applied', () => {
    const root = metricsProject({ debt: { known: 238 }, hubs: [] }, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\n**Raise:** 230 → 238\nWhy.\n') });
    run(root, 'sync');
    setManifest(root, { debtBudget: { ...readJson(root, '.novadev/novadev.json').debtBudget, maxKnown: 232 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\n**Raise:** 232 → 238\nStill needed.\n') });
    expect(run(root, 'sync').stdout).not.toContain('add a "## Debt" section with "**Raise:** 232 → 238"');
  });
  test('a raise far above the measured debt is capped (or at least warned)', () => {
    const root = metricsProject({ debt: { known: 238 }, hubs: [] }, { debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\n**Raise:** 230 → 100000\nWhy.\n') });
    const result = run(root, 'sync');
    const max = readJson(root, '.novadev/novadev.json').debtBudget.maxKnown;
    expect(max <= 238 || /above the measured|more than the debt/i.test(result.stdout)).toBe(true);
  });
});

describe('[minor] the metrics command and its output', () => {
  test('a timed-out command leaves no child process running', () => {
    const root = metricsProject({ debt: { known: 1 } });
    setManifest(root, { metrics: "sh -c 'sleep 30 & echo $! > child.pid; wait'", metricsTimeoutSeconds: 0.5 });
    run(root, 'sync');
    const pid = Number(readFileSync(join(root, 'child.pid'), 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
  });
  test('a command novadev cannot even start is a warning, not a crash', () => {
    const root = metricsProject({ debt: { known: 1 } });
    setManifest(root, { metrics: 'cat metrics-out.json\u0000' });
    const result = run(root, 'sync');
    expect(result.stderr).not.toContain('TypeError');
    expect(result.code).toBe(0);
  });
  test('a failing command never fails sync, even when latest.json holds merge-conflict markers', () => {
    const root = metricsProject({ debt: { known: 1 }, hubs: [] });
    run(root, 'sync');
    write(root, '.novadev/metrics/latest.json', '{\n<<<<<<< HEAD\n  "updated": "2026-10-01",\n=======\n  "updated": "2026-10-02",\n>>>>>>> other\n  "hubs": []\n}\n');
    setManifest(root, { metrics: 'exit 1' });
    expect(run(root, 'sync').code).toBe(0);
  });
  test('hub paths are stored with forward slashes, so Windows and Linux runs agree', () => {
    const win = normalizeMetrics({ hubs: [{ name: 'Workbench', measure: 1, path: '.\\src\\wb\\' }] });
    expect(win.ok && win.value.hubs[0]!.path).toBe('src/wb/');
  });
  test('a debt count that disappears from the output does not pass the budget gate silently', () => {
    const root = metricsProject({ debt: { known: 238 }, hubs: [] }, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    write(root, 'metrics-out.json', '{"hubs":[]}');
    expect(run(root, 'sync', '--check').code).toBe(1);
  });
  test('a hub that grew is still a NEXT ACTION on the next sync of the same uncommitted round', () => {
    const root = metricsProject({ hubs: [{ name: 'Workbench', measure: 100 }] });
    run(root, 'sync');
    commitAll(root, 'base');
    write(root, 'metrics-out.json', '{"hubs":[{"name":"Workbench","measure":150}]}');
    run(root, 'sync');
    expect(run(root, 'sync').stdout).toContain('hub Workbench 100 → 150 (+50)');
  });
});
