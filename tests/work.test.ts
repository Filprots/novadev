// `novadev work` — the lock of a batch in work — and what status, sync, doctor, archive, deploy and
// file-todo do with it.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { SKILLS, WORK_LOCK_FILE } from '../src/lib.ts';
import { nowTimestamp } from '../src/okf.ts';
import { STALE_AFTER_MINUTES, latestLine, parseEntries, readWorkLock, renderLock, sanitizeNote, type WorkLock } from '../src/work.ts';
import { REPO, commitAll, completed, exists, git, project, read, run, todo, write } from './helpers.ts';

const BATCH = '2026-10-01_1';
const AGENT = 'claude-code/test';
/** A process id no machine has: above every Linux pid_max, so `kill(pid, 0)` says ESRCH. */
const NO_SUCH_PID = 2147483646;

/** A project with one open batch of two todos. */
function batchProject(): string {
  const root = project();
  todo(root, `${BATCH}/01-a`);
  todo(root, `${BATCH}/02-b`);
  return root;
}

/** The same, with the playbooks and adapters deployed: what `novadev doctor` calls healthy. */
function deployedBatchProject(): string {
  const root = batchProject();
  expect(run(root, 'deploy').code).toBe(0);
  return root;
}

function payload(root: string, name: string, value: unknown): string {
  write(root, name, JSON.stringify(value));
  return join(root, name);
}

function lockText(root: string, batch = BATCH): string {
  return read(root, `.novadev/todos/${batch}/${WORK_LOCK_FILE}`);
}

function json(result: { stdout: string }): Record<string, any> {
  return JSON.parse(result.stdout);
}

function start(root: string, ...extra: string[]) {
  return run(root, 'work', 'start', BATCH, '--agent', AGENT, ...extra);
}

/** A lock written as another session would have left it. */
function foreignLock(
  root: string,
  o: { state?: 'working' | 'paused'; host?: string; pid?: number | null; session?: string | null; minutesAgo?: number; todo?: string | null; body?: string } = {},
): void {
  const updated = nowTimestamp(new Date(Date.now() - (o.minutesAgo ?? 1) * 60000));
  const lock: WorkLock = {
    batch: BATCH,
    path: join(root, '.novadev/todos', BATCH, WORK_LOCK_FILE),
    state: o.state ?? 'working',
    agent: 'claude-code/other',
    host: o.host ?? 'elsewhere',
    pid: o.pid === undefined ? null : o.pid,
    session: o.session === undefined ? 'session-of-another' : o.session,
    started: updated,
    updated,
    resumed: null,
    todo: o.todo === undefined ? '01-a' : o.todo,
    phase: 3,
    entries: [{ kind: 'waypoint', number: 1, heading: `## Waypoint 1 — ${updated.slice(0, 16).replace('T', ' ')} · 01-a · phase 3 WORK`, body: o.body ?? 'Halfway through.' }],
  };
  write(root, `.novadev/todos/${BATCH}/${WORK_LOCK_FILE}`, renderLock(lock));
}

