// The pure parts of the metrics hook: the agreed JSON shape, the snapshot format, the deltas,
// the `## Debt` raise syntax, the raise plan and ledger, the settings, and the wiki block.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DebtBudget,
  type RecordRaise,
  type RecordRound,
  debtRaiseIn,
  debtSections,
  pendingRaises,
  planRaises,
  saysWhy,
} from '../src/debt-budget.ts';
import { renderBudgetsBlock } from '../src/metrics-audit.ts';
import {
  type Metrics,
  change,
  describeRaise,
  diffMetrics,
  displayCommand,
  fmt,
  mentions,
  normalizeMetrics,
  parseMetricsOutput,
  readMetricsConfig,
  readSnapshot,
  renderSnapshot,
  repoPath,
  sameMetrics,
} from '../src/metrics.ts';
import { project, setManifest, tempDir, write } from './helpers.ts';

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

  test('a name, a budget name or a path must be one line of text — it ends up in a table and a terminal', () => {
    expect(error({ hubs: [{ name: 'Work\nbench', measure: 1 }] })).toContain('one line of plain text');
    expect(error({ hubs: [{ name: 'A', measure: 1, over: ['l\toc'] }] })).toContain('"over"');
    expect(error({ hubs: [{ name: 'A', measure: 1, path: 'src/\nwb' }] })).toContain('"path"');
  });
});

