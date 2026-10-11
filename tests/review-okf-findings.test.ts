// The independent review of the knowledge bundle (0.12.0): one test per finding, so each stays fixed.
import { describe, expect, test } from 'bun:test';
import { chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { auditKnowledge } from '../src/knowledge.ts';
import { indexDescriptions, indexSummary } from '../src/knowledge-migration.ts';
import { conformanceProblems, linkHref, linkTargets, resolveBundleLink } from '../src/okf.ts';
import {
  FEATURES,
  KNOWLEDGE,
  MEMORIES,
  STAMP,
  WIKI,
  commitAll,
  exists,
  feature,
  git,
  project,
  read,
  run,
  setManifest,
  tempDir,
  write,
} from './helpers.ts';

const AGENT = 'claude-code/claude-opus-5-5';

function record(root: string, events: unknown[]): { code: number; json: Record<string, any> } {
  write(root, 'events.json', JSON.stringify({ events }));
  const result = run(root, 'knowledge', 'log', 'events.json');
  return { code: result.code, json: JSON.parse(result.stdout) };
}

function memory(title: string, extra = ''): string {
  return `---\ntype: Gotcha\ntitle: ${title}\ndescription: When it applies.\n${extra}---\nThe fact.\n`;
}

function repo(manifest: Record<string, unknown> = {}): string {
  const root = project(manifest);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Ada Lovelace');
  commitAll(root, 'base');
  return root;
}

const nd = (root: string) => join(root, '.novadev');

describe('review of the knowledge bundle', () => {
  test('1 · an entry is about its first link: a note naming another concept is no event of it', () => {
    const root = repo();
    write(root, `${MEMORIES}/old.md`, memory('Old'));
    write(root, `${MEMORIES}/new.md`, memory('New'));
    expect(record(root, [
      { path: 'memories/old.md', event: 'create', by: AGENT, note: 'x' },
      { path: 'memories/new.md', event: 'create', by: AGENT, note: 'x' },
    ]).code).toBe(0);
    expect(record(root, [{ path: 'memories/old.md', event: 'remove', by: AGENT, note: 'Merged into [the new one](memories/new.md).' }]).code).toBe(0);
    expect(run(root, 'sync').stdout).not.toContain('memories/new.md');
    expect(record(root, [{ path: 'memories/new.md', by: AGENT, note: 'Took in the old lesson.' }]).code).toBe(0);
    expect(run(root, 'sync').code).toBe(0);
  });

  test('2 · a write that fails leaves the bundle as it was — no stamp without its log entry', () => {
    if (process.getuid?.() === 0) return; // root writes through a read-only file
    const root = repo();
    const stack = read(root, `${WIKI}/stack.md`);
    const glossary = read(root, `${WIKI}/glossary.md`);
    const log = join(root, `${KNOWLEDGE}/log.md`);
    chmodSync(log, 0o444);
    try {
      const result = record(root, [
        { path: 'wiki/stack.md', by: AGENT, note: 'x' },
        { path: 'wiki/glossary.md', by: AGENT, note: 'y' },
      ]);
      expect(result.code).toBe(1);
      expect(result.json.error).toContain('log.md: cannot be written');
    } finally {
      chmodSync(log, 0o644);
    }
    expect(read(root, `${WIKI}/stack.md`)).toBe(stack);
    expect(read(root, `${WIKI}/glossary.md`)).toBe(glossary);
    expect(exists(root, `${WIKI}/.stack.md.novadev-${process.pid}.tmp`)).toBe(false);
  });

  test('3 · an extension key named like a prototype member is a key like any other', () => {
    const root = repo();
    write(root, `${MEMORIES}/a.md`, memory('A', `constructor: mine\ntoString: also mine\n`));
    expect(record(root, [{ path: 'memories/a.md', event: 'create', by: AGENT, note: 'x' }]).code).toBe(0);
    expect(read(root, `${MEMORIES}/a.md`)).toContain('constructor: mine\ntoString: also mine\n');
    feature(root, 'FEAT-0001', 'login', { title: 'Login' });
    const path = `${FEATURES}/FEAT-0001-login/feature.md`;
    write(root, path, read(root, path).replace('status: stable', 'status: draft\nvalueOf: kept'));
    const sync = run(root, 'sync');
    expect(sync.stderr).toBe('');
    expect(read(root, path)).toContain('status: stable\nvalueOf: kept');
  });

  test('4 · a CRLF checkout of an unchanged concept is no change', () => {
    const root = repo();
    write(root, `${WIKI}/stack.md`, read(root, `${WIKI}/stack.md`).replace(/\n/g, '\r\n'));
    expect(run(root, 'sync').stdout).not.toContain('changed since the last commit');
    expect(record(root, [{ path: 'wiki/stack.md', event: 'verify', by: AGENT, note: 'Re-checked.' }]).code).toBe(0);
    expect(run(root, 'sync').stdout).not.toContain('stack.md');
  });

  test('5 · the "## Budgets" section sync adds to a page is no change by a person', () => {
    const root = repo({ metrics: 'cat metrics-out.json' });
    write(root, 'metrics-out.json', '{"debt":{"known":1}}');
    const sync = run(root, 'sync');
    expect(read(root, `${WIKI}/architecture.md`)).toContain('## Budgets');
    expect(sync.stdout).not.toContain('changed since the last commit');
  });

  test('6 · stamps written by hand are a NEXT ACTION until restored or recorded', () => {
    const root = repo();
    write(root, `${WIKI}/stack.md`, read(root, `${WIKI}/stack.md`).replace(`generated: ${STAMP}`, `generated: ${STAMP}\nverified: { by: human:the-boss, at: 2026-10-01T00:00:00Z }`));
    expect(run(root, 'sync').stdout).toContain(
      '→ knowledge/wiki/stack.md: its stamps (generated, verified, stale_after) changed since the last commit with no new log.md entry — only `novadev knowledge log` writes them: restore them from git, or record what really happened',
    );
    expect(record(root, [{ path: 'wiki/stack.md', event: 'verify', by: 'human', note: 'Ada confirmed it.' }]).code).toBe(0);
    expect(run(root, 'sync').stdout).not.toContain('its stamps');
  });

  test('7 · a verify never rewrites a verified list it cannot read', () => {
    const root = repo();
    const text = memory('A', `generated: ${STAMP}\nverified:\n  - { by: human:the-boss, at: 2026-10-01T00:00:00Z }\n  - { by: a/b, at: someday }\n`);
    write(root, `${MEMORIES}/a.md`, text);
    const result = record(root, [{ path: 'memories/a.md', event: 'verify', by: AGENT, note: 'x' }]);
    expect(result.code).toBe(1);
    expect(result.json.error).toContain('its "verified" list must be repaired first');
    expect(read(root, `${MEMORIES}/a.md`)).toBe(text);
  });

  test('8 · a folder that is never due, and a deprecated concept, get no review date', () => {
    const root = repo({ knowledge: { reviewDays: { wiki: 90, memories: null, features: 365 } } });
    write(root, `${MEMORIES}/a.md`, memory('A', `generated: ${STAMP}\nstale_after: 2026-01-01T00:00:00Z\n`));
    write(root, `${MEMORIES}/b.md`, memory('B', `generated: ${STAMP}\nstatus: deprecated\n`));
    expect(record(root, [
      { path: 'memories/a.md', by: AGENT, note: 'x' },
      { path: 'memories/b.md', by: AGENT, note: 'y' },
      { path: 'wiki/stack.md', by: AGENT, note: 'z' },
    ]).code).toBe(0);
    expect(read(root, `${MEMORIES}/a.md`)).not.toContain('stale_after');
    expect(read(root, `${MEMORIES}/b.md`)).not.toContain('stale_after');
    expect(read(root, `${WIKI}/stack.md`)).toContain('stale_after:');
  });

  test('9 · a concept named with a space, a "#" or a "?" is linked so it reads back', () => {
    expect(linkHref('memories/my note #1?.md')).toBe('<memories/my%20note%20%231%3F.md>'.replace(/%20/g, ' '));
    expect(resolveBundleLink(linkTargets(`[x](${linkHref('memories/my note #1?.md')})`)[0]!, 'log.md')).toBe('memories/my note #1?.md');
    const root = repo();
    write(root, `${MEMORIES}/my note #1.md`, memory('Odd name'));
    expect(record(root, [{ path: 'memories/my note #1.md', event: 'create', by: AGENT, note: 'x' }]).code).toBe(0);
    write(root, `${MEMORIES}/my note #1.md`, read(root, `${MEMORIES}/my note #1.md`).replace(/at: (\S+) \}/, 'at: 2099-01-01T00:00:00Z }'));
    // Its log entry is found, so only the honest problem is left: a stamp newer than the entry.
    expect(run(root, 'sync').stdout).toContain('knowledge/memories/my note #1.md: changed on 2099-01-01');
    for (const path of ['index.md', 'memories/index.md']) {
      expect(conformanceProblems(path, read(root, `${KNOWLEDGE}/${path}`))).toEqual([]);
    }
  });

  test('10 · an index sync wrote goes when nothing is left to list; a registry index listing ghosts is a problem', () => {
    const root = repo();
    write(root, `${MEMORIES}/a.md`, memory('A'));
    expect(record(root, [{ path: 'memories/a.md', event: 'create', by: AGENT, note: 'x' }]).code).toBe(0);
    run(root, 'sync');
    expect(exists(root, `${MEMORIES}/index.md`)).toBe(true);
    expect(record(root, [{ path: 'memories/a.md', event: 'remove', by: AGENT, note: 'Gone.' }]).code).toBe(0);
    const check = run(root, 'sync', '--check');
    expect(check.stdout).toContain('knowledge/memories/index.md: lists concepts that are gone — sync removes it');
    expect(run(root, 'sync').code).toBe(0);
    expect(exists(root, `${MEMORIES}/index.md`)).toBe(false);

    write(root, `${FEATURES}/index.md`, '# Features\n\n* [FEAT-0001](FEAT-0001-x/feature.md) - gone\n');
    expect(auditKnowledge(root, nd(root)).problems).toContain(
      'knowledge/features/index.md: lists features, but the registry has none — delete it (the registry is missing) or leave only a "# Features" heading (the project has none yet)',
    );
  });

  test('11 · a deleted feature is restored from git, never removed', () => {
    const root = repo();
    feature(root, 'FEAT-0001', 'login', { title: 'Login' });
    run(root, 'sync');
    commitAll(root, 'feature');
    rmSync(join(root, `${FEATURES}/FEAT-0001-login/feature.md`));
    expect(run(root, 'sync').stdout).toContain(
      'knowledge/features/FEAT-0001-login/feature.md was deleted since the last commit — restore it from git — a feature is never removed: record a "deprecate" instead',
    );
  });

  test('12 · a hidden file is not part of the bundle, so it cannot be recorded', () => {
    const root = repo();
    write(root, `${KNOWLEDGE}/.drafts/d.md`, memory('Draft'));
    const result = record(root, [{ path: '.drafts/d.md', event: 'create', by: AGENT, note: 'x' }]);
    expect(result.code).toBe(1);
    expect(result.json.error).toContain('is hidden');
  });

  test('13 · the migration reads every old one-liner, keeps the wiki summary, and re-aims every link', () => {
    const root = tempDir();
    setManifest(root, { novadev: true, version: '0.11.0' }, true);
    write(
      root,
      '.novadev/wiki/INDEX.md',
      '# Wiki\n\nA demo app. It does one thing well.\n\n- [Overview](./overview.md) — what it is\n- **Stack** ([stack.md](stack.md)): Bun 1.4, TypeScript\n',
    );
    write(root, '.novadev/wiki/overview.md', '---\nupdated: 2026-09-01\n---\n\n# Overview\n\nSee [the code][code].\n\n[code]: ../../src/app.ts\n');
    write(root, '.novadev/wiki/stack.md', '---\nupdated: 2026-09-01\n---\n\n# Stack\n');
    write(root, '.novadev/wiki/diagrams/flow.md', '# Flow\n\n[app](../../../src/app.ts)\n');
    write(root, 'src/app.ts', '');
    expect(indexDescriptions(join(root, '.novadev/wiki'))).toEqual(new Map([['overview.md', 'what it is'], ['stack.md', 'Bun 1.4, TypeScript']]));
    expect(indexSummary(join(root, '.novadev/wiki'))).toBe('A demo app. It does one thing well.');
    expect(run(root, 'migrate-repo', '--force').code).toBe(0);
    const overview = read(root, `${WIKI}/overview.md`);
    expect(overview).toContain('description: what it is');
    expect(overview).toContain('# Overview\n\nA demo app. It does one thing well.\n\nSee [the code][code].');
    expect(overview).toContain('[code]: ../../../src/app.ts');
    expect(read(root, `${WIKI}/stack.md`)).toContain('description: Bun 1.4, TypeScript');
    expect(read(root, `${WIKI}/diagrams/flow.md`)).toContain('[app](../../../../src/app.ts)');
  });

  test('14 · a feature without a title is reported once', () => {
    const root = project();
    feature(root, 'FEAT-0001', 'login', { title: 'Login' });
    const path = `${FEATURES}/FEAT-0001-login/feature.md`;
    write(root, path, read(root, path).replace('title: Login', 'title: ""'));
    const titles = run(root, 'sync').stdout.split('\n').filter((line) => line.includes('FEAT-0001-login') && line.includes('title'));
    expect(titles).toEqual(['  ✗ knowledge/features/FEAT-0001-login/feature.md: needs a "title" — its name, as text']);
  });
});
