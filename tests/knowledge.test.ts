// The knowledge bundle (src/knowledge.ts, knowledge-log.ts, knowledge-cmd.ts): day 0, novadev's
// profile on top of the Open Knowledge Format, the derived indexes, recording changes with
// `novadev knowledge log`, the log's completeness, staleness, and changes nobody recorded.
import { describe, expect, test } from 'bun:test';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { auditKnowledge, listConcepts } from '../src/knowledge.ts';
import { NOVADEV_VERSION, todayStamp } from '../src/lib.ts';
import { bundleMarkdownFiles, conformanceProblems, isReserved, readFrontmatterText } from '../src/okf.ts';
import {
  FEATURES,
  KNOWLEDGE,
  MEMORIES,
  STAMP,
  WIKI,
  commitAll,
  completed,
  exists,
  feature,
  git,
  project,
  read,
  readJson,
  run,
  setManifest,
  tempDir,
  todo,
  wikiText,
  write,
} from './helpers.ts';

const AGENT = 'claude-code/claude-opus-5-5';

/** Write a payload file and run `novadev knowledge log` on it. */
function record(root: string, events: unknown[]): { code: number; json: Record<string, any> } {
  write(root, 'events.json', JSON.stringify({ events }));
  const result = run(root, 'knowledge', 'log', 'events.json');
  return { code: result.code, json: JSON.parse(result.stdout) };
}

/** A memory concept's text; `extra` lines go into its frontmatter. */
function memory(type: string, title: string, extra = ''): string {
  return `---\ntype: ${type}\ntitle: ${title}\ndescription: When it applies.\ncreated: 2026-10-01\n${extra}---\nThe fact.\n`;
}

/** The project as a git repository whose fixture identity is "Ada Lovelace". */
function repo(manifest: Record<string, unknown> = {}): string {
  const root = project(manifest);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Ada Lovelace');
  commitAll(root, 'base');
  return root;
}

describe('day 0', () => {
  test('deploy starts the bundle: a log, a root index declaring okf_version, the review policy — and no README inside', () => {
    const root = tempDir();
    expect(run(root, 'deploy').code).toBe(0);
    expect(read(root, `${KNOWLEDGE}/log.md`)).toBe(
      `# Knowledge log\n\n## ${todayStamp()}\n\n* **Initialization**: novadev ${NOVADEV_VERSION} started this knowledge bundle — an Open Knowledge Format (OKF 0.2) bundle for the project's wiki, memories and features.\n`,
    );
    expect(read(root, `${KNOWLEDGE}/index.md`)).toStartWith('---\nokf_version: "0.2"\n---\n');
    expect(readdirSync(join(root, KNOWLEDGE)).sort()).toEqual(['index.md', 'log.md']);
    expect(readJson(root, '.novadev/novadev.json').knowledge).toEqual({ reviewDays: { wiki: 90, memories: 180, features: 365 } });

    const sync = run(root, 'sync');
    expect(sync.code).toBe(0);
    expect(sync.stdout).toContain('wiki is MISSING — build it before any todo work');
    expect(sync.stdout).toContain('features registry is MISSING');
  });

  test('every file of a healthy bundle conforms to the format', () => {
    const root = project();
    feature(root, 'FEAT-0001', 'login', { title: 'Login', area: 'auth' });
    write(root, `${MEMORIES}/a.md`, memory('Gotcha', 'A trap', `generated: ${STAMP}\n`));
    expect(run(root, 'sync').code).toBe(0);
    const bundle = join(root, KNOWLEDGE);
    const files = bundleMarkdownFiles(bundle);
    expect(files).toContain('features/FEAT-0001-login/work.md');
    for (const path of files) expect(conformanceProblems(path, read(root, `${KNOWLEDGE}/${path}`))).toEqual([]);
    expect(files.filter((p) => !isReserved(p)).every((p) => readFrontmatterText(read(root, `${KNOWLEDGE}/${p}`)).state === 'ok')).toBe(true);
  });
});

