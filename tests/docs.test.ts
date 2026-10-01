// The documentation agents in OTHER projects read must stay in step with the code: every setting
// the code reads is documented, the examples parse with the real parsers, and the sample output is
// what the CLI really prints.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debtRaiseIn } from '../src/debt-budget.ts';
import { parseMetricsOutput } from '../src/metrics.ts';
import { REPO, commitAll, completed, metricsOutput, metricsProject, read, run, tempDir, todo } from './helpers.ts';

const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
const playbook = readFileSync(join(REPO, 'templates/skills/novadev-work.md'), 'utf8');
const folderReadme = readFileSync(join(REPO, 'templates/readmes/metrics.md'), 'utf8');
const rootReadme = readFileSync(join(REPO, 'templates/readmes/root.md'), 'utf8');

/** The bodies of the fenced blocks in a markdown text whose info string is `lang` ('' = none). */
function fences(text: string, lang: string): string[] {
  const out: string[] = [];
  let open: { info: string; body: string[] } | null = null;
  for (const line of text.split('\n')) {
    const fence = /^```(.*)$/.exec(line);
    if (open === null) {
      if (fence) open = { info: fence[1]!.trim(), body: [] };
    } else if (fence && fence[1]!.trim() === '') {
      if (open.info === lang) out.push(open.body.join('\n') + '\n');
      open = null;
    } else {
      open.body.push(line);
    }
  }
  return out;
}

describe('the README', () => {
  test('documents every metrics setting the code reads', () => {
    for (const key of ['"metrics"', '"debtBudget"', 'maxKnown', 'debtBudget.raises', '"applied"', 'metricsWikiPage', 'metricsTimeoutSeconds']) {
      expect(readme).toContain(key);
    }
    expect(readme).toContain('<!-- novadev:budgets:begin -->');
    expect(readme).toContain('.novadev/metrics/latest.json');
  });

  test('its example command output is valid for the real parser', () => {
    const examples = fences(readme, 'json').filter((body) => body.includes('"hubs"'));
    expect(examples.length).toBeGreaterThan(0);
    for (const body of examples) expect(parseMetricsOutput(body).ok).toBe(true);
  });

  test('its "## Debt" example is a valid raise', () => {
    const example = fences(readme, 'markdown').find((body) => body.includes('## Debt'));
    expect(example).toBeDefined();
    expect(debtRaiseIn(example!)).toEqual({ from: 230, to: 238 });
  });

  test('its sample sync output is what sync prints, line for line and in order', () => {
    const sample = fences(readme, '').find((body) => body.includes('metrics: running'));
    expect(sample).toBeDefined();
    const expected = sample!.trimEnd().split('\n').slice(1); // without the "$ novadev sync" prompt

    // The scenario the sample shows: a committed round at 230, then the kit registry work.
    const root = metricsProject(
      {
        debt: { known: 230 },
        hubs: [
          { name: 'Workbench', measure: 11019, over: ['loc'] },
          { name: 'Stage3D', measure: 3304 },
        ],
      },
      { debtBudget: { maxKnown: 230 } },
    );
    run(root, 'sync');
    commitAll(root, 'before the round');
    metricsOutput(root, {
      debt: { known: 238 },
      hubs: [
        { name: 'Workbench', measure: 11140, over: ['loc'] },
        { name: 'Stage3D', measure: 3280 },
      ],
    });
    todo(root, '2026-10-01_1/01-kits', {
      'ai_completed.md': completed(
        '01-kits',
        '\n## Debt\n**Raise:** 230 → 238\nThe kit registry lives in the Workbench for now; todo 19 moves it out.\n',
      ),
    });
    const printed = run(root, 'sync')
      .stdout.replaceAll('`cat metrics-out.json`', '`bun scripts/novadev-metrics.ts`')
      .split('\n');
    const start = printed.indexOf(expected[0]!);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(printed.slice(start, start + expected.length)).toEqual(expected);
  });

  test('says that deploy waits for migrate-repo', () => {
    expect(readme).toContain('`novadev migrate-repo`, then `novadev deploy`');
  });

  test('states the rules the code enforces: rounds, one raise line, paths, fences', () => {
    expect(readme).toContain('**A raise counts only in the round it is written in.**');
    expect(readme).toContain('Without git, sync cannot');
    expect(readme).toContain('A record has at most one raise line');
    expect(readme).toContain('Without a `debtBudget`, a `## Debt` section is free text.');
    expect(readme).toContain('and so is a path with `..`');
    expect(readme).toContain('a code fence that\nis never closed');
    expect(readme).toContain('novadev waits 2 seconds, reads the output, and stops that process');
  });

  test('states the rules of the third review: the gate and the budget, raise lines, explanations, conflicts', () => {
    expect(readme).toContain('Until sync has\nwritten the raise, `sync --check` fails');
    expect(readme).toContain('A raise line the last commit already holds');
    expect(readme).toContain('A raise line in a quote (`> **Raise:** …`) is never\nread');
    expect(readme).toContain('a bare "None.", "No new debt." or "n/a" explains\nnothing');
    expect(readme).toContain('on a budget raise that plain `sync` has not written yet, on a\ndebt budget it cannot check');
    expect(readme).toContain('sync lists a NEXT ACTION to\nlower `maxKnown` to it');
    expect(readme).toContain('keep the higher `maxKnown` and the raises of both sides');
    expect(readme).toContain('`novadev deploy` and `novadev migrate-repo` refuse a `novadev.json` they\ncannot read');
  });
});