describe('novadev work start', () => {
  test('takes the lock: who, where, since when — and the batch shows as in work', () => {
    const root = batchProject();
    const result = start(root);
    expect(result.code).toBe(0);
    expect(json(result)).toMatchObject({
      batch: BATCH,
      path: `.novadev/todos/${BATCH}/working.md`,
      state: 'working',
      taken: true,
      resumed: false,
      from: null,
      agent: AGENT,
      todo: null,
      phase: null,
      latest: null,
      todos: [
        { todo: '01-a', state: 'open' },
        { todo: '02-b', state: 'open' },
      ],
    });
    const text = lockText(root);
    expect(text.startsWith('---\nstate: working\nagent: claude-code/test\nhost: ' + hostname() + '\n')).toBe(true);
    expect(text).toMatch(/\nstarted: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\nupdated: /);
    expect(text).toContain(`# Working — ${BATCH}`);
    expect(text).toContain('Never edit it by hand');
    const lock = readWorkLock(join(root, '.novadev'), BATCH);
    expect(lock?.state).toBe('ok');
    if (lock?.state === 'ok') {
      expect(lock.lock.entries).toEqual([]);
      // A session the harness names, or the process this test runs under: never nothing.
      expect(lock.lock.pid !== null || lock.lock.session !== null).toBe(true);
    }

    const status = run(root, 'status').stdout;
    expect(status).toContain('in work — 1 batch(es)');
    expect(status).toContain(`● ${BATCH} — WORKING: claude-code/test on ${hostname()}`);
    expect(status).toContain('last waypoint just now');
    expect(status).toContain(`  ${BATCH}  [in work]`);
  });

  test('the same session starting again only refreshes the lock', () => {
    const root = batchProject();
    start(root);
    const again = json(start(root));
    expect(again).toMatchObject({ taken: true, resumed: false, from: 'same-session' });
    expect(lockText(root)).not.toContain('resumed:');
  });

  test('refuses what is not a batch, a batch that is not there, a finished batch, and a bad actor', () => {
    const root = batchProject();
    expect(json(run(root, 'work', 'start', 'nope'))).toEqual({ error: '"nope" is not a batch name (YYYY-MM-DD_N).' });
    expect(json(run(root, 'work', 'start', '2026-10-01_9'))).toEqual({ error: `No batch todos/2026-10-01_9. Open batches: ${BATCH}.` });
    expect(json(run(root, 'work', 'start'))).toMatchObject({ error: expect.stringContaining('usage: novadev work start <batch>') });
    expect(json(run(root, 'work', 'start', BATCH, '--agent', 'not an actor'))).toMatchObject({ error: expect.stringContaining('"--agent" must be an actor') });
    expect(exists(root, `.novadev/todos/${BATCH}/working.md`)).toBe(false);

    write(root, `.novadev/todos/${BATCH}/completed.md`, '---\ncompleted: 2026-10-01\n---\n');
    const finished = run(root, 'work', 'start', BATCH);
    expect(finished.code).toBe(1);
    expect(json(finished)).toEqual({
      error: `Batch ${BATCH} is finished (completed.md) — a new request gets a new batch (\`novadev new\`, or \`novadev file-todo\`).`,
    });
  });

  test('accepts the batch as a path too, and "human" as the agent git knows', () => {
    const root = batchProject();
    commitAll(root);
    git(root, 'config', 'user.name', 'Nova Dev');
    const result = json(run(root, 'work', 'start', `.novadev/todos/${BATCH}/`, '--agent', 'human'));
    expect(result).toMatchObject({ batch: BATCH, agent: 'human:nova-dev' });
  });

  test('without --agent the lock says agent/unknown', () => {
    const root = batchProject();
    expect(json(run(root, 'work', 'start', BATCH)).agent).toBe('agent/unknown');
  });

  test('a paused lock is resumed, and the answer carries the pause record', () => {
    const root = batchProject();
    start(root);
    const pause = json(run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { todo: '02-b', phase: 4, stopped: 'In the middle of b.', next: ['finish b'] })));
    expect(pause).toMatchObject({ state: 'paused', waypoint: 1, todo: '02-b', phase: 4 });

    const resumed = json(start(root));
    expect(resumed).toMatchObject({
      taken: true,
      resumed: true,
      from: 'paused',
      state: 'working',
      previous: { state: 'paused', agent: AGENT },
      todo: '02-b',
      phase: 4,
      latest: { kind: 'pause', waypoint: 1 },
    });
    expect(resumed.latest.text).toContain('### Stopped at\n\nIn the middle of b.');
    expect(lockText(root)).toMatch(/^state: working$/m);
    expect(lockText(root)).toMatch(/^resumed: \d{4}/m);
  });

  test('a lock held by a live session elsewhere is refused, and taken over with --take', () => {
    const root = batchProject();
    foreignLock(root, { minutesAgo: 5 });
    const refused = start(root);
    expect(refused.code).toBe(1);
    expect(json(refused)).toEqual({
      error: `Batch ${BATCH} is in work: claude-code/other on elsewhere, last waypoint 5 min ago, at 01-a · phase 3 WORK. If that session is gone, pass --take to take the lock over.`,
    });
    expect(lockText(root)).toContain('agent: claude-code/other');

    const taken = json(start(root, '--take'));
    expect(taken).toMatchObject({ taken: true, resumed: true, from: 'taken', agent: AGENT, previous: { agent: 'claude-code/other', host: 'elsewhere' } });
    expect(taken.latest).toMatchObject({ kind: 'waypoint', waypoint: 1, text: 'Halfway through.' });
    expect(lockText(root)).toContain(`agent: ${AGENT}`);
  });

  test('a lock with no waypoint for two hours is abandoned: taken over on its own', () => {
    const root = batchProject();
    foreignLock(root, { minutesAgo: STALE_AFTER_MINUTES + 1 });
    expect(json(start(root))).toMatchObject({ resumed: true, from: 'stale' });
  });

  test('on this host the process decides: gone means abandoned, whatever the heartbeat says', () => {
    const root = batchProject();
    foreignLock(root, { host: hostname(), pid: NO_SUCH_PID, session: null, minutesAgo: 1 });
    const status = run(root, 'status').stdout;
    expect(status).toContain(`✗ ${BATCH} — ABANDONED: claude-code/other on ${hostname()} (process ${NO_SUCH_PID}, gone) — its process is gone — at 01-a · phase 3 WORK: "Halfway through."`);
    expect(json(start(root))).toMatchObject({ resumed: true, from: 'process-gone' });
  });

  test('an unreadable lock stops start, and says what to do', () => {
    const root = batchProject();
    write(root, `.novadev/todos/${BATCH}/working.md`, '---\nstate: busy\nstarted: 2026-10-01T00:00:00Z\nupdated: 2026-10-01T00:00:00Z\n---\n');
    expect(json(start(root))).toEqual({
      error: `todos/${BATCH}/working.md cannot be read: "state" must be working or paused, not "busy" — fix it, or delete it and start again.`,
    });
  });
});

