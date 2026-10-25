// The documentation agents in OTHER projects read must stay in step with the code: every setting
// the code reads is documented, the examples parse with the real parsers, and the sample output is
// what the CLI really prints.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debtRaiseIn } from '../src/debt-budget.ts';
import { parseHubsSetting } from '../src/hubs.ts';
import { parseMetricsOutput } from '../src/metrics.ts';
import { WIKI_PAGES, auditKnowledge, parseKnowledgeSettings } from '../src/knowledge.ts';
import { parseEvents } from '../src/knowledge-log.ts';
import { readFrontmatterText } from '../src/okf.ts';
import { placementState } from '../src/placement.ts';
import {
  REPO,
  STAMP,
  cleanEnv,
  commitAll,
  completed,
  exists,
  feature,
  git,
  metricsOutput,
  metricsProject,
  project,
  read,
  run,
  setManifest,
  tempDir,
  todo,
  write,
} from './helpers.ts';

const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
const playbook = readFileSync(join(REPO, 'templates/skills/novadev-work.md'), 'utf8');
const folderReadme = readFileSync(join(REPO, 'templates/readmes/metrics.md'), 'utf8');
const rootReadme = readFileSync(join(REPO, 'templates/readmes/root.md'), 'utf8');
const todosReadme = readFileSync(join(REPO, 'templates/readmes/todos.md'), 'utf8');

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
    // The command's output names each hub's "measure"; the novadev.json examples do not.
    const examples = fences(readme, 'json').filter((body) => body.includes('"measure"'));
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

describe('the README on placement', () => {
  test('documents both settings, the section, the check and its limits', () => {
    for (const text of [
      '"hubs"',
      '`placementSince`',
      '## Placement',
      '"nothing new placed"',
      'A record\nchanged a hub when a commit on its `**Commits:**` line changed a file inside a hub path',
      'A move counts its old path and its new path',
      'first parent',
      'Archived records are not checked',
      '`fetch-depth: 0`',
      '0.11.0 adds two more',
    ]) {
      expect(readme).toContain(text);
    }
  });

  test('its "## Placement" example is a written section, and its "hubs" example is a valid list', () => {
    const example = fences(readme, 'markdown').find((body) => body.includes('## Placement'));
    expect(example).toBeDefined();
    expect(placementState(example!)).toBe('written');
    const hubs = fences(readme, 'json').find((body) => body.trimStart().startsWith('"hubs"'));
    expect(hubs).toBeDefined();
    const parsed = parseHubsSetting(JSON.parse(`{${hubs!}}`).hubs);
    expect(parsed).toEqual({ ok: true, value: ['src/editor/workbench/', 'src/editor/stage3d.ts'] });
  });
});

describe('the README on features --hubs', () => {
  test('its sample output is what the command prints, line for line', () => {
    const sample = fences(readme, '').find((body) => body.startsWith('$ novadev features --hubs'));
    expect(sample).toBeDefined();
    const expected = sample!.trimEnd().split('\n').slice(1); // without the "$ novadev features --hubs" prompt

    // The registry the sample shows: two hubs from the metrics snapshot, five features.
    const root = metricsProject({
      hubs: [
        { name: 'Workbench', measure: 11019, path: 'src/editor/workbench/' },
        { name: 'Stage3D', measure: 3304, path: 'src/editor/stage3d.ts' },
      ],
    });
    feature(root, 'FEAT-0003', 'copy-and-paste', { title: 'Copy and paste', touches: 'src/editor/workbench/, src/clipboard/' });
    feature(root, 'FEAT-0007', 'selection-filter', { title: 'Selection filter', status: 'in-progress', touches: 'src/editor/workbench/selection.ts' });
    feature(root, 'FEAT-0011', 'undo-history', { title: 'Undo history', touches: 'src/editor/, src/history/' });
    feature(root, 'FEAT-0012', 'camera-controls', { title: 'Camera controls', touches: 'src/editor/stage3d.ts, src/camera/' });
    feature(root, 'FEAT-0014', 'export', { title: 'Export', touches: 'src/export/' });
    run(root, 'sync');
    const printed = run(root, 'features', '--hubs');
    expect(printed.code).toBe(0);
    expect(printed.stdout.trimEnd().split('\n')).toEqual(expected);
  });

  test('names the command where features are searched, and says what it reads and what the marker means', () => {
    const prose = readme.replace(/\s+/g, ' '); // the checks below do not depend on where lines break
    expect(readme).toContain('novadev features --hubs               # which features lean on each hub');
    for (const text of [
      '`novadev features --hubs` lists the features that lean on each hub (see *Placement*).',
      'the same matching as `--touching`',
      'A feature whose every path is on a hub is marked "only hub paths": it has no folder of its own.',
      'listed only because one of its paths holds the hub (a folder above it) says so',
      'A feature leaves a hub\'s list once no path in its `touches:` is in the hub or holds it.',
      '`--touching <hub path>` shows that one hub',
      'It never runs the metrics command.',
      'With no hub paths, it says how to set them and exits with 1.',
    ]) {
      expect(prose).toContain(text);
    }
  });
});

