// The documentation agents in OTHER projects read must stay in step with the code: every setting
// the code reads is documented, and the examples parse with the real parsers.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debtRaiseIn } from '../src/debt-budget.ts';
import { parseMetricsOutput } from '../src/metrics.ts';
import { REPO } from './helpers.ts';

const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
const playbook = readFileSync(join(REPO, 'templates/skills/novadev-work.md'), 'utf8');
const folderReadme = readFileSync(join(REPO, 'templates/readmes/metrics.md'), 'utf8');
const rootReadme = readFileSync(join(REPO, 'templates/readmes/root.md'), 'utf8');

/** The bodies of the fenced blocks in a markdown text that start with `lang`. */
function fences(text: string, lang: string): string[] {
  const out: string[] = [];
  const re = new RegExp('^```' + lang + '\\n([\\s\\S]*?)^```', 'gm');
  for (const m of text.matchAll(re)) out.push(m[1]!);
  return out;
}

describe('the README', () => {
  test('documents every metrics setting the code reads', () => {
    for (const key of ['"metrics"', '"debtBudget"', 'maxKnown', 'debtBudget.raises', 'metricsWikiPage', 'metricsTimeoutSeconds']) {
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
});

describe('the templates', () => {
  test('the playbook tells agents about the record section, the check and the snapshot', () => {
    expect(playbook).toContain('## Debt');
    expect(playbook).toContain('**Raise:**');
    expect(playbook).toContain('novadev sync --check');
    expect(playbook).toContain('metrics/latest.json');
    expect(playbook).toContain('novadev:budgets:');
  });

  test('the playbook\'s Debt template is NOT a raise until it is filled in', () => {
    const template = fences(playbook, 'markdown').find((body) => body.includes('**Raise:**'));
    expect(template).toBeDefined();
    expect(debtRaiseIn(template!)).toEqual({ error: expect.stringContaining('needs the new budget') });
  });

  test('the metrics folder README shows a valid example, and the root README lists the folder', () => {
    const example = fences(folderReadme, 'json').find((body) => body.includes('"hubs"'));
    expect(parseMetricsOutput(example!).ok).toBe(true);
    expect(folderReadme).toContain('debtBudget');
    expect(rootReadme).toContain('`metrics/`');
  });
});
