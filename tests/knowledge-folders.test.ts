// The knowledge settings in novadev.json (0.13.0): review days for any top-level folder of the bundle
// and "*" for the rest, a one-line description per folder for the map, what `novadev knowledge log`
// dates with them, and a novadev.json from 0.12.0 meaning exactly what it meant.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { auditKnowledge, parseKnowledgeSettings, readKnowledgeSettings, reviewDaysFor } from '../src/knowledge.ts';
import { NOVADEV_VERSION, todayStamp } from '../src/lib.ts';
import { addDaysToTimestamp, conformanceProblems, readFrontmatterText } from '../src/okf.ts';
import { KNOWLEDGE, MEMORIES, STAMP, WIKI, commitAll, git, project, read, readJson, run, setManifest, write } from './helpers.ts';

const AGENT = 'claude-code/claude-opus-5-5';
const THREE = { wiki: 90, memories: 180, features: 365 };

function record(root: string, events: unknown[]): { code: number; json: Record<string, any> } {
  write(root, 'events.json', JSON.stringify({ events }));
  const result = run(root, 'knowledge', 'log', 'events.json');
  return { code: result.code, json: JSON.parse(result.stdout) };
}

/** A concept of the project's own type at `path` inside the bundle; `extra` lines go into its frontmatter. */
function concept(root: string, path: string, extra = `generated: ${STAMP}\n`): void {
  const title = path.split('/').pop()!.replace(/\.md$/, '');
  write(root, `${KNOWLEDGE}/${path}`, `---\ntype: Reference\ntitle: ${title}\ndescription: What ${title} says.\n${extra}---\nThe text.\n`);
}

function repo(manifest: Record<string, unknown> = {}): string {
  const root = project(manifest);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Ada Lovelace');
  commitAll(root, 'base');
  return root;
}

/** The `stale_after` of a concept, or null when it has none. */
function staleAfter(root: string, path: string): string | null {
  const read_ = readFrontmatterText(read(root, `${KNOWLEDGE}/${path}`));
  return read_.state === 'ok' && typeof read_.data.stale_after === 'string' ? read_.data.stale_after : null;
}

