// The pure parts of the metrics hook: the agreed JSON shape, the snapshot format, the deltas,
// the `## Debt` raise syntax, the raise ledger, the settings, and the wiki block.
import { describe, expect, test } from 'bun:test';
import { type DebtBudget, type RecordRaise, applyRaises, debtRaiseIn, pendingRaises } from '../src/debt-budget.ts';
import { renderBudgetsBlock } from '../src/metrics-audit.ts';
import {
  type Metrics,
  change,
  diffMetrics,
  fmt,
  normalizeMetrics,
  parseMetricsOutput,
  readMetricsConfig,
  readSnapshot,
  renderSnapshot,
  sameMetrics,
  writeSnapshot,
} from '../src/metrics.ts';
import { project, setManifest, tempDir, write } from './helpers.ts';
import { join } from 'node:path';

function ok(stdout: string): Metrics {
  const parsed = parseMetricsOutput(stdout);
  if (!parsed.ok) throw new Error(`expected valid metrics, got: ${parsed.error}`);
  return parsed.value;
}

function error(value: unknown): string {
  const parsed = typeof value === 'string' ? parseMetricsOutput(value) : normalizeMetrics(value);
  if (parsed.ok) throw new Error('expected the metrics to be refused');
  return parsed.error;
}

describe('the agreed JSON shape', () => {
  test('accepts the brief\'s shape and normalizes it', () => {
    const metrics = ok(
      JSON.stringify({
        debt: { known: 230, new: 0 },
        hubs: [
          { name: 'Workbench', measure: 11019, over: ['publicVerbs', 'loc', 'loc'], path: './src/wb/' },
          { name: 'Stage3D', measure: 3304, over: [] },
        ],
        somethingElse: { ignored: true },
      }),
    );
    expect(metrics).toEqual({
      debt: { known: 230, new: 0 },
      hubs: [
        { name: 'Stage3D', measure: 3304, over: [] },
        { name: 'Workbench', measure: 11019, over: ['loc', 'publicVerbs'], path: 'src/wb/' },
      ],
    });
  });

  test('debt alone, hubs alone, and an empty hub list are all valid', () => {
    expect(ok('{"debt":{"known":3}}')).toEqual({ debt: { known: 3 }, hubs: [] });
    expect(ok('{"hubs":[{"name":"A","measure":1.5}]}')).toEqual({ hubs: [{ name: 'A', measure: 1.5, over: [] }] });
    expect(ok('{"hubs":[]}')).toEqual({ hubs: [] });
  });

  test('"new" is optional and is not invented when absent', () => {
    expect(ok('{"debt":{"known":7}}').debt).toEqual({ known: 7 });
    expect(ok('{"debt":{"known":7,"new":null}}').debt).toEqual({ known: 7 });
  });

  test('refuses output that is not one JSON object, with a hint about stderr', () => {
    expect(error('')).toContain('printed nothing');
    expect(error('   \n')).toContain('printed nothing');
    const noisy = error('compiling…\n{"debt":{"known":1}}');
    expect(noisy).toContain('not JSON');
    expect(noisy).toContain('compiling…');
    expect(noisy).toContain('stderr');
    expect(error('[1,2]')).toContain('must be an object');
    expect(error('{}')).toContain('neither "debt" nor "hubs"');
  });

  test('refuses wrong field types, naming the field', () => {
    expect(error({ debt: 5 })).toContain('"debt" must be an object');
    expect(error({ debt: { known: -1 } })).toContain('debt.known');
    expect(error({ debt: { known: 1.5 } })).toContain('debt.known');
    expect(error({ debt: { known: '230' } })).toContain('debt.known');
    expect(error({ debt: { known: 1, new: -2 } })).toContain('debt.new');
    expect(error({ hubs: {} })).toContain('"hubs" must be a list');
    expect(error({ hubs: [7] })).toContain('hubs[0] must be an object');
    expect(error({ hubs: [{ measure: 1 }] })).toContain('needs a "name"');
    expect(error({ hubs: [{ name: '  ', measure: 1 }] })).toContain('needs a "name"');
    expect(error({ hubs: [{ name: 'A', measure: -1 }] })).toContain('"measure"');
    expect(error({ hubs: [{ name: 'A', measure: '9' }] })).toContain('"measure"');
    expect(error({ hubs: [{ name: 'A', measure: 1, over: 'loc' }] })).toContain('"over"');
    expect(error({ hubs: [{ name: 'A', measure: 1, over: [''] }] })).toContain('"over"');
    expect(error({ hubs: [{ name: 'A', measure: 1, path: '' }] })).toContain('"path"');
  });

  test('hub names must be unique — they are what deltas compare by', () => {
    expect(error({ hubs: [{ name: 'A', measure: 1 }, { name: 'A', measure: 2 }] })).toContain('unique');
  });
});

