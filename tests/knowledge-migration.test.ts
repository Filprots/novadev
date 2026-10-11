// The 0.11.0 → 0.12.0 migration (src/knowledge-migration.ts): wiki/, memories/ and features/ move into
// the knowledge bundle with Open Knowledge Format frontmatter, their old INDEX.md one-liners become
// descriptions, and every link keeps reaching what it reached.
import { describe, expect, test } from 'bun:test';
import { addDaysToTimestamp } from '../src/okf.ts';
import { exists, read, readJson, run, setManifest, tempDir, todo, write } from './helpers.ts';

const MANAGED = '<!-- managed by `novadev deploy`. -->';

/** A project exactly as novadev 0.11.0 left it. */
function legacy(): string {
  const root = tempDir();
  setManifest(root, { novadev: true, version: '0.11.0', metrics: null, debtBudget: null, hubs: null, placementSince: null }, true);
  write(
    root,
    '.novadev/wiki/INDEX.md',
    '---\nupdated: 2026-09-01\n---\n\n# Wiki index — load this first\n\nA demo.\n\n| Page | One-liner |\n|---|---|\n| [overview.md](overview.md) | What the demo is |\n| [stack.md](stack.md) | Bun, and why |\n| [architecture.md](architecture.md) | The parts |\n| [../features/INDEX.md](../features/INDEX.md) | What it has |\n',
  );
  write(
    root,
    '.novadev/wiki/overview.md',
    '---\nupdated: 2026-09-02\n---\n\n# Overview\n\nThe registry is [here](../features/INDEX.md), login is [FEAT-0001](../features/FEAT-0001-login/feature.md),\nthe brief is [there](../todos/2026-09-01_1/01-x/prompt.md), the code is [app](../../src/app.ts), a dead link stays [dead](../../nope.ts).\nAgents read `.novadev/wiki/stack.md` and `.novadev/features/INDEX.md` first.\n',
  );
  for (const page of ['stack', 'architecture', 'conventions', 'workflows', 'glossary']) {
    write(root, `.novadev/wiki/${page}.md`, `---\nupdated: 2026-09-03\n---\n\n# ${page.charAt(0).toUpperCase()}${page.slice(1)}\n\nText.\n`);
  }
  write(root, '.novadev/wiki/README.md', `# wiki — the project pre-context\n\n${MANAGED}\n`);
  write(root, '.novadev/memories/README.md', `# memories\n\n${MANAGED}\n`);
  write(
    root,
    '.novadev/memories/INDEX.md',
    '# Memories index\n\n- [Never A](never-a.md) — when doing A\n- [Trap B](trap-b.md) — when B: watch the C\n- [Odd C](odd-c.md) — when C\n',
  );
  write(root, '.novadev/memories/never-a.md', '---\ntitle: Never A — it breaks: everything\ncreated: 2026-09-01\nkind: guardrail\nverified: 2026-09-20\n---\nThe fact.\n');
  write(root, '.novadev/memories/trap-b.md', '---\ntitle: Trap B\ncreated: 2026-09-05\nkind: trap\ntags: testing, bun\n---\nThe trap.\n');
  write(root, '.novadev/memories/odd-c.md', '---\ntitle: Odd C\ncreated: 2026-09-06\nkind: pattern\n---\nThe pattern.\n');
  write(root, '.novadev/features/README.md', `# features\n\n${MANAGED}\n`);
  write(root, '.novadev/features/INDEX.md', '# Features index\n\n<!-- novadev:features-index:begin -->\n<!-- novadev:features-index:end -->\n');
  write(
    root,
    '.novadev/features/FEAT-0001-login/feature.md',
    '---\nid: FEAT-0001\ntitle: Login: magic links\nstatus: shipped\narea: auth\ncreated: 2026-09-01\nupdated: 2026-09-10\ntags: login, auth\ntouches: src/auth/, src/login.ts\ndepends-on:\nsupersedes:\nsuperseded-by:\nconflicts-with:\n---\n\n# FEAT-0001 — Login\n\n## What it does\n\nLog in with a link sent by mail. It expires.\n\n## How it works\n\nTokens.\n\n<!-- The work that built this feature and the human test rounds that verified it are\n     DERIVED, in work.md and tests.md beside this file.\n     Regenerate them with `novadev links --fix`. -->\n',
  );
  write(root, '.novadev/features/FEAT-0001-login/work.md', '# Work\n\n<!-- novadev:work:begin -->\nold\n<!-- novadev:work:end -->\n');
  write(root, 'src/app.ts', '');
  todo(root, '2026-09-01_1/01-x', {
    'ai_completed.md': '# ai_completed — 01-x\n\n**Date:** 2026-09-01\n**Feature:** FEAT-0001\n\n## What I did\nIt.\n',
  });
  return root;
}