describe('novadev\'s profile', () => {
  test('each folder holds its own types; every hand-written concept has a title, a one-line description and a generated stamp', () => {
    const root = project();
    write(root, `${WIKI}/stack.md`, '---\ntype: Memory\ntitle: Stack\ndescription: x\ngenerated: { by: a/b, at: 2026-10-01T00:00:00Z }\n---\n');
    write(root, `${MEMORIES}/a.md`, memory('Insight', 'A'));
    write(root, `${MEMORIES}/b.md`, '---\ntype: Gotcha\ndescription: <one line>\n---\n');
    write(root, `${MEMORIES}/c.md`, '---\ntype: Gotcha\ntitle: C\ndescription: "a\\nb"\ngenerated: { by: nobody, at: yesterday }\ntags: a, b\n---\n');
    const problems = auditKnowledge(root, join(root, '.novadev')).problems;
    expect(problems).toContain('knowledge/wiki/stack.md: type "Memory" — a wiki page is type: Wiki Page');
    expect(problems).toContain('knowledge/memories/a.md: type "Insight" — a memory is one of: Guardrail, Gotcha, Decision, Guide');
    expect(problems).toContain('knowledge/memories/a.md: no "generated" stamp — who wrote it, and when; record it with `novadev knowledge log` (skills/novadev-work.md, "Recording a change")');
    expect(problems).toContain('knowledge/memories/b.md: needs a "title" — its name, as text');
    expect(problems).toContain('knowledge/memories/b.md: "description" is still the placeholder — write the line');
    expect(problems).toContain('knowledge/memories/c.md: "description" is one line');
    expect(problems).toContain('knowledge/memories/c.md: "generated.by" must be an actor — `human:<id>` for a person, `process:<id>` for an automated process, or `<producer>/<version>` for an agent or tool (like `claude-code/claude-opus-5-5`)');
    expect(problems).toContain('knowledge/memories/c.md: "tags" must be a YAML list of words, like [sales, revenue]');
  });

  test('files that are not concepts are named, with what to do: a README, an upper-case INDEX.md, a page without frontmatter, a nested wiki page', () => {
    const root = project();
    write(root, `${WIKI}/README.md`, '# About the wiki\n');
    write(root, `${MEMORIES}/INDEX.md`, '# Memories index\n');
    write(root, `${WIKI}/notes.md`, '# Notes\n');
    write(root, `${WIKI}/deep/page.md`, wikiText('Deep'));
    write(root, `${WIKI}/broken.md`, '---\ntype: Wiki Page\ndescription: Login: magic links\n---\n');
    const problems = auditKnowledge(root, join(root, '.novadev')).problems;
    expect(problems).toContain('knowledge/wiki/README.md: no frontmatter — a concept opens with a `---` block that names its `type` (novadev keeps no README inside the bundle — delete it, or make it a concept)');
    expect(problems).toContain('knowledge/memories/INDEX.md: OKF reserves "index.md" in lower case — novadev derives index.md since 0.12.0, so delete this file and run `novadev sync`');
    expect(problems).toContain('knowledge/wiki/notes.md: no frontmatter — a concept opens with a `---` block that names its `type`');
    expect(problems).toContain('knowledge/wiki/deep/page.md: wiki/ is flat — move this page up into wiki/, or into a folder of its own');
    expect(problems.find((p) => p.startsWith('knowledge/wiki/broken.md'))).toContain('line 3 ("description"): the value holds ": " — put the whole value in double quotes');
  });

  test('the wiki is a strict page set: all six, or none (then it must be built)', () => {
    const root = project();
    rmSync(join(root, `${WIKI}/glossary.md`));
    const audit = auditKnowledge(root, join(root, '.novadev'));
    expect(audit.problems).toContain('knowledge/wiki/glossary.md: missing — the wiki is a strict page set (overview.md, stack.md, architecture.md, conventions.md, workflows.md, glossary.md)');
    rmSync(join(root, WIKI), { recursive: true });
    const missing = auditKnowledge(root, join(root, '.novadev'));
    expect(missing.problems.filter((p) => p.includes('strict page set'))).toEqual([]);
    expect(missing.actions[0]).toBe('wiki is MISSING — build it before any todo work (loop phase 9, "Building the wiki")');
  });

  test('a feature\'s OKF status is derived from its feature-status; sync writes it, --check fails while it is wrong', () => {
    const root = project();
    feature(root, 'FEAT-0001', 'login', { title: 'Login', status: 'shipped' });
    run(root, 'sync');
    const path = `${FEATURES}/FEAT-0001-login/feature.md`;
    write(root, path, read(root, path).replace('feature-status: shipped\nstatus: stable', 'feature-status: deprecated\nstatus: stable'));
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('knowledge/features/FEAT-0001-login/feature.md: "status" must be deprecated, as "feature-status" says');
    expect(run(root, 'sync').code).toBe(0);
    expect(read(root, path)).toContain('feature-status: deprecated\nstatus: deprecated');
  });

  test('a feature keeps novadev\'s keys as YAML lists, and feature-status as its lifecycle', () => {
    const root = project();
    feature(root, 'FEAT-0001', 'login', { title: 'Login' });
    const path = `${FEATURES}/FEAT-0001-login/feature.md`;
    write(root, path, read(root, path).replace('touches: []', 'touches: src/auth/, src/login.ts').replace('feature-status: shipped', 'feature-status: done'));
    const result = run(root, 'sync');
    expect(result.stdout).toContain('knowledge/features/FEAT-0001-login: "touches" must be a YAML list, like [src/auth/, src/login.ts]');
    expect(result.stdout).toContain('knowledge/features/FEAT-0001-login: feature-status "done" — one of: planned, in-progress, shipped, deprecated');
  });

  test('sources: an unknown todo is a problem, a vanished repo path a NEXT ACTION, a missing concept a note', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-found', { 'ai_completed.md': completed('01-found') });
    write(root, 'src/real.ts', '');
    write(
      root,
      `${MEMORIES}/a.md`,
      memory('Gotcha', 'A', `generated: ${STAMP}\nsources:\n  - resource: todo:2026-10-01_1/01-found\n  - resource: todo:2026-10-01_1/09-typo\n  - resource: repo:src/real.ts\n  - resource: repo:src/gone.ts\n  - resource: ../wiki/nowhere.md\n`),
    );
    const audit = auditKnowledge(root, join(root, '.novadev'));
    expect(audit.problems).toContain('knowledge/memories/a.md: source todo:2026-10-01_1/09-typo — no such todo in todos/ or the archive');
    expect(audit.problems.join('\n')).not.toContain('01-found');
    expect(audit.actions).toContain('knowledge/memories/a.md: its source repo:src/gone.ts is gone — the code it describes moved or went; re-check the concept and its sources (loop phase 9)');
    expect(audit.notes).toContain('knowledge/memories/a.md: source ../wiki/nowhere.md is not in the bundle');
  });

  test('a link to a concept that is not there is a note — knowledge not written yet', () => {
    const root = project();
    write(root, `${WIKI}/overview.md`, wikiText('Overview', '# Overview\n\nSee [the API](api.md) and [the stack](stack.md) and [code](../../../src/x.ts).\n'));
    expect(auditKnowledge(root, join(root, '.novadev')).notes).toEqual([
      'knowledge/wiki/overview.md: links api.md, which is not in the bundle',
      'knowledge/wiki/overview.md: links ../../../src/x.ts, which does not exist',
    ]);
    write(root, 'src/x.ts', '');
    expect(auditKnowledge(root, join(root, '.novadev')).notes).toEqual(['knowledge/wiki/overview.md: links api.md, which is not in the bundle']);
  });
});