describe('the stored snapshot', () => {
  const metrics: Metrics = {
    debt: { known: 230, new: 1 },
    hubs: [
      { name: 'A', measure: 10, over: ['loc'] },
      { name: 'B', measure: 20, over: [], path: 'src/b/' },
    ],
  };

  test('is plain JSON with one hub per line, and reads back the same', () => {
    const text = renderSnapshot({ ...metrics, updated: '2026-10-01' });
    expect(text).toBe(
      '{\n' +
        '  "updated": "2026-10-01",\n' +
        '  "debt": {"known":230,"new":1},\n' +
        '  "hubs": [\n' +
        '    {"name":"A","measure":10,"over":["loc"]},\n' +
        '    {"name":"B","measure":20,"over":[],"path":"src/b/"}\n' +
        '  ]\n' +
        '}\n',
    );
    const nd = join(tempDir(), '.novadev');
    writeSnapshot(nd, { ...metrics, updated: '2026-10-01' });
    expect(readSnapshot(nd)).toEqual({ state: 'ok', snapshot: { ...metrics, updated: '2026-10-01' } });
  });

  test('an empty hub list and a missing debt still render as valid JSON', () => {
    const text = renderSnapshot({ hubs: [], updated: '2026-10-01' });
    expect(JSON.parse(text)).toEqual({ updated: '2026-10-01', hubs: [] });
  });

  test('sameMetrics ignores the date but sees every number and path', () => {
    expect(sameMetrics({ ...metrics }, { ...metrics })).toBe(true);
    expect(sameMetrics(metrics, { ...metrics, debt: { known: 231, new: 1 } })).toBe(false);
    const moved = { ...metrics, hubs: [metrics.hubs[0]!, { ...metrics.hubs[1]!, path: 'src/c/' }] };
    expect(sameMetrics(metrics, moved)).toBe(false);
  });

  test('readSnapshot tells absent, unreadable and malformed apart', () => {
    const root = tempDir();
    const nd = join(root, '.novadev');
    expect(readSnapshot(nd)).toEqual({ state: 'absent' });
    write(root, '.novadev/metrics/latest.json', '{ nope');
    expect(readSnapshot(nd)).toEqual({ state: 'invalid', error: 'not valid JSON' });
    write(root, '.novadev/metrics/latest.json', '{"debt":{"known":-3}}');
    expect(readSnapshot(nd).state).toBe('invalid');
    write(root, '.novadev/metrics/latest.json', '{"debt":{"known":3}}');
    expect(readSnapshot(nd)).toEqual({ state: 'ok', snapshot: { debt: { known: 3 }, hubs: [], updated: '' } });
  });
});

describe('deltas', () => {
  test('numbers read like the brief: thousands separators and a signed difference', () => {
    expect(fmt(11019)).toBe('11,019');
    expect(fmt(2.345)).toBe('2.35');
    expect(change(230, 238)).toBe('230 → 238 (+8)');
    expect(change(11019, 11140)).toBe('11,019 → 11,140 (+121)');
    expect(change(3304, 3280)).toBe('3,304 → 3,280 (-24)');
  });

  test('growth is flagged, shrinking is not', () => {
    const before: Metrics = {
      debt: { known: 230, new: 0 },
      hubs: [
        { name: 'Gone', measure: 1550, over: [] },
        { name: 'Stage3D', measure: 3304, over: ['loc'] },
        { name: 'Workbench', measure: 11019, over: ['loc'] },
      ],
    };
    const after: Metrics = {
      debt: { known: 238, new: 2 },
      hubs: [
        { name: 'Planner', measure: 1600, over: ['loc'] },
        { name: 'Stage3D', measure: 3280, over: [] },
        { name: 'Workbench', measure: 11140, over: ['loc', 'publicVerbs'] },
      ],
    };
    const deltas = diffMetrics(before, after).map((d) => [d.grew, d.text]);
    expect(deltas).toEqual([
      [true, 'known debt 230 → 238 (+8)'],
      [true, 'new debt 0 → 2 (+2)'],
      [false, 'hub Gone is gone (was 1,550)'],
      [true, 'hub Planner 1,600 is new (over loc)'],
      [false, 'hub Stage3D 3,304 → 3,280 (-24), no longer over loc'],
      [true, 'hub Workbench 11,019 → 11,140 (+121), now over publicVerbs'],
    ]);
  });

  test('a hub that crosses a new budget grows even when its measure did not', () => {
    const deltas = diffMetrics(
      { hubs: [{ name: 'A', measure: 5, over: [] }] },
      { hubs: [{ name: 'A', measure: 5, over: ['verbs'] }] },
    );
    expect(deltas.map((d) => [d.grew, d.text])).toEqual([[true, 'hub A 5, now over verbs']]);
  });

  test('nothing moved → no deltas; debt on one side only → no debt delta', () => {
    const m: Metrics = { debt: { known: 1 }, hubs: [{ name: 'A', measure: 5, over: [] }] };
    expect(diffMetrics(m, m)).toEqual([]);
    expect(diffMetrics({ hubs: [] }, { debt: { known: 9 }, hubs: [] })).toEqual([]);
    expect(diffMetrics({ debt: { known: 1, new: 0 }, hubs: [] }, { debt: { known: 1 }, hubs: [] })).toEqual([]);
  });
});

