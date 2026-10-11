// The Open Knowledge Format layer (src/okf.ts): frontmatter, YAML values, actors, timestamps, trust,
// links, index files and log files — the format's own rules, with none of novadev's in them.
import { describe, expect, test } from 'bun:test';
import {
  actorKind,
  addDaysToTimestamp,
  appendLogEntry,
  conformanceProblems,
  indexProblems,
  isStale,
  isTimestamp,
  linkTargets,
  nowTimestamp,
  parseLog,
  readFrontmatterText,
  readGenerated,
  readSources,
  readStatus,
  readTags,
  readVerified,
  renderIndex,
  resolveBundleLink,
  setFrontmatterKeys,
  splitFrontmatter,
  timestampDay,
  trustTier,
  yamlFlowList,
  yamlFlowMap,
  yamlHint,
  yamlString,
} from '../src/okf.ts';

describe('frontmatter', () => {
  test('splits a text at its --- fences, with or without a byte order mark or CRLF', () => {
    expect(splitFrontmatter('---\ntype: A\n---\nBody\n')).toEqual({ header: 'type: A', body: 'Body\n' });
    expect(splitFrontmatter('\uFEFF---\r\ntype: A\r\n---\r\nBody')).toEqual({ header: 'type: A', body: 'Body' });
    expect(splitFrontmatter('---\n---\nBody')).toEqual({ header: '', body: 'Body' });
    expect(splitFrontmatter('# No frontmatter\n')).toBeNull();
    expect(splitFrontmatter('---\ntype: A\nnever closed\n')).toBeNull();
  });

  test('reads a YAML mapping; says why a broken one is broken', () => {
    const read = readFrontmatterText('---\ntype: Gotcha\ntags: [a, b]\ngenerated: { by: human:ada, at: 2026-10-11T09:00:00Z }\n---\nx');
    expect(read).toEqual({
      state: 'ok',
      data: { type: 'Gotcha', tags: ['a', 'b'], generated: { by: 'human:ada', at: '2026-10-11T09:00:00Z' } },
      header: 'type: Gotcha\ntags: [a, b]\ngenerated: { by: human:ada, at: 2026-10-11T09:00:00Z }',
      body: 'x',
    });
    expect(readFrontmatterText('no header')).toEqual({ state: 'none' });
    expect(readFrontmatterText('---\n- a list\n---\n')).toEqual({ state: 'invalid', error: 'the frontmatter is not a mapping of keys to values' });
    // YAML forbids a key twice; a parser would silently keep one of them.
    expect(readFrontmatterText('---\ntype: A\ntype: B\n---\n')).toEqual({ state: 'invalid', error: 'the key "type" is written twice' });
  });

  test('names the likeliest cause of a YAML error, with its line in the file', () => {
    const read = readFrontmatterText('---\ntype: Wiki Page\ndescription: Login: magic links only\n---\n');
    expect(read.state).toBe('invalid');
    expect(read.state === 'invalid' && read.error).toContain('line 3 ("description"): the value holds ": " — put the whole value in double quotes');
    expect(yamlHint('a: fine\nb: also #fine?')).toBe('line 3 ("b"): the value holds " #" — put the whole value in double quotes');
    expect(yamlHint('a:\n\t- b')).toBe('line 3: indented with a tab — YAML indents with spaces');
    expect(yamlHint('a: "quoted: fine"')).toBeNull();
  });

  test('sets keys in place: order, comments, other keys and the body are kept exactly', () => {
    const text = '---\ntype: Gotcha\n# a comment\ntags: [x]\nverified:\n  - { by: a/b, at: 2026-10-01T00:00:00Z }\nsources:\n- id: s\n  resource: todo:x\ncreated: 2026-10-01\n---\nBody.\n';
    const next = setFrontmatterKeys(text, {
      verified: '\n  - { by: a/b, at: 2026-10-01T00:00:00Z }\n  - { by: human:ada, at: 2026-10-11T09:00:00Z }',
      sources: null,
      generated: '{ by: a/b, at: 2026-10-11T09:00:00Z }',
    });
    expect(next).toBe(
      '---\ntype: Gotcha\n# a comment\ntags: [x]\nverified:\n  - { by: a/b, at: 2026-10-01T00:00:00Z }\n  - { by: human:ada, at: 2026-10-11T09:00:00Z }\ncreated: 2026-10-01\ngenerated: { by: a/b, at: 2026-10-11T09:00:00Z }\n---\nBody.\n',
    );
    expect(setFrontmatterKeys('---\r\ntype: A\r\n---\r\nBody\r\n', { status: 'deprecated' })).toBe('---\r\ntype: A\r\nstatus: deprecated\r\n---\r\nBody\r\n');
    expect(setFrontmatterKeys('no header', { type: 'A' })).toBeNull();
  });
});