describe('the templates', () => {
  test('the playbook tells agents about the record section, the check and the snapshot', () => {
    expect(playbook).toContain('## Debt');
    expect(playbook).toContain('**Raise:**');
    expect(playbook).toContain('novadev sync --check');
    expect(playbook).toContain('metrics/latest.json');
    expect(playbook).toContain('novadev:budgets:');
    expect(playbook).toContain('Keep ONE raise line in a record');
    expect(playbook).toContain('A raise counts only in the round you write it in.');
    expect(playbook).toContain('Close every code fence on that page');
    expect(playbook).toContain('Run `novadev sync` before you commit');
    expect(playbook).toContain('"None." or "No new debt." is not a reason');
    expect(playbook).toContain('Known debt under the budget is a NEXT ACTION');
    expect(playbook).toContain('keep the\nhigher `maxKnown` and the raises of both sides');
  });

  test('the playbook defines the words it uses for metrics', () => {
    const vocabulary = playbook.split('## Vocabulary')[1]!.split('\n---')[0]!;
    for (const term of ['**Snapshot**', '**Known debt**', '**Hub**', '**Debt budget**']) {
      expect(vocabulary).toContain(term);
    }
  });

  test('the playbook\'s Debt template is NOT a raise until it is filled in', () => {
    const template = fences(playbook, 'markdown').find((body) => body.includes('**Raise:**'));
    expect(template).toBeDefined();
    expect(debtRaiseIn(template!)).toEqual({ error: expect.stringContaining('must look like `**Raise:** 230 → 238`') });
  });

  test('the metrics folder README shows a valid example, and the root README lists the folder', () => {
    const example = fences(folderReadme, 'json').find((body) => body.includes('"hubs"'));
    expect(parseMetricsOutput(example!).ok).toBe(true);
    expect(folderReadme).toContain('debtBudget');
    expect(folderReadme).toContain('counts only in the round it is written');
    expect(folderReadme).toContain('(no `..`)');
    expect(folderReadme).toContain('`novadev sync --check` fails until sync has written it');
    expect(rootReadme).toContain('`metrics/`');
  });

  test('the files deploy writes for agents mention the metrics step of sync', () => {
    const root = tempDir();
    run(root, 'deploy');
    for (const file of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/novadev.mdc']) {
      expect(read(root, file)).toContain("the project's metrics command");
    }
    expect(read(root, 'AGENTS.md')).toContain('novadev sync --check');
  });
});