describe('hub paths', () => {
  test('are stored with forward slashes and no "." segments, whatever the platform printed', () => {
    expect(repoPath('.\\src\\wb\\')).toBe('src/wb/');
    expect(repoPath('./src/wb/')).toBe('src/wb/');
    expect(repoPath('././src//wb')).toBe('src/wb');
    expect(repoPath('src/./wb/.')).toBe('src/wb');
    expect(repoPath('  src/wb.ts  ')).toBe('src/wb.ts');
    expect(repoPath('src/wb...ts')).toBe('src/wb...ts');
  });

  test('an absolute or empty path is refused: it would differ from one machine to the next', () => {
    for (const path of ['/home/me/repo/src', 'C:\\repo\\src', 'c:/repo', '\\\\server\\share', './', '.', '']) {
      expect(repoPath(path)).toBeNull();
    }
    expect(error({ hubs: [{ name: 'A', measure: 1, path: '/abs/src' }] })).toContain('relative to its root');
  });

  test('a path that leaves the project with ".." is refused', () => {
    for (const path of ['../shared/x.ts', '..', 'src/../../other', '..\\other\\src']) {
      expect(repoPath(path)).toBeNull();
    }
    expect(error({ hubs: [{ name: 'A', measure: 1, path: '../other-repo/src/' }] })).toContain('without ".."');
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
    const root = tempDir();
    write(root, '.novadev/metrics/latest.json', text);
    expect(readSnapshot(join(root, '.novadev'))).toEqual({
      state: 'ok',
      snapshot: { ...metrics, updated: '2026-10-01' },
    });
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

  test('a file where the metrics folder belongs reads as no snapshot, not a crash', () => {
    const root = tempDir();
    write(root, '.novadev/metrics', 'a file');
    expect(readSnapshot(join(root, '.novadev'))).toEqual({ state: 'absent' });
  });

  test('something that is not a file where the snapshot belongs is "blocked" — never written over', () => {
    const folder = tempDir();
    mkdirSync(join(folder, '.novadev/metrics/latest.json'), { recursive: true });
    expect(readSnapshot(join(folder, '.novadev'))).toEqual({ state: 'blocked', error: 'a folder, not a file' });

    const link = tempDir();
    mkdirSync(join(link, '.novadev/metrics'), { recursive: true });
    symlinkSync(join(link, 'nowhere.json'), join(link, '.novadev/metrics/latest.json'));
    expect(readSnapshot(join(link, '.novadev'))).toEqual({ state: 'blocked', error: 'a link that points nowhere' });
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

  test('growth is flagged, shrinking is not; hub deltas name their hub', () => {
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
    const deltas = diffMetrics(before, after).map((d) => [d.grew, d.text, d.hub]);
    expect(deltas).toEqual([
      [true, 'known debt 230 → 238 (+8)', undefined],
      [true, 'new debt 0 → 2 (+2)', undefined],
      [false, 'hub Gone is gone (was 1,550)', 'Gone'],
      [true, 'hub Planner 1,600 is new (over loc)', 'Planner'],
      [false, 'hub Stage3D 3,304 → 3,280 (-24), no longer over loc', 'Stage3D'],
      [true, 'hub Workbench 11,019 → 11,140 (+121), now over publicVerbs', 'Workbench'],
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

  test('a record names a hub as a word of its own, in any case', () => {
    expect(mentions('The Workbench grew because …', 'Workbench')).toBe(true);
    expect(mentions('the workbench grew', 'Workbench')).toBe(true);
    expect(mentions('`Workbench`: it grew', 'Workbench')).toBe(true);
    expect(mentions('WorkbenchView grew', 'Workbench')).toBe(false);
    expect(mentions('MyWorkbench grew', 'Workbench')).toBe(false);
    expect(mentions('src/editor/workbench.ts grew', 'src/editor/workbench.ts')).toBe(true);
  });
});

describe('the ## Debt raise in a record', () => {
  const record = (debt: string) =>
    `# ai_completed — x\n\n**Date:** 2026-10-01\n\n## What I did\nStuff.\n\n${debt}\n## Notes\nnone\n`;
  const raise = (line: string, reason = 'The kit registry adds eight findings.') =>
    debtRaiseIn(record(`## Debt\n${line}\n${reason}\n`));

  test('reads "from → to" in every arrow spelling', () => {
    for (const arrow of ['→', '->', '=>', 'to', 'TO', '⟶', '⇒', '–', '—']) {
      expect(raise(`**Raise:** 230 ${arrow} 238`)).toEqual({ from: 230, to: 238 });
    }
    expect(raise('**Raise:** 230→238')).toEqual({ from: 230, to: 238 });
    expect(raise('**Raise:** 1,230 → 1,238')).toEqual({ from: 1230, to: 1238 });
    expect(raise('**Raise:** 1_230 → 1_238')).toEqual({ from: 1230, to: 1238 });
  });

  test('reads the label as people write it: colon outside the bold, a bullet, no bold', () => {
    for (const label of ['**Raise**:', '- **Raise:**', '* **Raise:**', 'Raise:', '__Raise:__', '*Raise:*']) {
      expect(raise(`${label} 230 → 238`)).toEqual({ from: 230, to: 238 });
    }
  });

  test('a reason on the raise line itself counts', () => {
    expect(raise('**Raise:** 230 → 238 because the kit registry adds eight findings', '')).toEqual({
      from: 230,
      to: 238,
    });
    expect(raise('**Raise:** 230 → 238 — the kit registry adds eight', '')).toEqual({ from: 230, to: 238 });
    expect(raise('**Raise:** 230 → 238 8 new findings from the kit registry', '')).toEqual({ from: 230, to: 238 });
  });

  test('a number it cannot read for certain is an error — never a raise to the first number', () => {
    for (const value of ['230 - 238', '1 230 → 1 238', '230 → 1 238', '230 → 1\u00a0238', '1.230 → 1.238', '230 → 238.5', '1,2345 → 1,2346', '238', '1,238 (was 1,230)', 'a lot']) {
      expect(raise(`**Raise:** ${value}`)).toEqual({ error: expect.stringContaining('must look like `**Raise:** 230 → 238`') });
    }
  });

  test('a raise must go up', () => {
    expect(raise('**Raise:** 238 → 230')).toEqual({ error: expect.stringContaining('does not raise the budget') });
    expect(raise('**Raise:** 238 → 238')).toEqual({ error: expect.stringContaining('does not raise the budget') });
  });

  test('two raise lines are an error: which one counts would be a guess', () => {
    expect(raise('**Raise:** 230 → 238\n**Raise:** 238 → 240')).toEqual({
      error: expect.stringContaining('has 2 "**Raise:**" lines'),
    });
    const twoSections = record('## Debt\n**Raise:** 230 → 238\nWhy.\n\n## Debt\n- **Raise**: 230 → 240\nWhy.\n');
    expect(debtRaiseIn(twoSections)).toEqual({ error: expect.stringContaining('has 2') });
  });

  test('a raise needs a reason — a placeholder, a comment or "(+8)" is not one', () => {
    for (const reason of ['', '<why the debt grew>\n<!-- todo -->', '(+8)', '---']) {
      expect(raise('**Raise:** 230 → 238', reason)).toEqual({ error: expect.stringContaining('gives no reason') });
    }
    expect(raise('**Raise:** 230 → 238 (+8)', '')).toEqual({ error: expect.stringContaining('gives no reason') });
  });

  test('tolerates CRLF files and any case', () => {
    const text = record('## debt\r\n**raise:** 230 → 238\r\nA real reason.\r\n').replace(/\n/g, '\r\n');
    expect(debtRaiseIn(text)).toEqual({ from: 230, to: 238 });
  });

  test('no section, or a section with no raise line, is no raise — "raise" in prose is not a raise line', () => {
    expect(debtRaiseIn(record(''))).toBeNull();
    expect(debtRaiseIn(record('## Debt\nWe noticed some debt but stayed under budget.\n'))).toBeNull();
    expect(debtRaiseIn(record('## Debt\nWe did not raise the budget: Workbench grew by 40 lines.\n'))).toBeNull();
    expect(debtRaiseIn(record('## Debts paid\n**Raise:** 5 → 6\nno\n'))).toBeNull();
    expect(debtRaiseIn(record('### Debt\n**Raise:** 5 → 6\nno\n'))).toBeNull();
  });

  test('the section ends at the next heading: a raise line after it does not count', () => {
    expect(debtRaiseIn('## Debt\nOnly words here.\n\n## Notes\n**Raise:** 1 → 999\nnope\n')).toBeNull();
  });

  test('a raise quoted inside a code fence is ignored', () => {
    const quoted = record('```markdown\n## Debt\n**Raise:** 1 → 999999\nquoted\n```\n');
    expect(debtRaiseIn(quoted)).toBeNull();
    const both = record('~~~\n## Debt\n**Raise:** 1 → 999999\n~~~\n\n## Debt\n**Raise:** 230 → 238\nReal.\n');
    expect(debtRaiseIn(both)).toEqual({ from: 230, to: 238 });
    const inside = record('## Debt\nWhy it grew.\n\n```\n**Raise:** 1 → 999999\n```\n');
    expect(debtRaiseIn(inside)).toBeNull();
  });

  test('debtSections returns every section, fenced code blanked', () => {
    const sections = debtSections(record('## Debt\nOne.\n```\nhidden\n```\n\n## Debt\nTwo.\n'));
    expect(sections.map((lines) => lines.join(' ').replace(/\s+/g, ' ').trim())).toEqual(['One.', 'Two.']);
  });

  test('a raise kept in an HTML comment is not read — over several lines, or on one', () => {
    expect(raise('<!--\n**Raise:** 230 → 238\n-->', 'No new debt this round.')).toBeNull();
    expect(raise('<!-- **Raise:** 230 → 238 -->', 'Old plan.')).toBeNull();
    expect(raise('Kept for later: <!--\n**Raise:** 230 → 238\n-->', 'Old plan.')).toBeNull();
    // A comment after the numbers is no part of the raise; a heading in a comment starts no section.
    expect(raise('**Raise:** 230 → 238 <!-- was 220 -->')).toEqual({ from: 230, to: 238 });
    expect(debtRaiseIn(record('<!--\n## Debt\n**Raise:** 230 → 238\nWhy.\n-->\n'))).toBeNull();
  });

  test('a raise in a numbered item is read like one in a bullet', () => {
    expect(raise('1. **Raise:** 230 → 238')).toEqual({ from: 230, to: 238 });
    expect(raise('2) Raise: 230 → 238')).toEqual({ from: 230, to: 238 });
  });

  test('a raise in a quote is never read — it may be someone else\'s — and never skipped without a word', () => {
    for (const line of ['> **Raise:** 230 → 238', '>**Raise:** 230 → 238', '> > Raise: 230 → 238', '> - **Raise:** 230 → 238', '- > **Raise:** 230 → 238']) {
      expect(raise(line, '> The kit registry adds eight findings.')).toEqual({
        error: expect.stringContaining('is inside a quote (">"), so it is not read'),
      });
    }
    // A quote beside a real raise line is a second raise line.
    expect(raise('**Raise:** 230 → 238\n> **Raise:** 200 → 210')).toEqual({ error: expect.stringContaining('has 2') });
  });

  test('a raise whose only reason says there is nothing to explain gives no reason', () => {
    expect(raise('**Raise:** 230 → 238', 'None.')).toEqual({ error: expect.stringContaining('gives no reason') });
  });
});

describe('what says why', () => {
  test('a bare negative explains nothing, in its common forms', () => {
    for (const text of ['None.', 'none', 'No.', 'N/A', 'n/a', 'Nothing to report.', 'No new debt.', 'No new debt was added in this round.', "We didn't add any debt.", 'There is no new debt.', 'Zero new findings.', 'None. Nothing new.', '- None', '**None**']) {
      expect(saysWhy([text])).toBe(false);
    }
  });

  test('a reason explains, even when it has a "no" in it', () => {
    for (const text of ['The kit registry adds eight findings.', 'No refactor is possible before todo 19 splits the registry.', 'None of the old findings were fixed; the importer adds two.']) {
      expect(saysWhy([text])).toBe(true);
    }
  });

  test('a raise line gives only what follows its numbers', () => {
    expect(saysWhy(['**Raise:** 230 → 238'])).toBe(false);
    expect(saysWhy(['**Raise:** 230 to 238'])).toBe(false);
    expect(saysWhy(['**Raise:** 230 → 238 because the importer adds eight findings'])).toBe(true);
    expect(saysWhy(['**Raise:** 230 → 238', 'The importer adds eight findings.'])).toBe(true);
  });

  test('comments, placeholders and empty lines say nothing', () => {
    expect(saysWhy(['', '<!-- fill in -->', '<why the debt grew>'])).toBe(false);
  });
});

describe('the raise plan and ledger', () => {
  const raise = (ref: string, from: number, to: number, round?: RecordRound): RecordRaise => ({
    ref,
    file: 'ai_completed.md',
    from,
    to,
    ...(round ? { round } : {}),
  });
  const budget = (maxKnown: number, raises: DebtBudget['raises'] = []): DebtBudget => ({ maxKnown, raises });

  test('a raise from the current budget applies when the debt is over it', () => {
    const plan = planRaises(budget(230), [raise('b/01-a', 230, 238)], 238, '2026-10-01');
    expect(plan.outcomes.map((o) => o.status)).toEqual(['applied']);
    expect(plan.budget).toEqual({ maxKnown: 238, raises: [{ by: 'b/01-a', from: 230, to: 238, on: '2026-10-01' }] });
    expect(plan.changed).toBe(true);
  });

  test('it stops at the measured debt: one record cannot switch the gate off', () => {
    const plan = planRaises(budget(230), [raise('b/01-a', 230, 100000)], 238, '2026-10-01');
    expect(plan.outcomes).toEqual([{ status: 'applied', raise: raise('b/01-a', 230, 100000), applied: 238 }]);
    expect(plan.budget.maxKnown).toBe(238);
    expect(plan.budget.raises).toEqual([{ by: 'b/01-a', from: 230, to: 100000, applied: 238, on: '2026-10-01' }]);
  });

  test('a raise written against another budget is stale and not applied', () => {
    const plan = planRaises(budget(225), [raise('b/01-a', 230, 238)], 238, '2026-10-01');
    expect(plan.outcomes.map((o) => o.status)).toEqual(['stale']);
    expect(plan.budget).toEqual(budget(225));
    expect(plan.changed).toBe(false);
  });

  test('within the budget, or with nothing measured, a raise waits — it is not used up', () => {
    expect(planRaises(budget(230), [raise('b/01-a', 230, 238)], 230, 'd').outcomes[0]!.status).toBe('not-needed');
    expect(planRaises(budget(230), [raise('b/01-a', 230, 238)], null, 'd').outcomes[0]!.status).toBe('unmeasured');
    const later = planRaises(budget(230), [raise('b/01-a', 230, 238)], 236, 'd');
    expect(later.budget.maxKnown).toBe(236);
  });

  test('two raises from the same start both count; the highest wins', () => {
    const plan = planRaises(budget(230), [raise('b/02-b', 230, 240), raise('b/01-a', 230, 235)], 238, 'd');
    expect(plan.outcomes.map((o) => `${o.raise.ref}:${o.status}`)).toEqual(['b/01-a:applied', 'b/02-b:applied']);
    expect(plan.budget.maxKnown).toBe(238);
  });

  test('the ledger knows a raise by its record AND its numbers', () => {
    const ledger = budget(238, [{ by: 'b/01-a', from: 230, to: 238, on: '2026-10-01' }]);
    const found = [raise('b/01-a', 230, 238), raise('b/01-a', 238, 245), raise('b/02-b', 238, 250), raise('b/02-b', 238, 250)];
    expect(pendingRaises(ledger, found).map((r) => `${r.ref}:${r.from}→${r.to}`)).toEqual([
      'b/01-a:238→245',
      'b/02-b:238→250',
    ]);
  });

  test('an old raise never applies again after the budget is lowered — an edited one does', () => {
    const lowered = budget(230, [{ by: 'b/01-a', from: 230, to: 238, on: '2026-10-01' }]);
    expect(planRaises(lowered, [raise('b/01-a', 230, 238)], 238, 'd').budget.maxKnown).toBe(230);
    const relowered = budget(232, lowered.raises);
    expect(planRaises(relowered, [raise('b/01-a', 232, 238)], 238, 'd').budget.maxKnown).toBe(238);
  });

  test('pending raises come lowest value first, so the ledger reads in order', () => {
    const found = [raise('b/09-z', 230, 240), raise('b/01-a', 230, 236), raise('b/05-m', 230, 236)];
    expect(pendingRaises(budget(230), found).map((r) => r.ref)).toEqual(['b/01-a', 'b/05-m', 'b/09-z']);
  });

  test('a raise from an earlier round never applies, and is not recorded', () => {
    const plan = planRaises(budget(230), [raise('b/01-a', 230, 100000, 'earlier')], 5000, 'd');
    expect(plan.outcomes).toEqual([{ status: 'earlier', raise: raise('b/01-a', 230, 100000, 'earlier') }]);
    expect(plan.budget).toEqual(budget(230));
    expect(plan.changed).toBe(false);
  });

  test("this round's raise waits while it is not needed; without git it is used up at once", () => {
    const waiting = planRaises(budget(230), [raise('b/01-a', 230, 238, 'this')], 229, 'd');
    expect(waiting.outcomes.map((o) => o.status === 'not-needed' && o.spent)).toEqual([false]);
    expect(waiting.changed).toBe(false);

    const spent = planRaises(budget(230), [raise('b/01-a', 230, 238, 'unknown')], 229, '2026-10-01');
    expect(spent.outcomes.map((o) => o.status === 'not-needed' && o.spent)).toEqual([true]);
    expect(spent.budget).toEqual(budget(230, [{ by: 'b/01-a', from: 230, to: 238, applied: 230, on: '2026-10-01' }]));
    expect(spent.changed).toBe(true);
    // Used up: the same raise never applies later, however far the debt grows.
    expect(planRaises(spent.budget, [raise('b/01-a', 230, 238, 'unknown')], 5000, 'd').budget.maxKnown).toBe(230);
  });

  test('without git, a raise that is needed still applies the first time', () => {
    const plan = planRaises(budget(230), [raise('b/01-a', 230, 238, 'unknown')], 238, 'd');
    expect(plan.outcomes.map((o) => o.status)).toEqual(['applied']);
    expect(plan.budget.maxKnown).toBe(238);
  });

  test('a raise from an earlier round has no line of its own; the others say what happened', () => {
    const asked = raise('b/01-a', 230, 238);
    expect(describeRaise({ status: 'earlier', raise: asked }, 230, true)).toBeNull();
    expect(describeRaise({ status: 'not-needed', raise: asked, spent: false }, 230, true)).toContain(
      'it still counts until it is committed',
    );
    expect(describeRaise({ status: 'not-needed', raise: asked, spent: true }, 230, true)).toContain(
      'this raise is used up now and it does not count later',
    );
    expect(describeRaise({ status: 'not-needed', raise: asked, spent: true }, 230, false)).toContain(
      '`novadev sync` marks this raise used up',
    );
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

  test('reads a command, a timeout, a page, and a budget with its ledger', () => {
    expect(
      config({
        metrics: ' bun scripts/metrics.ts ',
        metricsTimeoutSeconds: 90,
        metricsWikiPage: 'budgets.md',
        debtBudget: { maxKnown: 238, raises: [{ by: 'b/01-a', from: 230, to: 300, applied: 238, on: '2026-10-01' }] },
      }),
    ).toEqual({
      command: 'bun scripts/metrics.ts',
      timeoutSeconds: 90,
      wikiPage: 'budgets.md',
      budget: { maxKnown: 238, raises: [{ by: 'b/01-a', from: 230, to: 300, applied: 238, on: '2026-10-01' }] },
      problems: [],
    });
    expect(config({ metricsWikiPage: false }).wikiPage).toBeNull();
  });

  test('a wrong type is a problem, and that setting is treated as off', () => {
    const bad = config({
      metrics: 42,
      metricsTimeoutSeconds: 0,
      metricsWikiPage: 'index.md',
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
    const badApplied = { by: 'x', from: 1, to: 2, applied: 'two', on: '2026-10-01' };
    expect(config({ debtBudget: { maxKnown: 1, raises: [badApplied] } }).problems[0]).toContain('raises[0]');
  });

  test('a command is printed on one line, whatever it holds', () => {
    expect(displayCommand('cat x\u0000\nrm y')).toBe('cat x\\u0000\\u000arm y');
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

  test('a name or a path cannot break the table or the page around it', () => {
    const text = renderBudgetsBlock(
      {
        updated: '',
        hubs: [
          { name: 'a*b*c [x](y) <b> ~s~ `q`', measure: 2, over: ['l|oc'], path: 'src/`odd`/p|q' },
          { name: 'B', measure: 1, over: [], path: '`edge' },
        ],
      },
      null,
    );
    expect(text).toContain('| a\\*b\\*c \\[x\\](y) \\<b> \\~s\\~ \\`q\\` | 2 | l\\|oc | ``src/`odd`/p\\|q`` |');
    expect(text).toContain('| B | 1 | — | `` `edge `` |');
    const rows = text.split('\n').filter((line) => line.startsWith('| '));
    expect(rows).toHaveLength(3);
  });
});