describe('the ## Debt raise in a record', () => {
  const record = (debt: string) =>
    `# ai_completed — x\n\n**Date:** 2026-10-01\n\n## What I did\nStuff.\n\n${debt}\n## Notes\nnone\n`;

  test('reads "from → to" in every arrow spelling, and a bare value', () => {
    for (const arrow of ['→', '->', '=>', 'to']) {
      expect(debtRaiseIn(record(`## Debt\n**Raise:** 230 ${arrow} 238\nThe kit registry adds eight.\n`))).toEqual({
        from: 230,
        to: 238,
      });
    }
    expect(debtRaiseIn(record('## Debt\n**Raise:** 1,238 (was 1,230)\nBecause.\n'))).toEqual({ to: 1238 });
  });

  test('tolerates CRLF files and any case', () => {
    const text = record('## debt\r\n**raise:** 230 → 238\r\nA real reason.\r\n').replace(/\n/g, '\r\n');
    expect(debtRaiseIn(text)).toEqual({ from: 230, to: 238 });
  });

  test('no section, or a section with no Raise line, is no raise', () => {
    expect(debtRaiseIn(record(''))).toBeNull();
    expect(debtRaiseIn(record('## Debt\nWe noticed some debt but stayed under budget.\n'))).toBeNull();
    expect(debtRaiseIn(record('## Debts paid\n**Raise:** 5\nno\n'))).toBeNull();
    expect(debtRaiseIn(record('### Debt\n**Raise:** 5\nno\n'))).toBeNull();
  });

  test('the section ends at the next heading: a Raise line after it does not count', () => {
    expect(debtRaiseIn('## Debt\nOnly words here.\n\n## Notes\n**Raise:** 999\nnope\n')).toBeNull();
  });

  test('a Raise quoted inside a code fence is ignored', () => {
    const quoted = record('```markdown\n## Debt\n**Raise:** 1 → 999999\nquoted\n```\n');
    expect(debtRaiseIn(quoted)).toBeNull();
    const both = record('~~~\n## Debt\n**Raise:** 1 → 999999\n~~~\n\n## Debt\n**Raise:** 230 → 238\nReal.\n');
    expect(debtRaiseIn(both)).toEqual({ from: 230, to: 238 });
  });

  test('a raise needs a number and a reason — otherwise it is an error, never applied', () => {
    expect(debtRaiseIn(record('## Debt\n**Raise:** a lot\nBecause.\n'))).toEqual({
      error: expect.stringContaining('needs the new budget'),
    });
    expect(debtRaiseIn(record('## Debt\n**Raise:** 230 → 238\n'))).toEqual({
      error: expect.stringContaining('gives no reason'),
    });
    expect(debtRaiseIn(record('## Debt\n**Raise:** 230 → 238\n<why the debt grew>\n<!-- todo -->\n'))).toEqual({
      error: expect.stringContaining('gives no reason'),
    });
  });
});

describe('the raise ledger', () => {
  const raise = (ref: string, to: number, from?: number): RecordRaise => ({
    ref,
    file: 'ai_completed.md',
    to,
    ...(from === undefined ? {} : { from }),
  });

  test('a raise is pending until the ledger names that record AND that value', () => {
    const budget: DebtBudget = {
      maxKnown: 238,
      raises: [{ by: 'b/01-a', from: 230, to: 238, on: '2026-10-01' }],
    };
    const found = [raise('b/01-a', 238), raise('b/02-b', 250), raise('b/01-a', 245), raise('b/02-b', 250)];
    expect(pendingRaises(budget, found).map((r) => `${r.ref}:${r.to}`)).toEqual(['b/01-a:245', 'b/02-b:250']);
  });

  test('applying keeps the highest value, never lowers, and remembers every raise', () => {
    const budget: DebtBudget = { maxKnown: 230, raises: [] };
    const next = applyRaises(budget, [raise('b/01-a', 235), raise('b/02-b', 238)], '2026-10-01');
    expect(next).toEqual({
      maxKnown: 238,
      raises: [
        { by: 'b/01-a', from: 230, to: 235, on: '2026-10-01' },
        { by: 'b/02-b', from: 235, to: 238, on: '2026-10-01' },
      ],
    });
    // A raise below the current budget changes nothing but is still remembered — so it can never
    // fire later, after someone lowers the budget by hand.
    const noop = applyRaises(next, [raise('b/03-c', 200)], '2026-10-02');
    expect(noop.maxKnown).toBe(238);
    expect(noop.raises.at(-1)).toEqual({ by: 'b/03-c', from: 238, to: 200, on: '2026-10-02' });
    expect(pendingRaises({ ...noop, maxKnown: 100 }, [raise('b/03-c', 200)])).toEqual([]);
  });

  test('pending raises come lowest value first, so the ledger reads in order', () => {
    const found = [raise('b/09-z', 240), raise('b/01-a', 236), raise('b/05-m', 236)];
    expect(pendingRaises({ maxKnown: 230, raises: [] }, found).map((r) => r.ref)).toEqual([
      'b/01-a',
      'b/05-m',
      'b/09-z',
    ]);
  });
});