const K = '.novadev/knowledge';

describe('0.11.0 → 0.12.0', () => {
  test('--dry-run says what it would do and changes nothing', () => {
    const root = legacy();
    const before = read(root, '.novadev/wiki/overview.md');
    const result = run(root, 'migrate-repo', '--dry-run');
    expect(result.stdout).toContain('would give 10 page(s), memories and features Open Knowledge Format frontmatter');
    expect(result.stdout).toContain('would move .novadev/wiki/ → .novadev/knowledge/wiki/');
    expect(result.stdout).toContain('would NOTE 1 file(s) still need a line the old files never had — `novadev sync` lists each one: memories/odd-c.md (type (its kind was "pattern"))');
    expect(read(root, '.novadev/wiki/overview.md')).toBe(before);
    expect(exists(root, K)).toBe(false);
  });

  test('moves the three folders into the bundle, drops the old indexes and novadev\'s READMEs, starts the log and the review policy', () => {
    const root = legacy();
    const result = run(root, 'migrate-repo', '--force');
    expect(result.code).toBe(0);
    for (const folder of ['wiki', 'memories', 'features']) {
      expect(exists(root, `.novadev/${folder}`)).toBe(false);
      expect(exists(root, `${K}/${folder}`)).toBe(true);
      expect(exists(root, `${K}/${folder}/INDEX.md`)).toBe(false);
      expect(exists(root, `${K}/${folder}/README.md`)).toBe(false);
    }
    expect(read(root, `${K}/log.md`)).toContain("* **Initialization**: novadev 0.12.0 made this folder the project's knowledge bundle (Open Knowledge Format 0.2)");
    expect(readJson(root, '.novadev/novadev.json')).toMatchObject({
      version: '0.12.0',
      knowledge: { reviewDays: { wiki: 90, memories: 180, features: 365 } },
    });
  });

  test('a wiki page: its type, its title, its INDEX one-liner as the description, stamped by an unrecorded agent on its own day', () => {
    const root = legacy();
    run(root, 'migrate-repo', '--force');
    const overview = read(root, `${K}/wiki/overview.md`);
    const at = '2026-09-02T00:00:00Z';
    expect(overview).toStartWith(
      `---\ntype: Wiki Page\ntitle: Overview\ndescription: What the demo is\ngenerated: { by: agent/unrecorded, at: ${at} }\nstale_after: ${addDaysToTimestamp(at, 90)}\n---\n\n# Overview\n`,
    );
    // A page the INDEX did not describe takes the playbook's line for it.
    expect(read(root, `${K}/wiki/glossary.md`)).toContain("description: The project's own terms an outsider would not know.");
  });

  test('every link keeps reaching what it reached; text naming the old folders is renamed', () => {
    const root = legacy();
    run(root, 'migrate-repo', '--force');
    const overview = read(root, `${K}/wiki/overview.md`);
    expect(overview).toContain('The registry is [here](../features/index.md), login is [FEAT-0001](../features/FEAT-0001-login/feature.md),');
    expect(overview).toContain('the brief is [there](../../todos/2026-09-01_1/01-x/prompt.md), the code is [app](../../../src/app.ts), a dead link stays [dead](../../nope.ts).');
    expect(overview).toContain('Agents read `.novadev/knowledge/wiki/stack.md` and `.novadev/knowledge/features/index.md` first.');
  });

  test('a memory: its kind becomes its type ("trap" is a Gotcha), its verified day an event; any other kind is left for an agent to choose', () => {
    const root = legacy();
    run(root, 'migrate-repo', '--force');
    expect(read(root, `${K}/memories/never-a.md`)).toStartWith(
      '---\ntype: Guardrail\ntitle: "Never A — it breaks: everything"\ndescription: when doing A\ncreated: 2026-09-01\n',
    );
    // Outside git, the memory's own days date it: verified on 2026-09-20, so fresh for 180 days from then.
    expect(read(root, `${K}/memories/never-a.md`)).toContain(
      'generated: { by: agent/unrecorded, at: 2026-09-20T00:00:00Z }\nverified: { by: agent/unrecorded, at: 2026-09-20T00:00:00Z }\nstale_after: 2027-03-19T00:00:00Z\n',
    );
    const trap = read(root, `${K}/memories/trap-b.md`);
    expect(trap).toContain('type: Gotcha\ntitle: Trap B\ndescription: "when B: watch the C"');
    expect(trap).toContain('tags: [testing, bun]');
    const odd = read(root, `${K}/memories/odd-c.md`);
    expect(odd).not.toContain('type:');
    expect(odd).toContain('kind: pattern');
  });

  test('a feature: feature-status and its derived status, YAML lists, its first sentence as the description, links to its histories', () => {
    const root = legacy();
    run(root, 'migrate-repo', '--force');
    const doc = read(root, `${K}/features/FEAT-0001-login/feature.md`);
    expect(doc).toStartWith(
      '---\ntype: Feature\nid: FEAT-0001\ntitle: "Login: magic links"\ndescription: Log in with a link sent by mail.\nfeature-status: shipped\nstatus: stable\narea: auth\ncreated: 2026-09-01\ntags: [login, auth]\ntouches: [src/auth/, src/login.ts]\ndepends-on: []\nsupersedes: []\nsuperseded-by: []\nconflicts-with: []\ngenerated: { by: agent/unrecorded, at: 2026-09-10T00:00:00Z }\n',
    );
    expect(doc).toContain('The work that built it and the human test rounds that checked it: [work.md](work.md) ·\n[tests.md](tests.md) — both derived by `novadev sync`.\n');
    expect(doc).not.toContain('Regenerate them with `novadev links --fix`');
  });

  test('then deploy and sync: the bundle is whole, and the only problem left is the memory an agent must type', () => {
    const root = legacy();
    run(root, 'migrate-repo', '--force');
    expect(run(root, 'deploy').code).toBe(0);
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    const problems = sync.stdout.split('\n').filter((line) => line.includes('✗'));
    expect(problems).toEqual([
      '  ✗ knowledge/memories/odd-c.md: no `type` — its old kind "pattern" is none of Guardrail, Gotcha, Decision, Guide; read it, write the type that fits as "type:", and delete "kind:"',
    ]);
    expect(read(root, `${K}/features/FEAT-0001-login/work.md`)).toStartWith('---\ntype: Work History\n');
    expect(read(root, `${K}/features/FEAT-0001-login/work.md`)).toContain('`2026-09-01_1/01-x`');
    expect(read(root, `${K}/index.md`)).toContain('* [Overview](wiki/overview.md) - What the demo is');

    write(root, `${K}/memories/odd-c.md`, read(root, `${K}/memories/odd-c.md`).replace('kind: pattern', 'type: Guide'));
    const clean = run(root, 'sync');
    expect(clean.stdout).not.toContain('✗');
    expect(clean.code).toBe(0);
  });

  test('a header written in another tool\'s format keeps its nested values, exactly as written', () => {
    const root = legacy();
    write(root, '.novadev/memories/host.md', '---\nname: host\ndescription: Where the engines live\nmetadata:\n  type: reference\n  tags:\n    - voice\n---\nThe fact.\n');
    run(root, 'migrate-repo', '--force');
    const text = read(root, `${K}/memories/host.md`);
    expect(text).toContain('name: host\nmetadata:\n  type: reference\n  tags:\n    - voice\n---');
    expect(text).toContain('description: Where the engines live');
  });

  test('a knowledge folder that already exists in the bundle is never overwritten', () => {
    const root = legacy();
    write(root, `${K}/memories/mine.md`, '---\ntype: Guide\n---\n');
    const result = run(root, 'migrate-repo', '--force');
    expect(result.stdout).toContain('SKIP .novadev/memories/ — .novadev/knowledge/memories/ already exists; merge the two by hand');
    expect(exists(root, '.novadev/memories/never-a.md')).toBe(true);
    expect(exists(root, `${K}/wiki/overview.md`)).toBe(true);
  });
});
