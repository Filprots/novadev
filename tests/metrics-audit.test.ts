// `auditMetrics`: what can be judged from the files alone — the settings, the stored snapshot,
// raises in records, and the wiki budgets block. Shared by `novadev sync` and `novadev doctor`.
import { describe, expect, test } from 'bun:test';
import { collectRaises } from '../src/debt-budget.ts';
import { auditMetrics } from '../src/metrics-audit.ts';
import { completed, project, read, todo, write } from './helpers.ts';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const SNAPSHOT = JSON.stringify({
  updated: '2026-10-01',
  debt: { known: 230, new: 0 },
  hubs: [{ name: 'Workbench', measure: 11019, over: ['loc'] }],
});

function withSnapshot(manifest: Record<string, unknown> = {}): string {
  const root = project({ metrics: 'cat metrics-out.json', ...manifest });
  write(root, '.novadev/metrics/latest.json', SNAPSHOT);
  return root;
}

/** Apply the block fix the way sync does, and return the page. */
function applyFixes(root: string): string {
  const { fixes } = auditMetrics(root);
  for (const fix of fixes) write(root, fix.path.slice(root.length + 1), fix.next);
  return read(root, '.novadev/wiki/architecture.md');
}

describe('the budgets block in the wiki', () => {
  test('is appended once as a "## Budgets" section, then left alone while it is current', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 230 } });
    const first = auditMetrics(root).fixes;
    expect(first.map((f) => f.label)).toEqual(['wiki/architecture.md: budgets block missing']);
    const page = applyFixes(root);
    expect(page.startsWith('---\nupdated: 2026-10-01\n---\n\n# architecture.md\n\nHand-written text.\n\n## Budgets\n')).toBe(true);
    expect(page).toContain('<!-- novadev:budgets:begin -->');
    expect(page).toContain('**Known debt:** 230 (budget 230) · **new:** 0 · as of 2026-10-01');
    expect(page).toContain('| Workbench | 11,019 | loc |');
    expect(auditMetrics(root).fixes).toEqual([]);
    expect(page.match(/novadev:budgets:begin/g)).toHaveLength(1);
  });

  test('is rewritten in place — a block moved into the middle of the page stays there', () => {
    const root = withSnapshot();
    write(
      root,
      '.novadev/wiki/architecture.md',
      '# Architecture\n\nIntro.\n\n<!-- novadev:budgets:begin -->\nold numbers\n<!-- novadev:budgets:end -->\n\n## After\n\nKept.\n',
    );
    expect(auditMetrics(root).fixes.map((f) => f.label)).toEqual(['wiki/architecture.md: budgets block out of date']);
    const page = applyFixes(root);
    expect(page).toStartWith('# Architecture\n\nIntro.\n\n<!-- novadev:budgets:begin -->\n<!-- generated');
    expect(page).toEndWith('<!-- novadev:budgets:end -->\n\n## After\n\nKept.\n');
    expect(page).not.toContain('old numbers');
    expect(page).not.toContain('## Budgets');
  });

  test('keeps a CRLF page in CRLF, and an up-to-date CRLF page is not "out of date"', () => {
    const root = withSnapshot();
    write(root, '.novadev/wiki/architecture.md', '# Architecture\r\n\r\nText.\r\n');
    const page = applyFixes(root);
    expect(page).toContain('## Budgets\r\n');
    expect(page.replace(/\r\n/g, '')).not.toContain('\n');
    expect(auditMetrics(root).fixes).toEqual([]);
  });

  test('says so when the snapshot is gone but the block is still there', () => {
    const root = project();
    write(
      root,
      '.novadev/wiki/architecture.md',
      '# A\n\n<!-- novadev:budgets:begin -->\nold\n<!-- novadev:budgets:end -->\n',
    );
    expect(applyFixes(root)).toContain('_No metrics snapshot is stored');
  });

  test('is not added to a page when there is no snapshot', () => {
    const root = project({ metrics: 'cat metrics-out.json' });
    expect(auditMetrics(root).fixes).toEqual([]);
  });

  test('broken markers are a problem and the page is never touched', () => {
    const root = withSnapshot();
    write(root, '.novadev/wiki/architecture.md', '# A\n\n<!-- novadev:budgets:begin -->\nhand-written\n');
    const audit = auditMetrics(root);
    expect(audit.fixes).toEqual([]);
    expect(audit.problems).toEqual([expect.stringContaining('budgets block markers are broken')]);
  });

  test('goes to the page named in "metricsWikiPage", or nowhere when it is false', () => {
    const custom = withSnapshot({ metricsWikiPage: 'budgets.md' });
    write(custom, '.novadev/wiki/budgets.md', '# Budgets page\n');
    expect(auditMetrics(custom).fixes.map((f) => f.label)).toEqual(['wiki/budgets.md: budgets block missing']);

    const missing = withSnapshot({ metricsWikiPage: 'nope.md' });
    const audit = auditMetrics(missing);
    expect(audit.fixes).toEqual([]);
    expect(audit.notes).toContain(
      'wiki/nope.md: missing, so the budgets block has nowhere to go — create the page, or set "metricsWikiPage"',
    );

    const off = withSnapshot({ metricsWikiPage: false });
    expect(auditMetrics(off).fixes).toEqual([]);
  });

  test('waits for the wiki to exist', () => {
    const root = withSnapshot();
    rmSync(join(root, '.novadev/wiki/INDEX.md'));
    expect(auditMetrics(root).fixes).toEqual([]);
  });
});