describe('the templates', () => {
  test('the PLAN phase asks whether the todo touches a hub, before any code is written', () => {
    const plan = playbook.split('## 2 · PLAN')[1]!.split('## 3 · WORK')[0]!;
    expect(plan).toContain('**Does this todo touch a hub**');
    expect(plan).toContain('name the smaller unit that will own the change BEFORE you write code');
    expect(plan).toContain('`hubs` in\n`novadev.json`');
  });

  test('the record template has a Placement section — empty until it is filled in — and phase 4 says when it is checked', () => {
    const record = playbook.split('## 4 · RECORD')[1]!.split('## 5 · VERIFY')[0]!;
    const template = fences(record, 'markdown').find((body) => body.startsWith('# ai_completed'));
    expect(template).toBeDefined();
    expect(template!.indexOf('## Placement')).toBeGreaterThan(template!.indexOf('## What I did'));
    expect(template!.indexOf('## Placement')).toBeLessThan(template!.indexOf('## Verification'));
    expect(placementState(template!)).toBe('empty');
    expect(record).toContain('**Every record has a `## Placement` section.**');
    expect(record).toContain('"nothing new placed"');
    expect(record).toContain('`novadev sync --check` fails');
  });

  test('the playbook points at features --hubs where hubs meet the registry: the PLAN pre-flight and REGISTER', () => {
    const plan = playbook.split('## 2 · PLAN')[1]!.split('## 3 · WORK')[0]!;
    expect(plan).toContain('| Hub | `novadev features --hubs` | the features already on a hub you will change |');
    const register = playbook.split('## 7 · REGISTER')[1]!.split('## 8 · REMEMBER')[0]!;
    expect(register).toContain('**Features on a hub.** `novadev features --hubs` lists, for each hub, the features whose');
    expect(register).toContain('A feature marked "only hub paths" has no folder of its own.');
    expect(register).toContain('add the new path to its `touches:`, and remove the\n  hub path once none of its code is left there');
  });

  test('the README, the metrics folder README and the CLI help name features --hubs', () => {
    expect(readme).toContain('novadev features --hubs               # which features lean on each hub');
    expect(folderReadme).toContain('`novadev features --hubs` lists the features whose\n`touches:` name it');
    expect(run(tempDir(), 'help').stdout).toContain('--hubs lists the features on each hub');
  });

  test('the folder READMEs mention the section and what drives the check', () => {
    expect(todosReadme).toContain('`## Placement`');
    expect(folderReadme).toContain('placement check');
    expect(folderReadme).toContain('`"hubs"`');
  });

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

  test('the playbook defines the words it uses for metrics and placement', () => {
    const vocabulary = playbook.split('## Vocabulary')[1]!.split('\n---')[0]!;
    for (const term of ['**Snapshot**', '**Known debt**', '**Hub**', '**Debt budget**', '**Placement**']) {
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

describe('the knowledge bundle in the docs', () => {
  const okf = 'https://github.com/GoogleCloudPlatform/open-knowledge-format';

  test('the README explains the bundle, names the spec, and its examples are what the code accepts', () => {
    expect(readme).toContain('## Knowledge — an Open Knowledge Format bundle');
    expect(readme).toContain(okf);
    for (const text of ['`agent/unrecorded`', '"reviewDays"', '`human:filipp-protsenko`', '**Initialization**', 'novadev knowledge log events.json']) {
      expect(readme).toContain(text);
    }
    // The concept example parses, and passes novadev's profile once written into a bundle.
    const concept = fences(readme, 'markdown').find((body) => body.includes('type: Gotcha'))!;
    const read = readFrontmatterText(concept);
    expect(read.state).toBe('ok');
    expect(read.state === 'ok' && read.data).toMatchObject({ type: 'Gotcha', tags: ['testing', 'bun'] });
    // The payload example is what `novadev knowledge log` reads.
    const payload = fences(readme, 'json').find((body) => body.includes('"events"'))!;
    const root = project();
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Ada Lovelace');
    expect(() => parseEvents(root, join(root, '.novadev'), JSON.parse(payload))).not.toThrow();
  });

  test('the playbook teaches the bundle: the map first, recording every change, the events, trust and sources', () => {
    expect(playbook).toContain('## The knowledge bundle — Open Knowledge Format');
    expect(playbook).toContain('### Recording a change');
    expect(playbook).toContain('read `knowledge/index.md`');
    expect(playbook).toContain(okf);
    for (const event of ['`create`', '`update`', '`verify`', '`deprecate`', '`remove`']) expect(playbook).toContain(`| ${event} |`);
    for (const resource of ['`todo:<batch>/<todo>`', '`commit:<hash>`', '`repo:<path>`']) expect(playbook).toContain(resource);
    expect(playbook).toContain('never record a person as the actor of anything they did not do or\n  confirm in this conversation');
    // Its payload example is valid for the real parser.
    const example = fences(playbook, 'sh').find((body) => body.includes('"events"'))!;
    const json = example.slice(example.indexOf('{ "events"'), example.indexOf('\nJSON'));
    const root = project();
    expect(() => parseEvents(root, join(root, '.novadev'), JSON.parse(json))).not.toThrow();
    // Its memory and wiki templates are concepts of the right types.
    const memory = fences(playbook, 'markdown').find((body) => body.includes('type: Gotcha'))!;
    expect(readFrontmatterText(memory).state).toBe('ok');
    const page = fences(playbook, 'markdown').find((body) => body.includes('type: Wiki Page'))!;
    expect(readFrontmatterText(page).state).toBe('ok');
  });

  test('the playbook names every wiki page the code requires, and the messages it is pointed at exist', () => {
    for (const page of WIKI_PAGES) expect(playbook).toContain(`| \`${page.file}\` |`);
    expect(playbook).toContain('**Building the wiki**');
    expect(playbook).toContain('*Recording a change*');
  });

  test('the companion playbooks keep their hands off the bundle', () => {
    for (const file of ['novadev-file-a-todo.md', 'novadev-what-to-test.md', 'novadev-test-review.md', 'novadev-pause.md']) {
      expect(readFileSync(join(REPO, 'templates/skills', file), 'utf8')).toContain('Never edit `.novadev/knowledge/`');
    }
    expect(readFileSync(join(REPO, 'templates/skills/novadev-file-a-todo.md'), 'utf8')).toContain('**A standing rule is knowledge, not only a todo.**');
  });

  test('the root folder README describes the bundle, and deploy writes no README inside it', () => {
    expect(rootReadme).toContain('| `knowledge/` |');
    expect(rootReadme).toContain('No README lives inside it');
    const root = tempDir();
    run(root, 'deploy');
    expect(exists(root, '.novadev/knowledge/README.md')).toBe(false);
  });

  test('the files deploy writes for agents send them to the knowledge map first', () => {
    const root = tempDir();
    run(root, 'deploy');
    for (const file of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/novadev.mdc']) {
      expect(read(root, file)).toContain('.novadev/knowledge/index.md');
      expect(read(root, file)).toContain('novadev knowledge log');
    }
    expect(read(root, '.claude/skills/novadev-work/SKILL.md')).toContain('Open Knowledge Format');
  });

  test('the CLI help names the knowledge command', () => {
    const help = run(tempDir(), 'help').stdout;
    expect(help).toContain('novadev knowledge [words]');
    expect(help).toContain('"log <payload.json>" records changes');
  });
});

describe('the knowledge settings and source drift in the docs (0.13.0)', () => {
  /** The `"knowledge": { … }` examples of a text, as novadev.json would hold them. */
  const knowledgeExamples = (text: string) =>
    fences(text, 'json')
      .filter((body) => body.trimStart().startsWith('"knowledge"'))
      .map((body) => JSON.parse(`{${body}}`).knowledge as unknown);

  test('the README documents every key, and each of its "knowledge" examples is what the parser accepts', () => {
    for (const text of ['"reviewDays"', '"*"', '"folders"', '`novadev knowledge --drifted`', '**Code that moved on.**', '**Folders the project adds.**', '0.13.0 changes no layout']) {
      expect(readme).toContain(text);
    }
    const examples = knowledgeExamples(readme);
    expect(examples).toHaveLength(2);
    for (const example of examples) expect(parseKnowledgeSettings(example)).toMatchObject({ ok: true });
    // Pasted over a project's "knowledge", an example without "reviewDays" would turn the review dates off.
    for (const example of examples) expect(Object.keys(example as object)).toContain('reviewDays');
  });

  test('the README says what commit dates mean for drift, and where the settings stop', () => {
    const prose = readme.replace(/\s+/g, ' ');
    for (const text of [
      'Only the first-parent line counts: a merge is dated the day it was made',
      'A fast-forward pull keeps the dates the commits were made on',
      'A concept that cites code not committed yet is checked again once that code is committed on a later day',
      'A folder that holds only other repositories (`repo:repos`) never drifts',
      'a path inside `.novadev/` is never asked about',
      'Days are whole numbers, 1 to 36500.',
      'a folder named like a whole number (`2026`) comes before them all, in number order',
      "(novadev's own three may wait for their first concept)",
      'A mistake in `"folders"` never stops it.',
    ]) {
      expect(prose).toContain(text);
    }
  });

  test('the README\'s sample map line is what sync writes', () => {
    const prose = readme.replace(/\s+/g, ' ');
    const line = /The map then reads `([^`]+)`/.exec(prose)?.[1];
    expect(line).toBe('* [planner](planner/index.md) - What a planner user can do, stage by stage. (12 concepts)');
    const root = project({ knowledge: { folders: { planner: 'What a planner user can do, stage by stage.' } } });
    for (let i = 1; i <= 12; i++) {
      write(root, `.novadev/knowledge/planner/stage-${i}.md`, `---\ntype: Guide\ntitle: Stage ${i}\ndescription: Stage ${i}.\ngenerated: ${STAMP}\n---\n`);
    }
    expect(run(root, 'sync').code).toBe(0);
    expect(read(root, '.novadev/knowledge/index.md')).toContain(`${line}\n`);
  });

  test('the README\'s sample drift action is what sync lists', () => {
    const quote = /NEXT ACTION: "([^"]+)"/.exec(readme.replace(/\s+/g, ' '))?.[1];
    expect(quote).toBe('its source repo:src/auth.ts changed on 2026-10-12, after the concept was last checked (2026-10-01)');
    const root = project();
    write(root, 'src/auth.ts', 'export {};\n');
    git(root, 'init', '-q');
    for (const args of [['add', '-A'], ['commit', '-q', '--no-verify', '-m', 'auth']]) {
      const date = '2026-10-12T10:00:00+02:00';
      const result = Bun.spawnSync({
        cmd: ['git', '-c', 'user.email=novadev@example.invalid', '-c', 'user.name=novadev tests', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
        cwd: root,
        env: { ...cleanEnv(), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
      expect(result.exitCode).toBe(0);
    }
    write(root, '.novadev/knowledge/memories/auth.md', `---\ntype: Gotcha\ntitle: Auth\ndescription: When logging in.\ngenerated: ${STAMP}\nsources:\n  - resource: repo:src/auth.ts\n---\n`);
    expect(auditKnowledge(root, join(root, '.novadev')).actions.some((action) => action.startsWith(`knowledge/memories/auth.md: ${quote} — `))).toBe(true);
  });

  test('the playbook teaches it: the settings in Trust and freshness, drift, a folder you add, the word "Drifted"', () => {
    const trust = playbook.split('### Trust and freshness')[1]!.split('### Sources and links')[0]!;
    for (const text of ['"*"', '`null`', '**When the code moved on.**', '`novadev knowledge --drifted`', '**A folder you add.**', '`"folders"`']) {
      expect(trust).toContain(text);
    }
    const examples = knowledgeExamples(trust);
    expect(examples).toHaveLength(1);
    expect(parseKnowledgeSettings(examples[0])).toMatchObject({ ok: true });
    expect(playbook.split('## Vocabulary')[1]!.split('\n---')[0]!).toContain('**Drifted**');
    expect(playbook).toContain('`novadev knowledge --stale`, `novadev knowledge --drifted` and');
    const prose = trust.replace(/\s+/g, ' ');
    expect(prose).toContain('The default `"reviewDays"` names only the three folders: name yours there too, or add `"*"`');
    expect(prose).toContain('Code you leave uncommitted is different: once it is committed on a later day, the concept shows as drifted once');
  });

  test('the CLI help and the folder README name them', () => {
    expect(run(tempDir(), 'help').stdout.replace(/\s+/g, ' ')).toContain('--drifted what cites code (repo: sources) that changed after its last check');
    expect(rootReadme).toContain('(`"folders"`) and its review days (`"reviewDays"`)');
    // Every example the playbook gives is what a project may really write.
    const root = project();
    setManifest(root, { knowledge: knowledgeExamples(playbook)[0] });
    expect(auditKnowledge(root, join(root, '.novadev')).problems.filter((p) => p.startsWith('novadev.json'))).toEqual([]);
  });
});