describe('the derived indexes', () => {
  test('the root map lists the wiki pages, then where the memories, the features and the log are', () => {
    const root = project();
    write(root, `${MEMORIES}/a.md`, memory('Guardrail', 'Never A', `generated: ${STAMP}\n`));
    write(root, `${MEMORIES}/b.md`, memory('Gotcha', 'B bites', `generated: ${STAMP}\n`));
    feature(root, 'FEAT-0001', 'login', { title: 'Login', area: 'auth' });
    feature(root, 'FEAT-0002', 'export', { title: 'Export', area: 'files', status: 'planned' });
    expect(run(root, 'sync').code).toBe(0);
    const index = read(root, `${KNOWLEDGE}/index.md`);
    expect(index).toStartWith('---\nokf_version: "0.2"\n---\n\n<!-- DERIVED by `novadev sync`');
    expect(index).toContain('# Wiki\n\n* [Overview](wiki/overview.md) - The overview of the project.\n* [Stack](wiki/stack.md)');
    expect(index).toContain('* [Memories](memories/index.md) - 2 lessons (1 guardrail, 1 gotcha) — open the ones whose line touches your task');
    expect(index).toContain('* [Features](features/index.md) - 2 capabilities (1 planned, 1 shipped) — what the software does; search it before building anything new');
    expect(index).toContain('# History\n\n* [Knowledge log](log.md) - what changed in this knowledge, newest day first');
    expect(read(root, `${MEMORIES}/index.md`)).toContain('# Guardrails\n\n* [Never A](a.md) - When it applies.\n\n# Gotchas\n\n* [B bites](b.md) - When it applies.');
    expect(read(root, `${FEATURES}/index.md`)).toContain('# auth\n\n* [● FEAT-0001 — Login](FEAT-0001-login/feature.md) - shipped · What Login does.\n\n# files\n\n* [○ FEAT-0002 — Export](FEAT-0002-export/feature.md) - planned · What Export does.');
  });

  test('a folder the project adds gets an index of its own, and a line in the root map', () => {
    const root = project();
    write(root, `${KNOWLEDGE}/references/okf-spec.md`, '---\ntype: Reference\ntitle: The OKF spec\ndescription: The format this bundle follows.\ngenerated: { by: a/b, at: 2026-10-01T00:00:00Z }\n---\n');
    expect(run(root, 'sync').code).toBe(0);
    expect(read(root, `${KNOWLEDGE}/references/index.md`)).toContain('# references\n\n* [The OKF spec](okf-spec.md) - The format this bundle follows.');
    expect(read(root, `${KNOWLEDGE}/index.md`)).toContain('# More knowledge\n\n* [references](references/index.md) - 1 concept');
  });

  test('a work history carries its own frontmatter and links back to its feature', () => {
    const root = project();
    feature(root, 'FEAT-0001', 'login', { title: 'Login' });
    run(root, 'sync');
    const work = read(root, `${FEATURES}/FEAT-0001-login/work.md`);
    expect(work).toStartWith('---\ntype: Work History\ntitle: FEAT-0001 — work history\ndescription: Every todo, record and commit that built FEAT-0001 (Login).\ngenerated: { by: process:novadev-sync }\n---\n\n# Work\n');
    expect(work).toContain('The work that built [FEAT-0001 — Login](feature.md).');
    expect(read(root, `${FEATURES}/FEAT-0001-login/tests.md`)).toStartWith('---\ntype: Test History\n');
  });
});

