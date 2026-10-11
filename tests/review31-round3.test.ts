// The third review of novadev 0.10.0 (thph-consumer-test batch 2026-09-30_2/31), kept as written:
// each test here failed before the fixes. The reviewer's own tests come first in each group; the
// tests for the findings that came without one follow. The themed test files cover the same
// behaviour in more detail.
import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { debtRaiseIn } from '../src/debt-budget.ts';
import {
  REPO,
  commitAll,
  completed,
  git,
  metricsOutput,
  metricsProject,
  project,
  read,
  readJson,
  run,
  todo,
  write,
} from './helpers.ts';

describe('[major] findings', () => {
  test('a raise `sync --check` accepted still counts once the round is committed (or --check refuses it first)', () => {
    const root = metricsProject({ debt: { known: 230 }, hubs: [] }, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'base');
    metricsOutput(root, { debt: { known: 238 }, hubs: [] });
    run(root, 'sync');
    todo(root, '2026-10-01_1/01-a', {
      'ai_completed.md': completed('01-a', '\n## Debt\n**Raise:** 230 → 238\nThe kit registry adds eight findings.\n'),
    });
    const hook = run(root, 'sync', '--check'); // pre-commit hook
    commitAll(root, 'round'); // hook passed, commit lands
    const ci = run(root, 'sync', '--check'); // CI, same tree
    expect(hook.code === 0 ? ci.code : 0).toBe(0); // today: hook 0, CI 1
  });

  test("phase 10's **Commits:** line, added after the commit, does not let round 1's unneeded raise lift round 2's growth", () => {
    const root = metricsProject({ debt: { known: 229 }, hubs: [] }, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'before round 1');
    const record = (commits: string) =>
      `# ai_completed — 01-a\n\n**Date:** 2026-10-01\n**Feature:** none — fixture\n${commits}\n## What I did\nThe work.\n\n## Debt\n**Raise:** 230 → 100000\nA big refactor is coming.\n`;
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record('') });
    run(root, 'sync');
    commitAll(root, 'round 1');
    const hash = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': record(`**Commits:** ${hash}\n`) });
    run(root, 'sync');
    todo(root, '2026-10-01_1/02-b', { 'ai_completed.md': completed('02-b') });
    metricsOutput(root, { debt: { known: 5000 }, hubs: [] });
    const round2 = run(root, 'sync');
    expect(readJson(root, '.novadev/novadev.json').debtBudget.maxKnown).toBe(230); // today: 5000
    expect(round2.stdout).not.toContain('explained in 2026-10-01_1/01-a');
  });
});

describe('[minor] findings', () => {
  test('deleting a conflicted latest.json while the command lost "debt" keeps the gate on', () => {
    const root = metricsProject({ debt: { known: 238 }, hubs: [] }, { debtBudget: { maxKnown: 230 } });
    run(root, 'sync');
    commitAll(root, 'base');
    rmSync(join(root, '.novadev/metrics/latest.json'));
    metricsOutput(root, { hubs: [] });
    run(root, 'sync');
    expect(run(root, 'sync', '--check').code).not.toBe(0); // today: 0
  });

  test('deploy refuses a novadev.json it cannot read', () => {
    const root = project({ metrics: 'cat metrics-out.json' });
    const conflicted =
      '{\n  "novadev": true,\n  "version": "0.10.0",\n  "metrics": "cat metrics-out.json",\n<<<<<<< HEAD\n  "debtBudget": { "maxKnown": 238, "raises": [] }\n=======\n  "debtBudget": { "maxKnown": 235, "raises": [] }\n>>>>>>> other\n}\n';
    write(root, '.novadev/novadev.json', conflicted);
    expect(run(root, 'deploy').code).not.toBe(0); // today: 0
    expect(read(root, '.novadev/novadev.json')).toBe(conflicted); // today: settings dropped
  });

  test('a raise line in an HTML comment is not read; a numbered or quoted one is never skipped without a word', () => {
    expect(debtRaiseIn('## Debt\n<!--\n**Raise:** 230 → 238\n-->\nNo new debt this round.\n')).toBeNull(); // today: {from:230,to:238}
    expect(debtRaiseIn('## Debt\n1. **Raise:** 230 → 238\nThe kits.\n')).not.toBeNull(); // today: null
    expect(debtRaiseIn('## Debt\n> **Raise:** 230 → 238\n> The kits.\n')).not.toBeNull(); // today: null
  });

  test('"## Debt" saying "None." does not explain known debt that grew', () => {
    const root = metricsProject({ debt: { known: 200 }, hubs: [] });
    run(root, 'sync');
    commitAll(root, 'base');
    metricsOutput(root, { debt: { known: 230 }, hubs: [] });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\nNone.\n') });
    expect(run(root, 'sync').stdout).toContain('known debt 200 → 230 (+30) — it grew');
  });

  test('known debt under the budget is a NEXT ACTION to lower it, not a hint agents skip', () => {
    const root = metricsProject({ debt: { known: 220 }, hubs: [] }, { debtBudget: { maxKnown: 230 } });
    const result = run(root, 'sync');
    const actions = result.stdout.split('NEXT ACTIONS')[1] ?? '';
    expect(actions).toContain('lower "maxKnown" to 220 in novadev.json');
    expect(result.stdout).not.toContain('sync: clean');
  });

  test('the playbook and the README say it in plain words: no "is history"', () => {
    for (const file of ['templates/skills/novadev-work.md', 'README.md', 'templates/readmes/metrics.md']) {
      expect(readFileSync(join(REPO, file), 'utf8')).not.toContain('is history');
    }
  });

  test('sync --check names each stale derived file', () => {
    const root = metricsProject({ debt: { known: 1 }, hubs: [] });
    run(root, 'sync');
    metricsOutput(root, { debt: { known: 2 }, hubs: [] });
    const check = run(root, 'sync', '--check');
    expect(check.stdout).toContain('✗ metrics/latest.json: out of date');
    expect(check.stdout).toContain('✗ knowledge/wiki/architecture.md: budgets block out of date');
  });
});