/** The policy's review days, as parsed. */
function policy(raw: unknown): Map<string, number | null> {
  const parsed = parseKnowledgeSettings(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return new Map(parsed.value.reviewDays);
}

describe('review days for any folder', () => {
  test('a 0.12.0 policy reads as it did: the three folders, no other folder dated, nothing described', () => {
    const parsed = parseKnowledgeSettings({ reviewDays: THREE });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect([...parsed.value.reviewDays]).toEqual([['wiki', 90], ['memories', 180], ['features', 365]]);
    expect(parsed.value.folders.size).toBe(0);
    expect(reviewDaysFor(parsed.value.reviewDays, 'wiki/stack.md')).toBe(90);
    expect(reviewDaysFor(parsed.value.reviewDays, 'features/FEAT-0001-login/feature.md')).toBe(365);
    expect(reviewDaysFor(parsed.value.reviewDays, 'references/okf.md')).toBeNull();
    expect(reviewDaysFor(parsed.value.reviewDays, 'notes.md')).toBeNull();
    for (const none of [undefined, null, {}, { reviewDays: null }]) {
      const empty = parseKnowledgeSettings(none);
      expect(empty.ok && empty.value.reviewDays.size === 0 && empty.value.folders.size === 0).toBe(true);
    }
  });

  test('any top-level folder may have its days; "*" gives every other concept its days; null is never due, whatever "*" says', () => {
    const days = policy({ reviewDays: { wiki: 90, planner: 30, references: null, '*': 200, 'repos/': 60 } });
    expect(reviewDaysFor(days, 'wiki/stack.md')).toBe(90);
    expect(reviewDaysFor(days, 'planner/stage-1/drawing.md')).toBe(30); // a folder inside planner takes its days
    expect(reviewDaysFor(days, 'references/okf.md')).toBeNull();
    expect(reviewDaysFor(days, 'memories/a.md')).toBe(200);
    expect(reviewDaysFor(days, 'competitors/x.md')).toBe(200);
    expect(reviewDaysFor(days, 'notes.md')).toBe(200); // the bundle root's concepts too
    expect(reviewDaysFor(days, 'repos/irris.md')).toBe(60); // "repos/" is the folder repos
    // A folder named like a prototype member is a folder like any other.
    expect(reviewDaysFor(policy({ reviewDays: JSON.parse('{"__proto__": 7, "constructor": 8}') }), '__proto__/a.md')).toBe(7);
    expect(reviewDaysFor(policy({ reviewDays: { constructor: 8 } }), 'toString/a.md')).toBeNull();
  });

  test('a name that can be no folder of the bundle, or days that are no whole days, are refused — saying why', () => {
    const refused = (raw: unknown) => {
      const parsed = parseKnowledgeSettings(raw);
      return parsed.ok ? 'accepted' : parsed.error;
    };
    const reviewDays = (days: Record<string, unknown>) => refused({ reviewDays: days });
    expect(reviewDays({ 'references/tutorials': 30 })).toBe(
      '"knowledge.reviewDays" names "references/tutorials" — review days are set per top-level folder, and a folder inside one takes its days',
    );
    expect(reviewDays({ '.drafts': 30 })).toBe('"knowledge.reviewDays" names ".drafts" — a name starting with "." is hidden, and not part of the bundle');
    expect(reviewDays({ 'index.md': 30 })).toBe('"knowledge.reviewDays" names "index.md" — index.md and log.md are the files a bundle reserves, never folders');
    expect(reviewDays({ 'LOG.md': 30 })).toContain('the files a bundle reserves');
    expect(reviewDays({ '': 30 })).toBe('"knowledge.reviewDays" names "" — a folder needs a name');
    expect(reviewDays({ ' planner': 30 })).toContain('it has spaces around it, so it names no folder');
    expect(reviewDays({ 'a\\b': 30 })).toContain('write a path with "/"');
    expect(reviewDays({ '*/': 30 })).toContain('"*" stands for every folder not named, never for one');
    expect(reviewDays({ planner: 30, 'planner/': 40 })).toBe('"knowledge.reviewDays" names planner/ twice');
    expect(reviewDays({ planner: 0 })).toBe('"knowledge.reviewDays" gives "planner" 0 — whole days, 1 to 36500, or null for a folder that is never due');
    expect(reviewDays({ planner: 1.5 })).toContain('gives "planner" 1.5 — whole days');
    expect(reviewDays({ planner: '90' })).toContain('gives "planner" "90" — whole days');
    expect(reviewDays({ '*': -1 })).toContain('gives "*" -1 — whole days');
    expect(refused({ reviewDays: [90] })).toStartWith('"knowledge.reviewDays" gives a top-level folder of the bundle its review days');
    expect(refused({ reviewdays: THREE })).toStartWith('"knowledge" has an unknown key "reviewdays" — "knowledge" is { "reviewDays"');
    expect(refused({ reviewDays: null, junk: 1 })).toStartWith('"knowledge" has an unknown key "junk"');
    expect(refused('90 days')).toStartWith('"knowledge" is { "reviewDays": { … }, "folders": { … } }');
  });

  test('the trap of 0.12.0 is gone: a folder of the project\'s own in the policy no longer costs every folder its review dates', () => {
    // 0.12.0 refused this policy whole, so `knowledge log` dated nothing and removed the dates it found.
    const root = repo({ knowledge: { reviewDays: { ...THREE, planner: 30 } } });
    concept(root, 'planner/drawing.md', '');
    write(root, `${MEMORIES}/a.md`, `---\ntype: Gotcha\ntitle: A\ndescription: When it applies.\ngenerated: ${STAMP}\nstale_after: 2027-01-01T00:00:00Z\n---\nThe fact.\n`);
    const result = record(root, [
      { path: 'planner/drawing.md', event: 'create', by: AGENT, note: 'What a planner user draws first.' },
      { path: 'wiki/stack.md', by: AGENT, note: 'Bun 1.4.' },
      { path: 'memories/a.md', by: AGENT, note: 'Sharper.' },
    ]);
    expect(result.code).toBe(0);
    const at = result.json.recorded[0].at as string;
    expect(staleAfter(root, 'planner/drawing.md')).toBe(addDaysToTimestamp(at, 30));
    expect(staleAfter(root, 'wiki/stack.md')).toBe(addDaysToTimestamp(at, 90));
    expect(staleAfter(root, 'memories/a.md')).toBe(addDaysToTimestamp(at, 180));
    const sync = run(root, 'sync');
    expect(sync.code).toBe(0);
    expect(sync.stdout).not.toContain('novadev.json');
  });

  test('a concept in a folder of the project\'s own: "*" dates it, null leaves it undated, and past its date it is on the list', () => {
    const root = repo({ knowledge: { reviewDays: { ...THREE, references: null, '*': 200 } } });
    concept(root, 'competitors/rival.md', '');
    concept(root, 'references/okf.md', `generated: ${STAMP}\nstale_after: 2027-01-01T00:00:00Z\n`);
    concept(root, 'notes.md', '');
    const result = record(root, [
      { path: 'competitors/rival.md', event: 'create', by: AGENT, note: 'What they sell.' },
      { path: 'references/okf.md', by: AGENT, note: 'The 0.2 spec.' },
      { path: 'notes.md', event: 'create', by: AGENT, note: 'Loose notes.' },
    ]);
    expect(result.code).toBe(0);
    const at = result.json.recorded[0].at as string;
    expect(staleAfter(root, 'competitors/rival.md')).toBe(addDaysToTimestamp(at, 200));
    expect(staleAfter(root, 'references/okf.md')).toBeNull(); // never due: the date it had is removed
    expect(staleAfter(root, 'notes.md')).toBe(addDaysToTimestamp(at, 200));

    concept(root, 'competitors/old.md', `generated: ${STAMP}\nstale_after: 2026-01-01T00:00:00Z\n`);
    expect(run(root, 'sync').stdout).toContain('→ knowledge/competitors/old.md is past its stale_after (2026-01-01)');
    expect(run(root, 'knowledge', '--stale').stdout).toContain('[Reference] competitors/old.md');
  });

  test('a policy that cannot be read stops `novadev knowledge log` before it writes anything', () => {
    const root = repo();
    write(root, `${MEMORIES}/a.md`, `---\ntype: Gotcha\ntitle: A\ndescription: When it applies.\ngenerated: ${STAMP}\nstale_after: 2027-01-01T00:00:00Z\n---\nThe fact.\n`);
    const memory = read(root, `${MEMORIES}/a.md`);
    const log = read(root, `${KNOWLEDGE}/log.md`);
    setManifest(root, { knowledge: { reviewDays: { ...THREE, wiki: 0 } } });
    const refused = record(root, [{ path: 'memories/a.md', by: AGENT, note: 'x' }]);
    expect(refused.code).toBe(1);
    expect(refused.json.error).toBe(
      '.novadev/novadev.json: "knowledge.reviewDays" gives "wiki" 0 — whole days, 1 to 36500, or null for a folder that is never due. Fix it first: the review dates come from it. Nothing was recorded.',
    );
    write(root, '.novadev/novadev.json', '{\n<<<<<<< HEAD\n  "novadev": true\n');
    const broken = record(root, [{ path: 'memories/a.md', by: AGENT, note: 'x' }]);
    expect(broken.code).toBe(1);
    expect(broken.json.error).toContain('.novadev/novadev.json is not a valid JSON object (a merge conflict?) — fix it first');
    expect(read(root, `${MEMORIES}/a.md`)).toBe(memory);
    expect(read(root, `${KNOWLEDGE}/log.md`)).toBe(log);
  });
});

describe('folders described in the map', () => {
  const FOLDERS = {
    planner: 'What a planner user can do, stage by stage.',
    'references/tutorials': 'Step by step, from the vendors.',
  };

  function described(): string {
    const root = project({ knowledge: { reviewDays: THREE, folders: FOLDERS } });
    for (const path of ['planner/a.md', 'planner/b.md', 'alpha/a.md', 'references/okf.md', 'references/tutorials/t.md', 'zeta/z.md']) {
      concept(root, path);
    }
    return root;
  }

  test('the root index gives a described folder its line, then how many concepts it holds; the declared folders come first', () => {
    const root = described();
    expect(run(root, 'sync').code).toBe(0);
    const index = read(root, `${KNOWLEDGE}/index.md`);
    expect(index).toContain(
      '# More knowledge\n\n* [planner](planner/index.md) - What a planner user can do, stage by stage. (2 concepts)\n* [alpha](alpha/index.md) - 1 concept\n* [references](references/index.md) - 2 concepts\n* [zeta](zeta/index.md) - 1 concept\n',
    );
    // A folder inside another is described by its path, in the index of the folder above it.
    expect(read(root, `${KNOWLEDGE}/references/index.md`)).toContain(
      '# references\n\n* [okf](okf.md) - What okf says.\n* [tutorials](tutorials/index.md) - Step by step, from the vendors. (1 concept)\n',
    );
    for (const path of ['index.md', 'references/index.md', 'planner/index.md']) {
      expect(conformanceProblems(path, read(root, `${KNOWLEDGE}/${path}`))).toEqual([]);
    }
  });

  test('the folders come in the order novadev.json declares them, not by name', () => {
    const root = project({ knowledge: { folders: { zeta: 'Z, first.', alpha: 'A, second.' } } });
    concept(root, 'alpha/a.md');
    concept(root, 'zeta/z.md');
    expect(run(root, 'sync').code).toBe(0);
    expect(read(root, `${KNOWLEDGE}/index.md`)).toContain('* [zeta](zeta/index.md) - Z, first. (1 concept)\n* [alpha](alpha/index.md) - A, second. (1 concept)\n');
  });

  test('a changed line leaves the map out of date: --check fails until sync writes it', () => {
    const root = described();
    run(root, 'sync');
    setManifest(root, { knowledge: { reviewDays: THREE, folders: { ...FOLDERS, planner: 'Every stage of a planner user.' } } });
    const check = run(root, 'sync', '--check');
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('✗ knowledge/index.md: out of date');
    expect(run(root, 'sync').code).toBe(0);
    expect(read(root, `${KNOWLEDGE}/index.md`)).toContain('* [planner](planner/index.md) - Every stage of a planner user. (2 concepts)');
  });

  test('a description is one line of text, for a folder novadev does not describe itself', () => {
    const folders = (value: Record<string, unknown> | unknown[]) => {
      const parsed = parseKnowledgeSettings({ folders: value });
      return parsed.ok ? 'accepted' : parsed.error;
    };
    expect(folders({ 'planner/': 'Trailing "/" is fine.' })).toBe('accepted');
    expect(folders({ wiki: 'x' })).toBe('"knowledge.folders" names "wiki" — novadev writes the map\'s line for wiki/ itself');
    expect(folders({ 'features/FEAT-0001-login': 'x' })).toContain("novadev writes the map's line for features/ itself");
    expect(folders({ '*': 'x' })).toBe('"knowledge.folders" names "*" — "*" belongs to reviewDays; a description is for one folder');
    expect(folders({ 'references/.drafts': 'x' })).toContain('is hidden, and not part of the bundle');
    expect(folders({ 'references//tutorials': 'x' })).toContain('it has an empty part');
    expect(folders({ planner: 'Two\nlines.' })).toBe('"knowledge.folders" gives "planner" more than one line — the map shows one');
    for (const none of ['', '   ', null, 5, '<one line: what it holds>']) {
      expect(folders({ planner: none })).toBe('"knowledge.folders" gives "planner" no line of its own — write what the folder holds, as text');
    }
    expect(folders(['planner'])).toStartWith('"knowledge.folders" gives a folder of the bundle one line saying what it holds');
  });

  test('doctor notes a folder the settings name that holds nothing — a typo, or one still to come; novadev\'s own three may wait', () => {
    const root = project({ knowledge: { reviewDays: { ...THREE, planer: 30 }, folders: { refrences: 'Typo.' } } });
    concept(root, 'planner/a.md');
    const notes = auditKnowledge(root, join(root, '.novadev')).notes;
    expect(notes).toContain('novadev.json: "knowledge.reviewDays" names planer/, which holds no concept — a folder still to come, or a typo');
    expect(notes).toContain('novadev.json: "knowledge.folders" describes refrences/, which holds no concept — a folder still to come, or a typo');
    expect(notes.filter((note) => note.startsWith('novadev.json'))).toHaveLength(2); // no word about memories/ or features/
    const doctor = run(root, 'doctor');
    expect(doctor.stdout).toContain('· novadev.json: "knowledge.reviewDays" names planer/');
  });
});

describe('a novadev.json from 0.12.0', () => {
  /** The settings every project had after migrating to 0.12.0. */
  const OLD = {
    deployedAt: '2026-10-11',
    metrics: null,
    debtBudget: null,
    hubs: null,
    placementSince: '2026-10-02',
    migratedAt: '2026-10-11',
    knowledge: { reviewDays: THREE },
  };

  test('means what it meant: a folder of the project\'s own is "N concepts" in the map, and gets no review date', () => {
    const root = repo(OLD);
    concept(root, 'references/okf.md', `generated: ${STAMP}\nstale_after: 2027-01-01T00:00:00Z\n`);
    expect(run(root, 'sync').code).toBe(0);
    expect(read(root, `${KNOWLEDGE}/index.md`)).toContain('# More knowledge\n\n* [references](references/index.md) - 1 concept\n');
    expect(run(root, 'doctor').stdout).not.toContain('novadev.json');
    const result = record(root, [
      { path: 'references/okf.md', by: AGENT, note: 'The 0.2 spec.' },
      { path: 'wiki/stack.md', by: AGENT, note: 'Bun 1.4.' },
    ]);
    expect(result.code).toBe(0);
    expect(staleAfter(root, 'references/okf.md')).toBeNull(); // as 0.12.0 did: no days for the folder
    expect(staleAfter(root, `wiki/stack.md`)).toBe(addDaysToTimestamp(result.json.recorded[0].at, 90));
    expect(read(root, `${WIKI}/stack.md`)).toContain('stale_after:');
  });

  test('upgrading: sync asks for migrate-repo, which only stamps the version and keeps every setting — or deploy alone does', () => {
    const migrated = project({ ...OLD, version: '0.12.0' });
    const blocked = run(migrated, 'sync');
    expect(blocked.code).toBe(1);
    expect(blocked.stdout).toContain(`sync: repo is at 0.12.0, installed novadev is ${NOVADEV_VERSION}.`);
    const migration = run(migrated, 'migrate-repo');
    expect(migration.code).toBe(0);
    expect(migration.stdout).toContain(`migrate-repo: layout is already current; stamped 0.12.0 → ${NOVADEV_VERSION}.`);
    expect(readJson(migrated, '.novadev/novadev.json')).toEqual({ novadev: true, ...OLD, version: NOVADEV_VERSION, migratedAt: todayStamp() });
    expect(run(migrated, 'sync').code).toBe(0);

    const deployed = project({ ...OLD, version: '0.12.0' });
    expect(run(deployed, 'deploy').code).toBe(0);
    expect(readJson(deployed, '.novadev/novadev.json')).toMatchObject({ version: NOVADEV_VERSION, knowledge: { reviewDays: THREE } });
    expect(run(deployed, 'sync').code).toBe(0);
  });
});

describe('the review of 0.13.0: each part of the settings on its own', () => {
  test('a mistake in "folders" never drops the review days, and one in "reviewDays" never drops the lines', () => {
    const badDays = readKnowledgeSettings({ reviewDays: { ...THREE, wiki: 0 }, folders: { planner: 'P.' } });
    expect(badDays.shape).toBeNull();
    expect(badDays.reviewDays.ok).toBe(false);
    expect(badDays.folders).toEqual({ ok: true, value: new Map([['planner', 'P.']]) });
    const badLines = readKnowledgeSettings({ reviewDays: THREE, folders: { wiki: 'x' } });
    expect(badLines.reviewDays).toEqual({ ok: true, value: new Map(Object.entries(THREE)) });
    expect(badLines.folders.ok).toBe(false);
    expect(readKnowledgeSettings({ reviewdays: THREE }).shape).toStartWith('"knowledge" has an unknown key "reviewdays"');
    expect(readKnowledgeSettings('90').shape).toStartWith('"knowledge" is { "reviewDays"');
  });

  test('`knowledge log` dates concepts despite a wrong "folders" line; the map keeps its lines despite wrong "reviewDays"', () => {
    const root = repo({ knowledge: { reviewDays: { ...THREE, planner: 30 }, folders: { wiki: "Not novadev's to describe." } } });
    concept(root, 'planner/a.md', '');
    const result = record(root, [{ path: 'planner/a.md', event: 'create', by: AGENT, note: 'x' }]);
    expect(result.code).toBe(0);
    expect(staleAfter(root, 'planner/a.md')).toBe(addDaysToTimestamp(result.json.recorded[0].at, 30));
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stdout).toContain('✗ novadev.json: "knowledge.folders" names "wiki" — novadev writes the map\'s line for wiki/ itself');

    setManifest(root, { knowledge: { reviewDays: { ...THREE, planner: '30' }, folders: { planner: 'What a planner user can do.' } } });
    run(root, 'sync');
    expect(read(root, `${KNOWLEDGE}/index.md`)).toContain('* [planner](planner/index.md) - What a planner user can do. (1 concept)');
    const refused = record(root, [{ path: 'planner/a.md', by: AGENT, note: 'y' }]);
    expect(refused.code).toBe(1);
    expect(refused.json.error).toStartWith('.novadev/novadev.json: "knowledge.reviewDays" gives "planner" "30" — whole days');

    setManifest(root, { knowledge: { reviewdays: THREE } });
    expect(record(root, [{ path: 'planner/a.md', by: AGENT, note: 'y' }]).json.error).toStartWith(
      '.novadev/novadev.json: "knowledge" has an unknown key "reviewdays"',
    );
  });

  test('review days stop at a hundred years, so the date written is always one a timestamp can hold', () => {
    expect(parseKnowledgeSettings({ reviewDays: { planner: 36501 } })).toEqual({
      ok: false,
      error: '"knowledge.reviewDays" gives "planner" 36501 — whole days, 1 to 36500, or null for a folder that is never due',
    });
    const root = repo({ knowledge: { reviewDays: { ...THREE, planner: 36500 } } });
    concept(root, 'planner/a.md', '');
    const result = record(root, [{ path: 'planner/a.md', event: 'create', by: AGENT, note: 'x' }]);
    expect(result.code).toBe(0);
    expect(staleAfter(root, 'planner/a.md')).toBe(addDaysToTimestamp(result.json.recorded[0].at, 36500));
  });

  test('doctor notes a "knowledge" with no "reviewDays" — "folders" pasted over the whole object dates nothing', () => {
    const pasted = project({ knowledge: { folders: { planner: 'P.' } } });
    concept(pasted, 'planner/a.md');
    expect(auditKnowledge(pasted, join(pasted, '.novadev')).notes).toContain(
      'novadev.json: "knowledge" has no "reviewDays", so no concept gets a review date — write them back (the default is {"wiki":90,"memories":180,"features":365}), or "reviewDays": null to mean it',
    );
    const meant = project({ knowledge: { reviewDays: null, folders: { planner: 'P.' } } });
    concept(meant, 'planner/a.md');
    expect(auditKnowledge(meant, join(meant, '.novadev')).notes.join('\n')).not.toContain('has no "reviewDays"');
  });

  test('a folder named like a whole number comes first in the map: that is how a JSON object keeps such keys', () => {
    const root = project({ knowledge: { reviewDays: THREE, folders: { planner: 'P.', '2026': 'The year.' } } });
    concept(root, 'planner/a.md');
    concept(root, '2026/a.md');
    expect(run(root, 'sync').code).toBe(0);
    expect(read(root, `${KNOWLEDGE}/index.md`)).toContain('* [2026](2026/index.md) - The year. (1 concept)\n* [planner](planner/index.md) - P. (1 concept)\n');
  });
});