describe('YAML values', () => {
  test('a string is written plain only when YAML reads it back as that same string', () => {
    for (const [value, written] of [
      ['plain words', 'plain words'],
      ['Login: magic links', '"Login: magic links"'],
      ['0.2', '"0.2"'],
      ['null', '"null"'],
      ['#tag', '"#tag"'],
      ['human:ada', 'human:ada'],
      ['2026-10-11T09:00:00+02:00', '2026-10-11T09:00:00+02:00'],
      ['', '""'],
    ] as const) {
      expect(yamlString(value)).toBe(written);
    }
    expect(yamlString('a, b')).toBe('a, b');
    expect(yamlString('a, b', true)).toBe('"a, b"'); // a comma would split a flow list
  });

  test('flow mappings and lists read back as what was written', () => {
    expect(yamlFlowMap([['by', 'human:ada'], ['at', '2026-10-11T09:00:00Z']])).toBe('{ by: human:ada, at: 2026-10-11T09:00:00Z }');
    expect(yamlFlowList(['src/a/', 'c,d', 'select all'])).toBe('[src/a/, "c,d", select all]');
    const read = readFrontmatterText(`---\nlist: ${yamlFlowList(['src/a/', 'c,d', 'select all'])}\n---\n`);
    expect(read.state === 'ok' && read.data.list).toEqual(['src/a/', 'c,d', 'select all']);
    expect(yamlFlowList([])).toBe('[]');
  });
});