describe('novadev work waypoint', () => {
  test('needs the lock, a note, a todo of the batch and a real phase', () => {
    const root = batchProject();
    const wp = payload(root, 'wp.json', { note: 'x' });
    expect(json(run(root, 'work', 'waypoint', BATCH, wp))).toEqual({ error: `Batch ${BATCH} is not in work — \`novadev work start ${BATCH}\` first.` });
    start(root);
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'a.json', {})))).toEqual({ error: "The payload needs 'note'." });
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'b.json', { note: 'x', todo: '03-c' })))).toEqual({
      error: `Todo "03-c" is not in batch ${BATCH} (its todos: 01-a, 02-b).`,
    });
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'c.json', { note: 'x', phase: 11 })))).toMatchObject({
      error: expect.stringContaining("'phase' must be a loop phase, 0 to 10"),
    });
    expect(json(run(root, 'work', 'waypoint', BATCH, 'missing.json'))).toMatchObject({ error: expect.stringContaining('No payload file at') });
    expect(json(run(root, 'work', 'waypoint', BATCH))).toMatchObject({ error: expect.stringContaining('usage:') });
    expect(lockText(root)).not.toContain('## Waypoint');
  });

  test('writes the trail newest first, numbered, and the last todo and phase into the header', () => {
    const root = batchProject();
    start(root);
    const first = json(run(root, 'work', 'waypoint', BATCH, payload(root, 'w1.json', { todo: '01-a', phase: 3, note: 'Reading the module.' })));
    expect(first).toMatchObject({ batch: BATCH, state: 'working', waypoint: 1, todo: '01-a', phase: 3 });
    // The next one says nothing about where: it is still 01-a, phase 3.
    const second = json(run(root, 'work', 'waypoint', BATCH, payload(root, 'w2.json', { note: 'Found it: the cache.' })));
    expect(second).toMatchObject({ waypoint: 2, todo: '01-a', phase: 3 });
    const third = json(run(root, 'work', 'waypoint', BATCH, payload(root, 'w3.json', { todo: `${BATCH}/02-b`, phase: '4', note: 'Recording b.' })));
    expect(third).toMatchObject({ waypoint: 3, todo: '02-b', phase: 4 });

    const text = lockText(root);
    expect(text).toMatch(/^todo: 02-b\nphase: 4\n---/m);
    const headings = text.split('\n').filter((line) => line.startsWith('## '));
    expect(headings.map((h) => h.replace(/ — \d{4}-\d{2}-\d{2} \d{2}:\d{2}/, ''))).toEqual([
      '## Waypoint 3 · 02-b · phase 4 RECORD',
      '## Waypoint 2 · 01-a · phase 3 WORK',
      '## Waypoint 1 · 01-a · phase 3 WORK',
    ]);
    expect(text.indexOf('Recording b.')).toBeLessThan(text.indexOf('Found it: the cache.'));
    expect(text.endsWith('Reading the module.\n')).toBe(true);
    expect(text).not.toContain('\n\n\n');

    const lock = readWorkLock(join(root, '.novadev'), BATCH);
    expect(lock?.state === 'ok' && lock.lock.entries.map((e) => [e.number, e.body])).toEqual([[3, 'Recording b.'], [2, 'Found it: the cache.'], [1, 'Reading the module.']]);
    expect(run(root, 'status').stdout).toContain(`— at 02-b · phase 4 RECORD: "Recording b."`);
  });

  test('a note cannot pose as an entry or swallow the ones below it', () => {
    expect(sanitizeNote('a\n## Waypoint 9 — 2026-10-01 10:00\n# title\n### fine\n```\n# code\n')).toBe('a\n\\## Waypoint 9 — 2026-10-01 10:00\n\\# title\n### fine\n```\n# code\n```');
    expect(sanitizeNote('  ## x')).toBe('\\## x');
    expect(sanitizeNote('~~~~\nopen\n')).toBe('~~~~\nopen\n~~~~');

    const root = batchProject();
    start(root);
    run(root, 'work', 'waypoint', BATCH, payload(root, 'w1.json', { note: 'first' }));
    run(root, 'work', 'waypoint', BATCH, payload(root, 'w2.json', { note: '## Waypoint 7 — 2026-10-01 10:00 · 01-a\n```sh\nnovadev sync\n' }));
    const lock = readWorkLock(join(root, '.novadev'), BATCH);
    expect(lock?.state === 'ok' && lock.lock.entries.map((e) => e.number)).toEqual([2, 1]);
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'w3.json', { note: 'third' }))).waypoint).toBe(3);
  });

  test('a waypoint on a paused batch is refused — start resumes it first', () => {
    const root = batchProject();
    start(root);
    run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { stopped: 'here', next: 'there' }));
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'w.json', { note: 'x' })))).toEqual({
      error: `Batch ${BATCH} is paused — \`novadev work start ${BATCH}\` resumes it first.`,
    });
  });

  test('a note over the limit is refused', () => {
    const root = batchProject();
    start(root);
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'w.json', { note: 'x'.repeat(20001) })))).toEqual({
      error: "'note' is over 20000 characters — put the detail in the todo's ai_progress.md and refer to it.",
    });
  });
});