describe('settings in novadev.json', () => {
  const config = (manifest: Record<string, unknown>) => {
    const root = project();
    setManifest(root, manifest);
    return readMetricsConfig(join(root, '.novadev'));
  };

  test('everything is off by default, and null means off', () => {
    expect(config({})).toEqual({
      command: null,
      timeoutSeconds: 300,
      wikiPage: 'architecture.md',
      budget: null,
      problems: [],
    });
    expect(config({ metrics: null, debtBudget: null, metricsWikiPage: null })).toMatchObject({
      command: null,
      budget: null,
      wikiPage: 'architecture.md',
      problems: [],
    });
    expect(config({ metrics: '   ' }).command).toBeNull();
  });

  test('reads a command, a timeout, a page, and a budget', () => {
    expect(
      config({
        metrics: ' bun scripts/metrics.ts ',
        metricsTimeoutSeconds: 90,
        metricsWikiPage: 'budgets.md',
        debtBudget: { maxKnown: 230 },
      }),
    ).toEqual({
      command: 'bun scripts/metrics.ts',
      timeoutSeconds: 90,
      wikiPage: 'budgets.md',
      budget: { maxKnown: 230, raises: [] },
      problems: [],
    });
    expect(config({ metricsWikiPage: false }).wikiPage).toBeNull();
  });

  test('a wrong type is a problem, and that setting is treated as off', () => {
    const bad = config({
      metrics: 42,
      metricsTimeoutSeconds: 0,
      metricsWikiPage: 'INDEX.md',
      debtBudget: { maxKnown: '230' },
    });
    expect(bad.command).toBeNull();
    expect(bad.budget).toBeNull();
    expect(bad.timeoutSeconds).toBe(300);
    expect(bad.wikiPage).toBe('architecture.md');
    expect(bad.problems).toHaveLength(4);
    expect(bad.problems.join('\n')).toContain('"metrics" must be a shell command');
    expect(config({ metricsWikiPage: 'sub/page.md' }).problems[0]).toContain('metricsWikiPage');
    expect(config({ debtBudget: 230 }).problems[0]).toContain('"debtBudget" must be an object');
    expect(config({ debtBudget: { maxKnown: 1, raises: {} } }).problems[0]).toContain('must be a list');
    expect(config({ debtBudget: { maxKnown: 1, raises: [{ by: 'x' }] } }).problems[0]).toContain('raises[0]');
  });
});

describe('the wiki budgets block', () => {
  const snapshot = {
    updated: '2026-10-01',
    debt: { known: 230, new: 0 },
    hubs: [
      { name: 'Small', measure: 900, over: [] },
      { name: 'Work|bench', measure: 11019, over: ['loc', 'publicVerbs'], path: 'src/wb/' },
    ],
  };

  test('shows the debt line and the hubs, biggest first, with a path column when any hub has one', () => {
    expect(renderBudgetsBlock(snapshot, { maxKnown: 230, raises: [] })).toBe(
      [
        '<!-- generated by `novadev sync` from .novadev/metrics/latest.json — do not edit inside these markers -->',
        '**Known debt:** 230 (budget 230) · **new:** 0 · as of 2026-10-01',
        '',
        '| Hub | Measure | Over budget on | Path |',
        '|---|---:|---|---|',
        '| Work\\|bench | 11,019 | loc, publicVerbs | `src/wb/` |',
        '| Small | 900 | — | — |',
      ].join('\n'),
    );
  });

  test('leaves out what is not measured', () => {
    const text = renderBudgetsBlock({ updated: '2026-10-01', hubs: [{ name: 'A', measure: 1, over: [] }] }, null);
    expect(text).toContain('Measured as of 2026-10-01.');
    expect(text).not.toContain('Known debt');
    expect(text).toContain('| Hub | Measure | Over budget on |\n');
    expect(renderBudgetsBlock({ updated: '', debt: { known: 3 }, hubs: [] }, null)).toContain(
      '**Known debt:** 3\n\n_No hubs reported._',
    );
  });
});
