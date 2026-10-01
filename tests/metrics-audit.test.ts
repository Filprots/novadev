// `auditMetrics`: what can be judged from the files alone — the settings, the stored snapshot,
// raises in records, and the wiki budgets block. Shared by `novadev sync` and `novadev doctor`.
import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { collectRaises } from '../src/debt-budget.ts';
import { auditMetrics } from '../src/metrics-audit.ts';
import { completed, project, read, todo, write } from './helpers.ts';

const SNAPSHOT = JSON.stringify({
  updated: '2026-10-01',
  debt: { known: 230, new: 0 },
  hubs: [{ name: 'Workbench', measure: 11019, over: ['loc'] }],
});
const PAGE = '.novadev/wiki/architecture.md';
const BEGIN = '<!-- novadev:budgets:begin -->';
const END = '<!-- novadev:budgets:end -->';

function withSnapshot(manifest: Record<string, unknown> = {}): string {
  const root = project({ metrics: 'cat metrics-out.json', ...manifest });
  write(root, '.novadev/metrics/latest.json', SNAPSHOT);
  return root;
}

/** Apply the block fix the way sync does, and return the page. */
function applyFixes(root: string): string {
  const { fixes } = auditMetrics(root);
  for (const fix of fixes) write(root, fix.path.slice(root.length + 1), fix.next);
  return read(root, PAGE);
}