describe('novadev work pause', () => {
  test('needs where it stopped and what comes next', () => {
    const root = batchProject();
    start(root);
    expect(json(run(root, 'work', 'pause', BATCH, payload(root, 'a.json', { next: ['x'] })))).toEqual({ error: "The payload needs 'stopped'." });
    expect(json(run(root, 'work', 'pause', BATCH, payload(root, 'b.json', { stopped: 'x' })))).toEqual({
      error: "The payload needs 'next': a list of the steps to take when the work resumes.",
    });
    expect(json(run(root, 'work', 'pause', BATCH, payload(root, 'c.json', { stopped: 'x', next: [] })))).toMatchObject({ error: expect.stringContaining("'next'") });
    expect(json(run(root, 'work', 'pause', BATCH, payload(root, 'd.json', { stopped: 'x', next: 'y', done: 3 })))).toEqual({ error: "'done' must be text." });
    expect(lockText(root)).toMatch(/^state: working$/m);
  });

  test('writes the pause record: the sections, the numbered steps, the todos — and the git tree', () => {
    const root = batchProject();
    start(root);
    run(root, 'work', 'waypoint', BATCH, payload(root, 'w.json', { todo: '01-a', phase: 3, note: 'on a' }));
    todo(root, `${BATCH}/01-a`, { 'ai_completed.md': completed('01-a') });
    // Everything so far is committed; what the pause finds uncommitted is the code and its own payload.
    commitAll(root, 'base');
    write(root, 'src/theme.ts', 'export const x = 1;\n');
    const result = json(
      run(
        root,
        'work',
        'pause',
        BATCH,
        payload(root, 'p.json', {
          todo: '02-b',
          phase: 4,
          stopped: 'In `src/theme.ts`: the toggle never flips.\n## not a heading',
          next: ['check the provider', 'finish ai_progress.md\nthen sync'],
          done: '01-a recorded.',
          resume: 'bun dev',
          open: 'Persist per user?',
        }),
      ),
    );
    expect(result).toMatchObject({
      batch: BATCH,
      state: 'paused',
      waypoint: 2,
      todo: '02-b',
      phase: 4,
      tree: { branch: 'master', uncommitted: 2 },
      todos: [
        { todo: '01-a', state: 'completed' },
        { todo: '02-b', state: 'open' },
      ],
    });
    expect(result.tree.head).toMatch(/^[0-9a-f]{7,}$/);

    const text = lockText(root);
    expect(text).toMatch(/^state: paused$/m);
    expect(text).toMatch(/^## PAUSED — waypoint 2 — \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 02-b · phase 4 RECORD$/m);
    expect(text).toContain(`**By:** ${AGENT} on ${hostname()}\n\n**Tree at the pause:** branch \`master\`, HEAD \`${result.tree.head}\` — 2 uncommitted path(s):\n- \`??\` p.json\n- \`??\` src/\n`);
    expect(text).toContain('### Stopped at\n\nIn `src/theme.ts`: the toggle never flips.\n\\## not a heading\n\n### Next\n\n1. check the provider\n2. finish ai_progress.md\n   then sync\n\n### Done\n\n01-a recorded.\n\n### To resume\n\nbun dev\n\n### Open\n\nPersist per user?\n\n### Todos at the pause\n\n- ✓ 01-a — completed\n- · 02-b — open\n\n## Waypoint 1');
    const lock = readWorkLock(join(root, '.novadev'), BATCH);
    expect(lock?.state === 'ok' && latestLine(lock.lock)).toBe('In `src/theme.ts`: the toggle never flips.');
  });

  test('a clean tree says so, and without git the tree line is left out', () => {
    const root = batchProject();
    commitAll(root, 'base');
    start(root);
    commitAll(root, 'the lock');
    run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { stopped: 'x', next: 'y' }));
    expect(lockText(root)).toContain('**Tree at the pause:** branch `master`, HEAD `');
    expect(lockText(root)).toMatch(/ — 1 uncommitted path\(s\):\n- `\?\?` p\.json\n/);

    const plain = batchProject();
    start(plain);
    const result = json(run(plain, 'work', 'pause', BATCH, payload(plain, 'p.json', { stopped: 'x', next: 'y' })));
    expect('tree' in result).toBe(false);
    expect(lockText(plain)).not.toContain('Tree at the pause');
    expect(lockText(plain)).toContain(`**By:** ${AGENT} on ${hostname()}\n\n### Stopped at`);
  });

  test('a paused batch waits on the human in sync and status, and is never complete', () => {
    const root = batchProject();
    todo(root, `${BATCH}/01-a`, { 'ai_completed.md': completed('01-a') });
    todo(root, `${BATCH}/02-b`, { 'ai_completed.md': completed('02-b') });
    start(root);
    run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { todo: '02-b', phase: 9, stopped: 'The wiki page is half written.', next: ['finish wiki/architecture.md', 'novadev sync'] }));

    const sync = run(root, 'sync');
    expect(sync.code).toBe(0);
    expect(sync.stdout).toContain(`in work (1):\n  ‖ ${BATCH} — PAUSED `);
    expect(sync.stdout).toContain(`WAITING ON THE HUMAN (1):\n  ⧗ ${BATCH} is PAUSED (`);
    expect(sync.stdout).toContain(`, at 02-b · phase 9 DOCUMENT) — \`/novadev-work\` resumes it from todos/${BATCH}/working.md`);
    expect(sync.stdout).not.toContain('NEXT ACTIONS');
    expect(sync.stdout).toContain("sync: clean — everything left is the human's to do.");
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(false);
    expect(run(root, 'sync', '--check').code).toBe(0);

    const status = run(root, 'status').stdout;
    expect(status).toContain(`‖ ${BATCH} — PAUSED `);
    expect(status).toContain(`by ${AGENT} — at 02-b · phase 9 DOCUMENT: "The wiki page is half written."`);
    expect(status).toContain('→ a paused batch resumes with `/novadev-work`');
    expect(status).toContain(`  ${BATCH}  [paused]`);
    expect(status).not.toContain('[ready to archive]');

    const archive = run(root, 'archive', BATCH);
    expect(archive.code).toBe(1);
    expect(archive.stderr).toContain(`batch ${BATCH} is in work (working.md) — the round on it is not over. Release the lock first: \`novadev work stop ${BATCH}\``);
    expect(exists(root, `.novadev/todos/${BATCH}/working.md`)).toBe(true);
  });

  test('pausing again adds a second pause record', () => {
    const root = batchProject();
    start(root);
    run(root, 'work', 'pause', BATCH, payload(root, 'p1.json', { stopped: 'first stop', next: 'a' }));
    expect(json(run(root, 'work', 'pause', BATCH, payload(root, 'p2.json', { stopped: 'second stop', next: 'b' })))).toMatchObject({ waypoint: 2 });
    expect(lockText(root).indexOf('second stop')).toBeLessThan(lockText(root).indexOf('first stop'));
  });
});