describe('novadev knowledge log', () => {
  test('create, update, verify: stamps in the frontmatter, review dates from the policy, entries in the log', () => {
    const root = repo({ knowledge: { reviewDays: { wiki: 90, memories: 180, features: 365 } } });
    write(root, `${MEMORIES}/bun-filter.md`, memory('Gotcha', 'bun test -t is a regex'));
    const created = record(root, [
      { path: 'memories/bun-filter.md', event: 'create', by: AGENT, note: 'A filter with `\\|` ran nothing.', ref: undefined },
      { path: '.novadev/knowledge/wiki/stack.md', by: AGENT, note: 'Bun 1.4 is required now.' },
      { path: 'memories/bun-filter.md', event: 'verify', by: 'human', note: 'Ada re-ran it.' },
    ]);
    expect(created.code).toBe(0);
    expect(created.json.recorded.map((r: any) => [r.path, r.event, r.by])).toEqual([
      ['memories/bun-filter.md', 'create', AGENT],
      ['wiki/stack.md', 'update', AGENT],
      ['memories/bun-filter.md', 'verify', 'human:ada-lovelace'],
    ]);
    const at = created.json.recorded[0].at as string;
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    const memoryText = read(root, `${MEMORIES}/bun-filter.md`);
    expect(memoryText).toContain(`generated: { by: ${AGENT}, at: ${at} }`);
    expect(memoryText).toContain(`verified:\n  - { by: human:ada-lovelace, at: ${at} }`);
    expect(memoryText).toMatch(/stale_after: \d{4}-\d{2}-\d{2}T/);
    const log = read(root, `${KNOWLEDGE}/log.md`);
    expect(log).toContain(`## ${at.slice(0, 10)}\n\n* **Creation**: [bun test -t is a regex](memories/bun-filter.md) — A filter with \`\\|\` ran nothing. (${AGENT})\n* **Update**: [Stack](wiki/stack.md) — Bun 1.4 is required now. (${AGENT})\n* **Verification**: [bun test -t is a regex](memories/bun-filter.md) — Ada re-ran it. (human:ada-lovelace)\n`);
    expect(run(root, 'sync').code).toBe(0);
    expect(run(root, 'knowledge', '--tier', 'human-reviewed').stdout).toContain('✓✓ [Gotcha] memories/bun-filter.md');
  });

  test('a verify replaces the same actor\'s earlier one, and keeps the others', () => {
    const root = repo();
    write(root, `${MEMORIES}/a.md`, memory('Gotcha', 'A', `generated: ${STAMP}\nverified:\n  - { by: process:nightly, at: 2026-09-01T00:00:00Z }\n  - { by: ${AGENT}, at: 2026-09-02T00:00:00Z }\n`));
    expect(record(root, [{ path: 'memories/a.md', event: 'verify', by: AGENT, note: 'Re-checked.' }]).code).toBe(0);
    const text = read(root, `${MEMORIES}/a.md`);
    expect(text).toContain('  - { by: process:nightly, at: 2026-09-01T00:00:00Z }\n  - { by: claude-code/claude-opus-5-5, at: ');
    expect(text).not.toContain('2026-09-02T00:00:00Z');
  });

  test('deprecate sets the lifecycle — a feature\'s feature-status too — and drops stale_after; remove deletes and logs', () => {
    const root = repo();
    feature(root, 'FEAT-0001', 'login', { title: 'Login' });
    write(root, `${MEMORIES}/old.md`, memory('Gotcha', 'Old', `generated: ${STAMP}\nstale_after: 2027-01-01T00:00:00Z\n`));
    const result = record(root, [
      { path: 'features/FEAT-0001-login/feature.md', event: 'deprecate', by: AGENT, note: 'Replaced by passkeys.' },
      { path: 'memories/old.md', event: 'deprecate', by: AGENT, note: 'Kept for the old records.' },
    ]);
    expect(result.code).toBe(0);
    expect(read(root, `${FEATURES}/FEAT-0001-login/feature.md`)).toContain('feature-status: deprecated\nstatus: deprecated');
    expect(read(root, `${MEMORIES}/old.md`)).toContain('status: deprecated');
    expect(read(root, `${MEMORIES}/old.md`)).not.toContain('stale_after');
    expect(record(root, [{ path: 'memories/old.md', event: 'remove', by: AGENT, note: 'Nothing cites it now.' }]).code).toBe(0);
    expect(exists(root, `${MEMORIES}/old.md`)).toBe(false);
    expect(read(root, `${KNOWLEDGE}/log.md`)).toContain('* **Removal**: [Old](memories/old.md) — Nothing cites it now.');
    expect(run(root, 'sync').code).toBe(0);
  });

  test('refuses what would make the knowledge wrong — and then writes nothing at all', () => {
    const root = repo();
    feature(root, 'FEAT-0001', 'login', { title: 'Login' });
    const before = read(root, `${KNOWLEDGE}/log.md`);
    const stack = read(root, `${WIKI}/stack.md`);
    const refused = (events: unknown[], message: string) => {
      const result = record(root, [{ path: 'wiki/stack.md', by: AGENT, note: 'A real change.' }, ...events]);
      expect(result.code).toBe(1);
      expect(result.json.error).toContain(message);
    };
    refused([{ path: 'features/FEAT-0001-login/feature.md', event: 'remove', by: AGENT, note: 'x' }], 'a feature is never removed');
    refused([{ path: 'wiki/glossary.md', event: 'remove', by: AGENT, note: 'x' }], "a page of the wiki's strict set is never removed");
    refused([{ path: 'wiki/stack.md', event: 'create', by: AGENT, note: 'x' }, { path: 'wiki/stack.md', event: 'create', by: AGENT, note: 'x' }], 'the log already has it — record "update" for a change');
    refused([{ path: 'index.md', by: AGENT, note: 'x' }], 'not a concept you record');
    refused([{ path: 'features/FEAT-0001-login/work.md', by: AGENT, note: 'x' }], 'not a concept you record');
    refused([{ path: 'wiki/nope.md', by: AGENT, note: 'x' }], 'no such concept in the bundle');
    refused([{ path: '../../etc/passwd', by: AGENT, note: 'x' }], 'is not inside .novadev/knowledge/');
    refused([{ path: 'wiki/stack.md', by: 'ada', note: 'x' }], '"by" must be an actor');
    refused([{ path: 'wiki/stack.md', by: AGENT, note: '  ' }], '"note" says what changed');
    refused([{ path: 'wiki/stack.md', by: AGENT, note: 'x', ref: '2026-10-01_9/01-nope' }], '"ref" 2026-10-01_9/01-nope is no todo');
    refused([{ path: 'wiki/stack.md', event: 'publish', by: AGENT, note: 'x' }], '"event" is one of create, update, verify, deprecate, remove');
    write(root, `${MEMORIES}/draft.md`, '---\ntype: Gotcha\ntitle: Draft\ndescription: <one line>\n---\n');
    refused([{ path: 'memories/draft.md', event: 'create', by: AGENT, note: 'x' }], 'write its "description" first');
    expect(read(root, `${KNOWLEDGE}/log.md`)).toBe(before);
    expect(read(root, `${WIKI}/stack.md`)).toBe(stack);
  });

  test('"by": "human" needs git to know the person', () => {
    const root = project();
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', '');
    const result = record(root, [{ path: 'wiki/stack.md', event: 'verify', by: 'human', note: 'x' }]);
    if (result.code === 1) expect(result.json.error).toContain('"by": "human" needs git\'s user.name');
  });
});