describe('problems and notes', () => {
  test('a healthy setup has nothing to say', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 230 } });
    applyFixes(root);
    expect(auditMetrics(root)).toEqual({ problems: [], notes: [], fixes: [] });
  });

  test('an unreadable novadev.json, bad settings and a malformed snapshot are problems', () => {
    const root = project();
    write(root, '.novadev/novadev.json', '{ "version": ');
    expect(auditMetrics(root).problems).toEqual([
      'novadev.json: not a valid JSON object — novadev cannot read its settings',
    ]);

    const bad = project({ metrics: ['cat'], debtBudget: { maxKnown: -1 } });
    write(bad, '.novadev/metrics/latest.json', '{"hubs": "many"}');
    const problems = auditMetrics(bad).problems.join('\n');
    expect(problems).toContain('"metrics" must be a shell command');
    expect(problems).toContain('"debtBudget.maxKnown" must be a whole number');
    expect(problems).toContain('metrics/latest.json: "hubs" must be a list');
  });

  test('says when the command, the snapshot and the budget do not line up', () => {
    const noSnapshot = project({ metrics: 'cat metrics-out.json' });
    expect(auditMetrics(noSnapshot).notes).toContain(
      'metrics: a command is set, but no snapshot is stored yet — run `novadev sync`',
    );

    const orphan = withSnapshot({ metrics: null, debtBudget: { maxKnown: 100 } });
    const notes = auditMetrics(orphan).notes.join('\n');
    expect(notes).toContain('sets no "metrics" command — the snapshot is no longer refreshed');
    expect(notes).toContain('debtBudget is set, but no "metrics" command measures the debt');
    expect(notes).toContain('known debt 230 in metrics/latest.json is over the budget 100');
  });

  test('files novadev did not write in metrics/ are tolerated, and named', () => {
    const root = withSnapshot();
    write(root, '.novadev/metrics/history.csv', 'a,b\n');
    write(root, '.novadev/metrics/old/x.json', '{}');
    write(root, '.novadev/metrics/README.md', '# metrics\n');
    const notes = auditMetrics(root).notes;
    expect(notes).toContain(
      'metrics/history.csv: not a novadev file (tolerated) — novadev keeps only latest.json here',
    );
    expect(notes).toContain('metrics/old/: not a novadev folder (tolerated)');
    expect(notes.join('\n')).not.toContain('README.md');
  });
});

describe('raises in records', () => {
  const debt = '\n## Debt\n**Raise:** 230 → 238\nThe registry adds eight findings; todo 19 removes them.\n';

  test('are found in the work records of todos/ — never in briefs, test gates, or the archive', () => {
    const root = project({ debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', debt) });
    todo(root, '2026-10-01_1/02-b', { 'ai_progress.md': `# ai_progress\n${debt.replace('238', '240')}` });
    todo(root, '2026-10-01_1/03-c', { 'ai_failed.md': `# ai_failed — deferred\n${debt.replace('238', '241')}` });
    write(root, '.novadev/archive/2026/todos/2026-09-01_1/01-old/ai_completed.md', completed('01-old', debt.replace('238', '235')));
    write(root, '.novadev/archive/2026/todos/2026-09-01_1/01-old/prompt.md', '# old\n');
    // A brief may quote anything; a gate is not a work record.
    todo(root, '2026-10-01_1/04-d', { 'notes.md': debt.replace('238', '999'), 'ai_needstest.md': debt.replace('238', '998') });

    const found = collectRaises(join(root, '.novadev'));
    expect(found.problems).toEqual([]);
    expect(found.raises.map((r) => `${r.ref} ${r.file} ${r.to}`).sort()).toEqual([
      '2026-10-01_1/01-a ai_completed.md 238',
      '2026-10-01_1/02-b ai_progress.md 240',
      '2026-10-01_1/03-c ai_failed.md 241',
    ]);
  });

  test('a raise without a reason is a problem naming the record; a pending raise is a note', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\n**Raise:** 230 → 238\n') });
    todo(root, '2026-10-01_1/02-b', { 'ai_completed.md': completed('02-b', debt.replace('238', '236')) });
    todo(root, '2026-10-01_1/03-c', { 'ai_completed.md': completed('03-c', debt.replace('238', '200')) });
    const audit = auditMetrics(root);
    expect(audit.problems).toEqual([
      '2026-10-01_1/01-a/ai_completed.md: "## Debt" raises the budget to 238 but gives no reason — write why the debt grew (the raise is not applied until then)',
    ]);
    expect(audit.notes).toContain(
      '2026-10-01_1/02-b: raises the debt budget to 236 — `novadev sync` writes it to novadev.json',
    );
    expect(audit.notes).toContain(
      '2026-10-01_1/03-c: asks for a debt budget of 200, which it already is or exceeds — `novadev sync` records it',
    );
  });

  test('the over-budget note counts a raise sync has not written yet', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 200 } });
    expect(auditMetrics(root).notes.join('\n')).toContain('over the budget 200');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', debt.replace('238', '230')) });
    expect(auditMetrics(root).notes.join('\n')).not.toContain('over the budget');
  });

  test('a raise already in the ledger is neither pending nor counted again', () => {
    const root = withSnapshot({
      debtBudget: { maxKnown: 238, raises: [{ by: '2026-10-01_1/01-a', from: 230, to: 238, on: '2026-10-01' }] },
    });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', debt) });
    expect(auditMetrics(root).notes.join('\n')).not.toContain('raises the debt budget');
  });

  test('settings are untouched by an audit', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 230 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', debt) });
    const before = read(root, '.novadev/novadev.json');
    auditMetrics(root);
    expect(read(root, '.novadev/novadev.json')).toBe(before);
  });
});