describe('novadev work stop', () => {
  test('releases the lock, and says which todos are not finished', () => {
    const root = batchProject();
    expect(json(run(root, 'work', 'stop', BATCH))).toEqual({ error: `Batch ${BATCH} is not in work — there is no lock to release.` });
    start(root);
    run(root, 'work', 'waypoint', BATCH, payload(root, 'w.json', { note: 'x' }));
    todo(root, `${BATCH}/01-a`, { 'ai_completed.md': completed('01-a') });
    const stopped = json(run(root, 'work', 'stop', BATCH));
    expect(stopped).toEqual({
      batch: BATCH,
      state: 'released',
      path: `.novadev/todos/${BATCH}/working.md`,
      wasPaused: false,
      waypoints: 1,
      unfinished: ['02-b'],
      note: 'these todos are not recorded as finished — a pause keeps the resume point; a stop does not',
      todos: [
        { todo: '01-a', state: 'completed' },
        { todo: '02-b', state: 'open' },
      ],
    });
    expect(exists(root, `.novadev/todos/${BATCH}/working.md`)).toBe(false);
    expect(run(root, 'status').stdout).toContain('in work — none (no batch is locked;');
  });

  test('once released, a fully recorded batch is complete again', () => {
    const root = batchProject();
    todo(root, `${BATCH}/01-a`, { 'ai_completed.md': completed('01-a') });
    todo(root, `${BATCH}/02-b`, { 'ai_completed.md': completed('02-b') });
    start(root);
    const working = run(root, 'sync');
    expect(working.stdout).toContain(`● ${BATCH} — WORKING: `);
    expect(working.stdout).toContain(`— every todo is recorded: \`novadev work stop ${BATCH}\` closes the round`);
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(false);
    expect(json(run(root, 'work', 'stop', BATCH))).toMatchObject({ state: 'released', wasPaused: false });
    expect(run(root, 'sync').stdout).toContain(`✓ ${BATCH} — done `);
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(true);
  });

  test('a live lock of another session is refused without --take; an unreadable one is removed and reported', () => {
    const root = batchProject();
    foreignLock(root, { minutesAgo: 3 });
    expect(json(run(root, 'work', 'stop', BATCH))).toEqual({
      error: `Batch ${BATCH} is in work: claude-code/other on elsewhere, last waypoint 3 min ago. If that session is gone, pass --take to release the lock anyway.`,
    });
    expect(json(run(root, 'work', 'stop', BATCH, '--take'))).toMatchObject({ state: 'released', waypoints: 1 });

    write(root, `.novadev/todos/${BATCH}/working.md`, 'not a lock\n');
    expect(json(run(root, 'work', 'stop', BATCH))).toMatchObject({ state: 'released', unreadable: 'no frontmatter header' });
    expect(exists(root, `.novadev/todos/${BATCH}/working.md`)).toBe(false);
  });

  test('a stale lock is released without --take', () => {
    const root = batchProject();
    foreignLock(root, { minutesAgo: STALE_AFTER_MINUTES + 5 });
    expect(json(run(root, 'work', 'stop', BATCH))).toMatchObject({ state: 'released' });
  });
});