describe('the log knows every change', () => {
  test('a stamp newer than the concept\'s newest log entry is a problem; the initialization covers what came before it', () => {
    const root = project();
    expect(run(root, 'sync').code).toBe(0); // every fixture stamp is from the initialization day
    write(root, `${WIKI}/stack.md`, read(root, `${WIKI}/stack.md`).replace(STAMP, `{ by: ${AGENT}, at: 2026-10-05T10:00:00+02:00 }`));
    const result = run(root, 'sync');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('knowledge/wiki/stack.md: changed on 2026-10-05, but log.md has no entry for it since — record it with `novadev knowledge log`');
  });

  test('a concept gone while the log still lists it as current is a problem until its removal is recorded', () => {
    const root = repo();
    write(root, `${MEMORIES}/a.md`, memory('Gotcha', 'A'));
    expect(record(root, [{ path: 'memories/a.md', event: 'create', by: AGENT, note: 'Found it.' }]).code).toBe(0);
    rmSync(join(root, `${MEMORIES}/a.md`));
    const result = run(root, 'sync');
    expect(result.stdout).toContain('knowledge/memories/a.md: gone, but the newest log.md entry for it');
    expect(record(root, [{ path: 'memories/a.md', event: 'remove', by: AGENT, note: 'Wrong lesson.' }]).code).toBe(0);
    expect(run(root, 'sync').code).toBe(0);
  });

  test('a log out of order, or with a heading that is no day, is a problem', () => {
    const root = project();
    write(root, `${KNOWLEDGE}/log.md`, '# Knowledge log\n\n## 2026-10-01\n\n* **Initialization**: x\n\n## 2026-10-05\n\n* y\n\n## someday\n');
    const problems = auditKnowledge(root, join(root, '.novadev')).problems;
    expect(problems).toContain('knowledge/log.md: line 7: 2026-10-05 comes after 2026-10-01 — the newest day goes first');
    expect(problems).toContain('knowledge/log.md: line 11: "## someday" — a date heading must be an ISO day, like "## 2026-10-11"');
  });

  test('a missing log is a problem, never silently restarted', () => {
    const root = project();
    rmSync(join(root, `${KNOWLEDGE}/log.md`));
    const result = run(root, 'sync');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('knowledge/log.md: missing — the history of this knowledge; restore it from git');
    expect(exists(root, `${KNOWLEDGE}/log.md`)).toBe(false);
  });
});