describe('actors, timestamps, trust, lifecycle', () => {
  test('the actor convention: a person, a process, or a producer with its version', () => {
    expect(actorKind('human:ada')).toBe('human');
    expect(actorKind('process:finance-nightly')).toBe('process');
    expect(actorKind('reference_agent/gemini-2.5-pro')).toBe('tool');
    expect(actorKind('claude-code/claude-opus-5-5')).toBe('tool');
    for (const bad of ['ada', 'human:', 'human:a b', '/x', 42, null]) expect(actorKind(bad)).toBeNull();
  });

  test('a timestamp is an ISO 8601 datetime with an explicit offset that names a real moment', () => {
    for (const good of ['2026-06-30T14:00:00Z', '2026-10-11T09:30:00+02:00', '2026-10-11T09:30Z', '2026-10-11T09:30:00.5-05:00']) {
      expect(isTimestamp(good)).toBe(true);
    }
    for (const bad of ['2026-10-11', '2026-10-11T09:30:00', '2026-02-30T00:00:00Z', '2026-10-11T24:00:00Z', 20261011]) {
      expect(isTimestamp(bad)).toBe(false);
    }
    expect(timestampDay('2026-10-11T23:30:00+02:00')).toBe('2026-10-11');
  });

  test('now is written in this machine\'s offset, and moving by days keeps the offset', () => {
    const now = nowTimestamp();
    expect(isTimestamp(now)).toBe(true);
    expect(Math.abs(Date.parse(now) - Date.now())).toBeLessThan(5000);
    expect(addDaysToTimestamp('2026-10-11T23:30:00+02:00', 90)).toBe('2027-01-09T23:30:00+02:00');
    expect(addDaysToTimestamp('2026-12-31T00:00:00Z', 1)).toBe('2027-01-01T00:00:00Z');
  });

  test('generated, verified, status, tags: read, or refused in words', () => {
    expect(readGenerated({ by: 'human:ada', at: '2026-10-11T09:00:00Z' })).toEqual({ ok: true, value: { by: 'human:ada', at: '2026-10-11T09:00:00Z' } });
    expect(readGenerated({ by: 'x/y' })).toEqual({ ok: true, value: { by: 'x/y', at: null } });
    expect(readGenerated('yesterday')).toMatchObject({ ok: false });
    expect(readGenerated({ by: 'ada', at: '2026-10-11T09:00:00Z' })).toMatchObject({ ok: false, error: expect.stringContaining('"generated.by" must be an actor') });
    // A bare mapping is a one-element list — the spec asks every consumer to read it so.
    expect(readVerified({ by: 'human:ada', at: '2026-10-11T09:00:00Z' })).toEqual({ ok: true, value: [{ by: 'human:ada', at: '2026-10-11T09:00:00Z' }] });
    expect(readVerified([{ by: 'human:ada', at: '2026-10-11' }])).toMatchObject({ ok: false });
    expect(readStatus(undefined)).toEqual({ ok: true, value: 'stable' });
    expect(readStatus('shipped')).toMatchObject({ ok: false });
    expect(readTags(['a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(readTags('a, b')).toMatchObject({ ok: false, error: expect.stringContaining('YAML list') });
  });

  test('the trust tier comes from verified alone', () => {
    expect(trustTier([])).toBe('unverified');
    expect(trustTier([{ by: 'process:nightly', at: '2026-10-11T00:00:00Z' }, { by: 'a/b', at: '2026-10-11T00:00:00Z' }])).toBe('machine-confirmed');
    expect(trustTier([{ by: 'a/b', at: '2026-10-11T00:00:00Z' }, { by: 'human:ada', at: '2026-10-11T00:00:00Z' }])).toBe('human-reviewed');
  });

  test('stale is a plain comparison with an absolute instant', () => {
    expect(isStale(null)).toBe(false);
    expect(isStale('2000-01-01T00:00:00Z')).toBe(true);
    expect(isStale('2999-01-01T00:00:00Z')).toBe(false);
    expect(isStale('2026-10-11T12:00:00Z', new Date('2026-10-11T12:00:00Z'))).toBe(true);
  });

  test('sources: each entry names its resource; ids are unique; signals are typed', () => {
    expect(readSources([{ id: 'a', resource: 'todo:2026-10-11_1/01-x', title: 'T', author: 'team:docs', usage_count: 5, last_modified: '2026-10-01T00:00:00Z' }])).toMatchObject({ ok: true });
    expect(readSources([{ id: 'a' }])).toMatchObject({ ok: false, error: expect.stringContaining('needs a "resource"') });
    expect(readSources([{ id: 'a', resource: 'x' }, { id: 'a', resource: 'y' }])).toMatchObject({ ok: false, error: expect.stringContaining('used twice') });
    expect(readSources([{ resource: 'x', usage_count: -1 }])).toMatchObject({ ok: false });
    expect(readSources('todo:x')).toMatchObject({ ok: false });
  });
});

describe('links', () => {
  test('finds inline link targets, angle-bracketed ones and images included', () => {
    expect(linkTargets('see [a](x.md) and [b](<y z.md> "t") and ![i](p.png) and [c](https://e.x)')).toEqual(['x.md', 'y z.md', 'p.png', 'https://e.x']);
  });

  test('resolves a link to a path inside the bundle, or to nothing', () => {
    expect(resolveBundleLink('../features/x.md', 'wiki/a.md')).toBe('features/x.md');
    expect(resolveBundleLink('/wiki/b.md#part', 'memories/c.md')).toBe('wiki/b.md');
    expect(resolveBundleLink('b%20c.md', 'wiki/a.md')).toBe('wiki/b c.md');
    expect(resolveBundleLink('../../src/x.ts', 'wiki/a.md')).toBeNull(); // leaves the bundle
    expect(resolveBundleLink('https://e.x/a.md', 'a.md')).toBeNull();
    expect(resolveBundleLink('#anchor', 'a.md')).toBeNull();
  });
});

describe('index files', () => {
  test('render as headed sections of "* [Title](url) - description" entries; only a root index carries okf_version', () => {
    const text = renderIndex(
      [
        { heading: 'Wiki', entries: [{ title: 'Over [view]', href: 'wiki/overview.md', description: 'What it is.\nTwo lines.' }] },
        { heading: 'Empty', entries: [] },
      ],
      { okfVersion: '0.2', comment: 'derived' },
    );
    expect(text).toBe('---\nokf_version: "0.2"\n---\n\n<!-- derived -->\n\n# Wiki\n\n* [Over \\[view\\]](wiki/overview.md) - What it is. Two lines.\n\n# Empty\n');
    expect(indexProblems(text, true)).toEqual([]);
    expect(indexProblems(text, false)).toEqual(['an index file carries no frontmatter (only a bundle-root index may declare okf_version)']);
    expect(indexProblems('---\nokf_version: "0.2"\ntitle: x\n---\n', true)).toEqual(['a root index file may carry only an okf_version key in its frontmatter']);
    expect(indexProblems('# A\n\n| table | row |\n', false)).toEqual(['line 3 is neither a heading nor a "* [Title](url) - description" entry']);
  });
});

describe('log files', () => {
  test('read as ISO day sections, newest first, holding list entries with a leading bold word', () => {
    const read = parseLog('# Log\n\n## 2026-10-11\n\n* **Update**: [A](wiki/a.md) — x\n  more of it [B](b.md)\n- **Creation**: c\n\n## 2026-10-04\n* plain\n');
    expect(read.problems).toEqual([]);
    expect(read.sections.map((s) => s.date)).toEqual(['2026-10-11', '2026-10-04']);
    expect(read.entries.map((e) => [e.date, e.kind, e.links])).toEqual([
      ['2026-10-11', 'Update', ['wiki/a.md', 'b.md']],
      ['2026-10-11', 'Creation', []],
      ['2026-10-04', null, []],
    ]);
  });

  test('says what is wrong: a heading that is no ISO day, an entry under no day, days out of order or twice', () => {
    const read = parseLog('# Log\n* early\n## 2026-10-01\n* a\n## 2026-10-05\n* b\n## 2026-10-05\n## soon\n');
    expect(read.problems).toEqual([
      'line 2: an entry under no date heading — put it under "## <YYYY-MM-DD>"',
      'line 8: "## soon" — a date heading must be an ISO day, like "## 2026-10-11"',
      'line 5: 2026-10-05 comes after 2026-10-01 — the newest day goes first',
      'line 7: a second section for 2026-10-05 — keep one section per day',
    ]);
  });

  test('an entry goes under its day — a new day in date order — after the day\'s earlier entries', () => {
    let log = appendLogEntry('', '2026-10-04', '**Initialization**: started.', 'Knowledge log');
    log = appendLogEntry(log, '2026-10-11', '**Update**: one', 'Knowledge log');
    log = appendLogEntry(log, '2026-10-11', '**Update**: two', 'Knowledge log');
    log = appendLogEntry(log, '2026-10-08', '**Verification**: between', 'Knowledge log');
    expect(log).toBe(
      '# Knowledge log\n\n## 2026-10-11\n\n* **Update**: one\n* **Update**: two\n\n## 2026-10-08\n\n* **Verification**: between\n\n## 2026-10-04\n\n* **Initialization**: started.\n',
    );
    expect(parseLog(log).problems).toEqual([]);
    expect(appendLogEntry('# L\r\n\r\n## 2026-10-04\r\n\r\n* a\r\n', '2026-10-04', 'b', 'L')).toBe('# L\r\n\r\n## 2026-10-04\r\n\r\n* a\r\n* b\r\n');
  });
});

describe('conformance', () => {
  test('a concept needs parseable frontmatter with a type; index and log files follow their shapes', () => {
    expect(conformanceProblems('wiki/a.md', '---\ntype: Wiki Page\n---\n')).toEqual([]);
    expect(conformanceProblems('wiki/a.md', '# A\n')).toEqual(['no frontmatter — a concept opens with a `---` block that names its `type`']);
    expect(conformanceProblems('wiki/a.md', '---\ntitle: A\n---\n')).toEqual(['frontmatter has no `type` — every concept names its type']);
    expect(conformanceProblems('wiki/a.md', '---\ntype: [a\n---\n')[0]).toStartWith('frontmatter is not valid YAML');
    expect(conformanceProblems('log.md', '# Log\n\n## yesterday\n')).toEqual(['line 3: "## yesterday" — a date heading must be an ISO day, like "## 2026-10-11"']);
    expect(conformanceProblems('log.md', '---\ntype: Log\n---\n')).toEqual(['a log file carries no frontmatter']);
    expect(conformanceProblems('index.md', '---\nokf_version: "0.2"\n---\n# A\n')).toEqual([]);
  });
});