describe('what the rest of novadev does with a lock', () => {
  test('an abandoned lock is a NEXT ACTION in sync and a note in doctor', () => {
    const root = deployedBatchProject();
    foreignLock(root, { minutesAgo: STALE_AFTER_MINUTES + 30 });
    const sync = run(root, 'sync');
    expect(sync.code).toBe(0);
    expect(sync.stdout).toContain(`✗ ${BATCH} — ABANDONED: claude-code/other on elsewhere — no waypoint for 2 h 30 min — at 01-a · phase 3 WORK: "Halfway through."`);
    expect(sync.stdout).toContain(
      `→ ${BATCH} is locked by claude-code/other on elsewhere, but no waypoint for 2 h 30 min (last waypoint `,
    );
    expect(sync.stdout).toContain(`, at 01-a · phase 3 WORK) — resume it (\`novadev work start ${BATCH}\` reads its last waypoint) or release it (\`novadev work stop ${BATCH}\`)`);
    expect(sync.stdout).not.toContain('WAITING ON THE HUMAN');
    const doctor = run(root, 'doctor');
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain(`· ${BATCH} is locked by claude-code/other on elsewhere, but no waypoint for 2 h 30 min`);
  });

  test('a live lock is only reported: no action, no failure', () => {
    const root = deployedBatchProject();
    start(root);
    const sync = run(root, 'sync');
    expect(sync.stdout).toContain(`in work (1):\n  ● ${BATCH} — WORKING: ${AGENT} on ${hostname()}`);
    expect(sync.stdout).not.toContain('is locked by');
    expect(run(root, 'sync', '--check').code).toBe(0);
    expect(run(root, 'doctor').stdout.trim()).toBe('doctor: structure is healthy.');
  });

  test('an unreadable lock is a problem for sync, --check and doctor; a stray todo name is a note', () => {
    const root = batchProject();
    write(root, `.novadev/todos/${BATCH}/working.md`, '---\nstate: working\nstarted: yesterday\nupdated: 2026-10-01T00:00:00Z\n---\n');
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stdout).toContain(
      `✗ todos/${BATCH}/working.md: "started" must be an ISO 8601 datetime with an offset — fix it, or delete it and \`novadev work start ${BATCH}\` again`,
    );
    expect(run(root, 'sync', '--check').code).toBe(1);
    const status = run(root, 'status').stdout;
    expect(status).toContain(`⚠ todos/${BATCH}/working.md: "started" must be`);
    expect(status).toContain(`  ${BATCH}  [lock unreadable]`);
    const doctor = run(root, 'doctor');
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toContain(`✗ todos/${BATCH}/working.md: "started" must be an ISO 8601 datetime`);

    write(root, `.novadev/todos/${BATCH}/working.md`, '---\nstate: working\n<<<<<<< HEAD\nagent: a\n=======\nagent: b\n>>>>>>> other\nstarted: 2026-10-01T00:00:00Z\nupdated: 2026-10-01T00:00:00Z\n---\n');
    expect(run(root, 'doctor').stdout).toContain(`✗ todos/${BATCH}/working.md: it holds a merge conflict`);

    foreignLock(root, { todo: '09-gone' });
    expect(run(root, 'doctor').stdout).toContain(`· todos/${BATCH}/working.md: its last waypoint names todo "09-gone", which is not in the batch`);
  });

  test('a lock reopens a batch that was marked complete, and doctor says so', () => {
    const root = batchProject();
    todo(root, `${BATCH}/01-a`, { 'ai_completed.md': completed('01-a') });
    todo(root, `${BATCH}/02-b`, { 'ai_completed.md': completed('02-b') });
    run(root, 'sync');
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(true);
    foreignLock(root, { minutesAgo: 1 });
    expect(run(root, 'doctor').stdout).toContain(`· todos/${BATCH}/working.md: the batch also carries completed.md — \`novadev sync\` reopens it while the lock exists`);
    run(root, 'sync');
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(false);
  });

  test('file-todo never files into a batch somebody is working', () => {
    const root = project();
    const filed = json(run(root, 'file-todo', 'file', payload(root, 'f1.json', { parts: [{ slug: 'one', title: 'One', request: 'do one' }] })));
    const batch = (filed.filed[0].ref as string).split('/')[0]!;
    expect(json(run(root, 'file-todo', 'plan'))).toMatchObject({ batch, reused: true, nextNumber: 2 });
    expect(run(root, 'work', 'start', batch, '--agent', AGENT).code).toBe(0);
    expect(json(run(root, 'file-todo', 'plan'))).toMatchObject({ reused: false, nextNumber: 1 });
    expect(json(run(root, 'file-todo', 'plan')).batch).not.toBe(batch);
  });

  test('the lock parses back exactly as it was rendered', () => {
    const body = '\n# Working — x\n\n<!-- c -->\n\n## Waypoint 2 — 2026-10-01 10:05 · 01-a · phase 3 WORK\n\nTwo\nlines\n\n```md\n## Waypoint 9 — 2026-10-01 10:00\n```\n\n## Waypoint 1 — 2026-10-01 10:00\n\nOne\n';
    expect(parseEntries(body)).toEqual([
      { kind: 'waypoint', number: 2, heading: '## Waypoint 2 — 2026-10-01 10:05 · 01-a · phase 3 WORK', body: 'Two\nlines\n\n```md\n## Waypoint 9 — 2026-10-01 10:00\n```' },
      { kind: 'waypoint', number: 1, heading: '## Waypoint 1 — 2026-10-01 10:00', body: 'One' },
    ]);
    expect(parseEntries('## PAUSED — waypoint 3 — 2026-10-01 10:00 · 02-b\n\n**By:** a on b\n\n### Stopped at\n\nhere\n')[0]).toMatchObject({ kind: 'pause', number: 3 });
    expect(parseEntries('')).toEqual([]);
  });
});