describe('what is due', () => {
  test('a concept past its stale_after is a NEXT ACTION — five by name, then a count; a deprecated one never is', () => {
    const root = project();
    for (let i = 1; i <= 7; i++) {
      write(root, `${MEMORIES}/m${i}.md`, memory('Gotcha', `M${i}`, `generated: ${STAMP}\nstale_after: 2026-01-0${i}T00:00:00Z\n`));
    }
    write(root, `${MEMORIES}/dead.md`, memory('Gotcha', 'Dead', `generated: ${STAMP}\nstatus: deprecated\nstale_after: 2020-01-01T00:00:00Z\n`));
    const result = run(root, 'sync');
    expect(result.stdout).toContain('→ knowledge/memories/m1.md is past its stale_after (2026-01-01) — re-check it against the code, fix what moved, then record a "verify" event (`novadev knowledge log`)');
    expect(result.stdout).toContain('→ knowledge/memories/m5.md is past its stale_after');
    expect(result.stdout).not.toContain('m6.md is past');
    expect(result.stdout).toContain('→ … and 2 more stale concept(s) — `novadev knowledge --stale` lists them all');
    expect(result.stdout).not.toContain('dead.md');
    const stale = run(root, 'knowledge', '--stale');
    expect(stale.stdout).toContain('knowledge — 7 of 14 match (stale)');
    expect(stale.stdout).toContain('STALE since 2026-01-07');
  });

  test('a concept changed since the last commit without a new stamp is a NEXT ACTION; the budgets block sync writes is not a change', () => {
    const root = repo({ metrics: 'cat metrics-out.json' });
    write(root, 'metrics-out.json', '{"debt":{"known":1}}');
    run(root, 'sync'); // writes the budgets block into architecture.md
    commitAll(root, 'block');
    write(root, 'metrics-out.json', '{"debt":{"known":2}}');
    expect(run(root, 'sync').stdout).not.toContain('changed since the last commit'); // the block moved, nothing else

    write(root, `${MEMORIES}/kept.md`, memory('Gotcha', 'Kept'));
    expect(record(root, [{ path: 'memories/kept.md', event: 'create', by: AGENT, note: 'x' }]).code).toBe(0);
    commitAll(root, 'a memory');
    write(root, `${WIKI}/stack.md`, `${read(root, `${WIKI}/stack.md`)}\nA hand edit.\n`);
    rmSync(join(root, `${WIKI}/glossary.md`));
    rmSync(join(root, `${MEMORIES}/kept.md`));
    const result = run(root, 'sync');
    expect(result.stdout).toContain('→ knowledge/wiki/stack.md changed since the last commit, but its "generated" stamp did not — record the change (`novadev knowledge log`, event "update"; by human:<id> when a person made it)');
    // A page of the strict set is restored, never removed; a memory's removal is recorded.
    expect(result.stdout).toContain("→ knowledge/wiki/glossary.md was deleted since the last commit — restore it from git — a page of the wiki's strict set is rewritten, never removed");
    expect(result.stdout).toContain('→ knowledge/memories/kept.md was deleted since the last commit — record its removal (`novadev knowledge log`, event "remove")');
    expect(record(root, [{ path: 'wiki/stack.md', by: 'human', note: 'Ada added a line.' }]).code).toBe(0);
    expect(run(root, 'sync').stdout).not.toContain('stack.md changed since the last commit');
  });
});