describe('the budgets block in the wiki', () => {
  test('is appended once as a "## Budgets" section, then left alone while it is current', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 230 } });
    const first = auditMetrics(root).fixes;
    expect(first.map((f) => f.label)).toEqual(['wiki/architecture.md: budgets block missing']);
    const page = applyFixes(root);
    expect(page.startsWith('---\nupdated: 2026-10-01\n---\n\n# architecture.md\n\nHand-written text.\n\n## Budgets\n')).toBe(true);
    expect(page).toContain(BEGIN);
    expect(page).toContain('**Known debt:** 230 (budget 230) · **new:** 0 · as of 2026-10-01');
    expect(page).toContain('| Workbench | 11,019 | loc |');
    expect(auditMetrics(root).fixes).toEqual([]);
    expect(page.match(/novadev:budgets:begin/g)).toHaveLength(1);
  });

  test('is rewritten in place — a block moved into the middle of the page stays there', () => {
    const root = withSnapshot();
    write(root, PAGE, `# Architecture\n\nIntro.\n\n${BEGIN}\nold numbers\n${END}\n\n## After\n\nKept.\n`);
    expect(auditMetrics(root).fixes.map((f) => f.label)).toEqual(['wiki/architecture.md: budgets block out of date']);
    const page = applyFixes(root);
    expect(page).toStartWith(`# Architecture\n\nIntro.\n\n${BEGIN}\n<!-- generated`);
    expect(page).toEndWith(`${END}\n\n## After\n\nKept.\n`);
    expect(page).not.toContain('old numbers');
    expect(page).not.toContain('## Budgets');
  });

  test('a marker quoted above the real block never takes the text in between with it', () => {
    const root = withSnapshot();
    const head = `# Architecture\n\nSync rewrites what follows \`${BEGIN}\`.\n\n## Components\n\nHand-written text that must survive.\n\n## Budgets\n\n`;
    write(root, PAGE, `${head}${BEGIN}\nold\n${END}\n`);
    const page = applyFixes(root);
    expect(page).toStartWith(head);
    expect(page).not.toContain('\nold\n');
    expect(page.match(/novadev:budgets:begin/g)).toHaveLength(2);
  });

  test('markers quoted in a sentence, or shown in a fenced example, are not the block', () => {
    const sentence = `It sits between \`${BEGIN}\` and \`${END}\`.`;
    const example = `\`\`\`markdown\n${BEGIN}\n(example rows)\n${END}\n\`\`\``;
    for (const text of [sentence, example, `    ${BEGIN}\n    (indented code)\n    ${END}`]) {
      const root = withSnapshot();
      write(root, PAGE, `# Architecture\n\n${text}\n`);
      const page = applyFixes(root);
      expect(page).toStartWith(`# Architecture\n\n${text}\n\n## Budgets\n\n${BEGIN}\n<!-- generated`);
      expect(auditMetrics(root).fixes).toEqual([]);
      expect(applyFixes(root)).toBe(page);
    }
  });

  test('keeps a CRLF page in CRLF, and an up-to-date CRLF page is not "out of date"', () => {
    const root = withSnapshot();
    write(root, PAGE, '# Architecture\r\n\r\nText.\r\n');
    const page = applyFixes(root);
    expect(page).toContain('## Budgets\r\n');
    expect(page.replace(/\r\n/g, '')).not.toContain('\n');
    expect(auditMetrics(root).fixes).toEqual([]);
  });

  test('an empty page gets the section without blank lines above it', () => {
    const root = withSnapshot();
    write(root, PAGE, '');
    expect(applyFixes(root)).toStartWith(`## Budgets\n\n${BEGIN}\n`);
  });

  test('says so when the snapshot is gone but the block is still there', () => {
    const root = project();
    write(root, PAGE, `# A\n\n${BEGIN}\nold\n${END}\n`);
    expect(applyFixes(root)).toContain('_No metrics snapshot is stored');
  });

  test('is left alone while the snapshot cannot be read', () => {
    const root = project({ metrics: 'cat metrics-out.json' });
    write(root, PAGE, `# A\n\n${BEGIN}\nthe last good numbers\n${END}\n`);
    write(root, '.novadev/metrics/latest.json', '{\n<<<<<<< HEAD\n}');
    expect(auditMetrics(root).fixes).toEqual([]);
  });

  test('is not added to a page when there is no snapshot', () => {
    const root = project({ metrics: 'cat metrics-out.json' });
    expect(auditMetrics(root).fixes).toEqual([]);
  });

  test('broken markers are a problem and the page is never touched', () => {
    const broken = [
      `# A\n\n${BEGIN}\nhand-written\n`,
      `# A\n\n${END}\nhand-written\n${BEGIN}\n`,
      `# A\n\n${BEGIN}\nmine\n${BEGIN}\nold\n${END}\n`,
    ];
    for (const text of broken) {
      const root = withSnapshot();
      write(root, PAGE, text);
      const audit = auditMetrics(root);
      expect(audit.fixes).toEqual([]);
      expect(audit.problems).toEqual([expect.stringContaining('budgets block markers are broken')]);
    }
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

  test('a view from sync is what the block is judged against, not the files', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 230 } });
    applyFixes(root);
    const fresh = { updated: '2026-10-02', debt: { known: 228 }, hubs: [] };
    const audit = auditMetrics(root, { snapshot: { state: 'ok', snapshot: fresh }, budget: { maxKnown: 230, raises: [] } });
    expect(audit.fixes).toHaveLength(1);
    expect(audit.fixes[0]!.next).toContain('**Known debt:** 228 (budget 230) · as of 2026-10-02');
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

  test('an unreadable snapshot is a problem for doctor, with advice that works when the command cannot run', () => {
    const root = project({ metrics: 'cat metrics-out.json' });
    write(root, '.novadev/metrics/latest.json', '{\n<<<<<<< HEAD\n  "hubs": []\n=======\n>>>>>>> other\n}\n');
    expect(auditMetrics(root).problems).toEqual([
      expect.stringContaining('metrics/latest.json: not valid JSON — run `novadev sync` to write it again; if it holds merge-conflict markers'),
    ]);
    // sync passes its own view and says it as a NEXT ACTION instead.
    expect(auditMetrics(root, { snapshot: { state: 'invalid', error: 'not valid JSON' }, budget: null }).problems).toEqual([]);
  });

  test('a file where the metrics folder belongs is a problem, not a crash', () => {
    const root = project({ metrics: 'cat metrics-out.json' });
    write(root, '.novadev/metrics', 'a file');
    expect(auditMetrics(root).problems).toEqual([
      'metrics: a file, not a folder — novadev keeps its metrics snapshot in a folder of that name; move the file away',
    ]);
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

  test('files novadev did not write in metrics/ are tolerated, and named — a README of the project\'s own too', () => {
    const root = withSnapshot();
    write(root, '.novadev/metrics/history.csv', 'a,b\n');
    write(root, '.novadev/metrics/old/x.json', '{}');
    write(root, '.novadev/metrics/README.md', '# metrics\n\n<!-- managed by `novadev deploy`. -->\n');
    const notes = auditMetrics(root).notes;
    expect(notes).toContain(
      'metrics/history.csv: not a novadev file (tolerated) — novadev keeps only latest.json here',
    );
    expect(notes).toContain('metrics/old/: not a novadev folder (tolerated)');
    expect(notes.join('\n')).not.toContain('README.md');

    write(root, '.novadev/metrics/README.md', '# Our weekly numbers\n');
    expect(auditMetrics(root).notes).toContain(
      'metrics/README.md: not a novadev file (tolerated) — novadev keeps only latest.json here',
    );
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
    expect(found.raises.map((r) => `${r.ref} ${r.file} ${r.from}→${r.to}`).sort()).toEqual([
      '2026-10-01_1/01-a ai_completed.md 230→238',
      '2026-10-01_1/02-b ai_progress.md 230→240',
      '2026-10-01_1/03-c ai_failed.md 230→241',
    ]);
  });

  test('a raise it cannot read is a problem naming the record; every other raise is a note', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 225 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', '\n## Debt\n**Raise:** 225 → 238\n') });
    todo(root, '2026-10-01_1/02-b', { 'ai_completed.md': completed('02-b', debt.replace('230 → 238', '225 → 300')) });
    todo(root, '2026-10-01_1/03-c', { 'ai_completed.md': completed('03-c', debt) });
    todo(root, '2026-10-01_1/04-d', { 'ai_completed.md': completed('04-d', debt.replace('230 → 238', '230 – 1 238')) });
    const audit = auditMetrics(root);
    expect(audit.problems).toEqual([
      '2026-10-01_1/01-a/ai_completed.md: "## Debt" raises the budget to 238 but gives no reason — write why the debt grew (the raise is not applied until then)',
      '2026-10-01_1/04-d/ai_completed.md: the "**Raise:**" line in "## Debt" must look like `**Raise:** 230 → 238` — the budget now, an arrow, then the new budget, in whole numbers',
    ]);
    expect(audit.notes).toContain(
      'debt budget: 2026-10-01_1/02-b raises it 225 → 230 (it asks for 300, above the measured debt — a raise stops there) — `novadev sync` writes that to novadev.json',
    );
    expect(audit.notes).toContain(
      'debt budget: 2026-10-01_1/03-c raises it from 230, but the budget is 225 — not applied; if it is still needed, make it "**Raise:** 225 → <the new budget>"',
    );
  });

  test('the over-budget note counts a raise sync has not written yet', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 200 } });
    expect(auditMetrics(root).notes.join('\n')).toContain('over the budget 200');
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', debt.replace('230 → 238', '200 → 230')) });
    expect(auditMetrics(root).notes.join('\n')).not.toContain('over the budget');
  });

  test('a raise already in the ledger is neither pending nor counted again', () => {
    const root = withSnapshot({
      debtBudget: { maxKnown: 238, raises: [{ by: '2026-10-01_1/01-a', from: 230, to: 238, on: '2026-10-01' }] },
    });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', debt) });
    expect(auditMetrics(root).notes.join('\n')).not.toContain('2026-10-01_1/01-a');
  });

  test('settings are untouched by an audit', () => {
    const root = withSnapshot({ debtBudget: { maxKnown: 200 } });
    todo(root, '2026-10-01_1/01-a', { 'ai_completed.md': completed('01-a', debt.replace('230 → 238', '200 → 230')) });
    const before = read(root, '.novadev/novadev.json');
    auditMetrics(root);
    expect(read(root, '.novadev/novadev.json')).toBe(before);
  });
});