describe('the pause playbook', () => {
  test('deploy writes it and its adapter, and doctor checks it like the others', () => {
    const root = project();
    expect(run(root, 'deploy').code).toBe(0);
    expect(SKILLS.map((s) => s.slug)).toContain('novadev-pause');
    expect(read(root, '.novadev/skills/novadev-pause.md')).toContain('# novadev-pause — stop the loop where it is');
    expect(read(root, '.claude/skills/novadev-pause/SKILL.md')).toContain('name: novadev-pause');
    expect(read(root, 'CLAUDE.md')).toContain('`/novadev-pause`');
    expect(read(root, 'CLAUDE.md')).toContain('**A batch in work is locked.**');
    expect(read(root, '.cursor/rules/novadev.mdc')).toContain('novadev work start <batch>');
    expect(run(root, 'doctor').stdout.trim()).toBe('doctor: structure is healthy.');
    write(root, '.novadev/skills/novadev-pause.md', 'edited\n');
    expect(run(root, 'doctor').stdout).toContain('skills/novadev-pause.md: differs from installed novadev');
  });

  test('the docs teach the lock: the playbook, the pause skill, the folder READMEs, the README, the CLI help', () => {
    const playbook = readFileSync(join(REPO, 'templates/skills/novadev-work.md'), 'utf8');
    for (const phrase of ['novadev work start', 'novadev work waypoint', 'novadev work stop', '/novadev-pause', '`working.md`', 'Waypoint', 'Taking the lock', '--take']) {
      expect(playbook).toContain(phrase);
    }
    const pause = readFileSync(join(REPO, 'templates/skills/novadev-pause.md'), 'utf8');
    for (const phrase of ['novadev work pause', '"stopped"', '"next"', '"done"', '"resume"', '"open"', 'ai_progress.md', 'Never edit `working.md` by hand', 'Never stop instead of pausing']) {
      expect(pause).toContain(phrase);
    }
    expect(readFileSync(join(REPO, 'templates/readmes/todos.md'), 'utf8')).toContain('`working.md`');
    expect(readFileSync(join(REPO, 'templates/readmes/root.md'), 'utf8')).toContain('/novadev-pause');
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
    for (const phrase of ['## Work in progress', 'todos/<batch>/working.md', 'novadev work start', 'novadev work waypoint', 'novadev work pause', 'novadev work stop', '`/novadev-pause`', 'CLAUDE_PID', '--take', 'two hours']) {
      expect(readme).toContain(phrase);
    }
    const help = run(project(), 'help').stdout;
    expect(help).toContain('novadev work …');
    expect(help).toContain('/novadev-pause');
  });
});