describe('novadev knowledge', () => {
  test('alone: what the bundle holds, how far it is trusted, what is stale, where to start', () => {
    const root = project();
    write(root, `${MEMORIES}/a.md`, memory('Guardrail', 'Never A', `generated: ${STAMP}\nverified: { by: human:ada, at: 2026-10-01T00:00:00Z }\n`));
    feature(root, 'FEAT-0001', 'login', { title: 'Login' });
    run(root, 'sync');
    expect(run(root, 'knowledge').stdout).toBe(
      [
        'knowledge — .novadev/knowledge/ is an Open Knowledge Format 0.2 bundle: 8 concept(s) (+2 derived histories)',
        '  by type: Wiki Page 6 · Guardrail 1 · Feature 1',
        '  trust:   1 human-reviewed · 0 machine-confirmed · 7 unverified',
        '  stale:   0 past stale_after',
        '  log:     1 entry, the newest on 2026-10-01',
        '  load first: .novadev/knowledge/index.md',
        '',
      ].join('\n'),
    );
  });

  test('searches every word in path, type, title, description, tags and body; filters by type, tag and tier', () => {
    const root = project();
    write(root, `${MEMORIES}/a.md`, memory('Guardrail', 'Never run tests unboxed', `generated: ${STAMP}\ntags: [testing, memory]\n`));
    write(root, `${MEMORIES}/b.md`, memory('Gotcha', 'Bun filters are regexes', `generated: ${STAMP}\ntags: [testing]\n`));
    expect(run(root, 'knowledge', 'tests', 'unboxed').stdout).toContain('knowledge — 1 of 8 match ("tests unboxed")');
    expect(run(root, 'knowledge', '--tag', 'testing').stdout).toContain('2 of 8 match (tag=testing)');
    expect(run(root, 'knowledge', '--type', 'gotcha').stdout).toContain('· [Gotcha] memories/b.md — Bun filters are regexes');
    expect(run(root, 'knowledge', '--tier', 'nope').stderr).toContain('unknown tier "nope"');
    expect(run(root, 'knowledge', '--bogus').code).toBe(1);
  });

  test('status shows the bundle in two lines', () => {
    const root = project();
    expect(run(root, 'status').stdout).toContain('knowledge — 6 concepts (OKF 0.2): 6 wiki page(s), 0 memories, 0 features\n  trust: 0 human-reviewed, 0 machine-confirmed, 6 unverified · 0 stale');
  });
});

describe('the old layout', () => {
  test('a knowledge folder left at the top of .novadev is a problem pointing at migrate-repo', () => {
    const root = project();
    write(root, '.novadev/memories/a.md', '# old\n');
    const result = run(root, 'doctor');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('memories/: knowledge lives in .novadev/knowledge/memories/ since novadev 0.12.0 — run `novadev migrate-repo`');
  });

  test('listConcepts reads nothing outside the bundle', () => {
    const root = project();
    write(root, '.novadev/todos/2026-10-01_1/01-x/prompt.md', '# not knowledge\n');
    setManifest(root, {});
    expect(listConcepts(join(root, '.novadev')).every((c) => !c.path.includes('todos'))).toBe(true);
  });
});
