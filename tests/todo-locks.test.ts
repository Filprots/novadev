// The todo is the unit of work (batch 2026-11-12_2, todo 02): `novadev work start <batch>/<todo>` locks
// ONE todo, its lock and waypoints live in the todo's folder, and the batch only groups — what
// status, sync, `todo list`, the registry, the worktree command and a merge do with such locks.
// `work start <batch>` for one developer taking the whole batch is the last block; the locks 0.17.0
// and earlier wrote are in old-locks.test.ts.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { nowTimestamp } from '../src/okf.ts';
import { readWorkLock, renderLock, type WorkLock } from '../src/work.ts';
import { REPO, commitAll, completed, exists, feature, git, project, read, run, tempDir, todo, write } from './helpers.ts';

const BATCH = '2026-11-12_2';
const AGENT = 'claude-code/test';
const LOCK_01 = `.novadev/todos/${BATCH}/01-a/working.md`;
const LOCK_02 = `.novadev/todos/${BATCH}/02-b/working.md`;

/** A project with one open batch of three todos. */
function batchProject(manifest: Record<string, unknown> = {}): string {
  const root = project(manifest);
  todo(root, `${BATCH}/01-a`);
  todo(root, `${BATCH}/02-b`);
  todo(root, `${BATCH}/03-c`);
  return root;
}

function json(result: { stdout: string }): Record<string, any> {
  return JSON.parse(result.stdout);
}

function payload(root: string, name: string, value: unknown): string {
  write(root, name, JSON.stringify(value));
  return join(root, name);
}

function quiet(repo: string): void {
  git(repo, 'config', 'user.name', 'novadev tests');
  git(repo, 'config', 'user.email', 'novadev@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', '/dev/null');
}

function commit(repo: string, message: string): void {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

/** A todo's lock as another session, on another machine, would have left it. */
function foreignTodoLock(root: string, todoName: string, o: { state?: 'working' | 'paused'; minutesAgo?: number } = {}): void {
  const updated = nowTimestamp(new Date(Date.now() - (o.minutesAgo ?? 1) * 60000));
  const lock: WorkLock = {
    batch: BATCH,
    unit: 'todo',
    path: join(root, '.novadev/todos', BATCH, todoName, 'working.md'),
    state: o.state ?? 'working',
    agent: 'claude-code/other',
    host: 'elsewhere',
    pid: null,
    session: 'session-of-another',
    started: updated,
    updated,
    resumed: null,
    todo: todoName,
    phase: 3,
    claims: [],
    covers: [todoName],
    entries: [{ kind: 'waypoint', number: 1, heading: `## Waypoint 1 — ${updated.slice(0, 16).replace('T', ' ')} · ${todoName} · phase 3 WORK`, body: 'Halfway through.' }],
  };
  write(root, `.novadev/todos/${BATCH}/${todoName}/working.md`, renderLock(lock));
}

describe('`novadev work start <batch>/<todo>` locks one todo', () => {
  test('the lock lives in the todo\'s folder; status, sync and `todo list` say who holds the todo', () => {
    const root = batchProject();
    const started = json(run(root, 'work', 'start', `${BATCH}/01-a`, '--agent', AGENT));
    expect(started).toMatchObject({
      batch: BATCH,
      ref: `${BATCH}/01-a`,
      path: LOCK_01,
      state: 'working',
      taken: true,
      resumed: false,
      from: null,
      covers: ['01-a'],
      agent: AGENT,
      todo: '01-a',
      phase: null,
      latest: null,
    });
    expect(started.todos.map((t: { todo: string }) => t.todo)).toEqual(['01-a', '02-b', '03-c']);
    const text = read(root, LOCK_01);
    expect(text.startsWith(`---\nstate: working\nagent: ${AGENT}\nhost: ${hostname()}\n`)).toBe(true);
    expect(text).toContain('\ntodo: 01-a\n');
    expect(text).not.toContain('covers:');
    expect(text).toContain(`# Working — ${BATCH}/01-a`);
    expect(text).toContain("This todo's LOCK");
    // Nothing at the batch's root, and nothing in the other todos.
    expect(exists(root, `.novadev/todos/${BATCH}/working.md`)).toBe(false);
    expect(exists(root, LOCK_02)).toBe(false);

    write(root, 'wp.json', JSON.stringify({ phase: 3, note: 'Tokens done; the toggle next.' }));
    expect(json(run(root, 'work', 'waypoint', `${BATCH}/01-a`, 'wp.json'))).toMatchObject({ ref: `${BATCH}/01-a`, path: LOCK_01, waypoint: 1, todo: '01-a', phase: 3 });

    const status = run(root, 'status').stdout;
    expect(status).toContain('in work — 1 todo(s)');
    expect(status).toContain(`  ● ${BATCH}/01-a — WORKING: ${AGENT} on ${hostname()}`);
    expect(status).toContain('— at phase 3 WORK: "Tokens done; the toggle next."');
    // The batch is in work while any todo of it is; each todo says who holds it.
    expect(status).toContain(`  ${BATCH}  [in work]`);
    expect(status).toContain(`    · 01-a  (open) — in work: ${AGENT}, phase 3 WORK\n`);
    expect(status).toContain('    · 02-b  (open)\n');

    const synced = run(root, 'sync').stdout;
    expect(synced).toContain('in work (1):');
    expect(synced).toContain(`● ${BATCH}/01-a — WORKING: ${AGENT}`);

    const list = run(root, 'todo', 'list').stdout.split('\n');
    expect(list[0]).toBe(`${BATCH}/01-a  (open)  Do the thing. — in work: ${AGENT}, phase 3 WORK`);
    expect(list[1]).toBe(`${BATCH}/02-b  (open)  Do the thing.`);
    const listed = json(run(root, 'todo', 'list', '--json')).todos;
    expect(listed[0].holder).toMatchObject({ lock: `${BATCH}/01-a`, unit: 'todo', state: 'working', live: true, agent: AGENT, worktree: null, phase: 3, latest: 'Tokens done; the toggle next.' });
    expect(listed[1].holder).toBeNull();
    expect(json(run(root, 'todo', 'show', `${BATCH}/01`)).holder).toMatchObject({ lock: `${BATCH}/01-a`, state: 'working' });
    expect(json(run(root, 'todo', 'show', `${BATCH}/02`)).holder).toBeNull();
  });

  test('a todo is named as `novadev todo` names one, and --todo is another spelling of the same lock', () => {
    const root = batchProject();
    todo(root, '2026-11-12_3/01-dark-mode');
    for (const ref of [`${BATCH}/01-a`, `${BATCH}/01`, `${BATCH}/1`, `${BATCH}/a`, `.novadev/todos/${BATCH}/01-a/`, `todos/${BATCH}/01-a`]) {
      const out = json(run(root, 'work', 'start', ref, '--agent', AGENT));
      expect(out.path).toBe(LOCK_01);
    }
    // A word only one open todo has; the start of a folder's name.
    expect(json(run(root, 'work', 'start', 'dark', '--agent', AGENT)).path).toBe('.novadev/todos/2026-11-12_3/01-dark-mode/working.md');
    expect(json(run(root, 'work', 'start', '2026-11-12_3/01-dark', '--agent', AGENT)).ref).toBe('2026-11-12_3/01-dark-mode');
    // The 0.17.0 spelling: the same lock, the same answer keys.
    const spelled = json(run(root, 'work', 'start', BATCH, '--todo', '02', '--agent', AGENT));
    expect(spelled).toMatchObject({ batch: BATCH, ref: `${BATCH}/02-b`, path: LOCK_02, covers: ['02-b'], taken: true });

    expect(json(run(root, 'work', 'start', `${BATCH}/zz`))).toEqual({ error: `No todo "zz" in batch ${BATCH} — its todos: 01-a, 02-b, 03-c.` });
    expect(json(run(root, 'work', 'start', 'nothing-like-it'))).toEqual({ error: '"nothing-like-it" is not a batch name (YYYY-MM-DD_N), and no open todo matches it.' });
    expect(json(run(root, 'work', 'start', '2026-11-12_9/01-a'))).toEqual({ error: `No batch todos/2026-11-12_9. Open batches: ${BATCH}, 2026-11-12_3.` });
    expect(json(run(root, 'work', 'start', 'a/b/c')).error).toBe('"a/b/c" is not a batch name (YYYY-MM-DD_N), nor a todo of one (<batch>/<todo>).');
  });

  test('several todos in one command: a lock per todo, all or none; the registry holds one entry per todo', () => {
    const root = batchProject();
    git(root, 'init', '-q', '-b', 'main');
    commitAll(root);
    const both = json(run(root, 'work', 'start', BATCH, '--todo', '01', '--todo', 'b', '--agent', AGENT));
    expect(both).toMatchObject({ batch: BATCH, state: 'working', taken: true, covers: ['01-a', '02-b'] });
    expect(both.locks.map((l: { ref: string; path: string }) => [l.ref, l.path])).toEqual([[`${BATCH}/01-a`, LOCK_01], [`${BATCH}/02-b`, LOCK_02]]);
    expect(readdirSync(join(root, '.git/novadev/locks')).sort()).toEqual([`${BATCH}.01-a.json`, `${BATCH}.02-b.json`]);
    const entry = JSON.parse(read(root, `.git/novadev/locks/${BATCH}.01-a.json`));
    expect(entry).toMatchObject({ batch: BATCH, unit: 'todo', covers: ['01-a'], todo: '01-a', branch: 'main', state: 'working', agent: AGENT });

    // One of the two is held by a live session elsewhere: neither is taken.
    run(root, 'work', 'stop', BATCH);
    foreignTodoLock(root, '02-b');
    const refused = json(run(root, 'work', 'start', BATCH, '--todo', '01', '--todo', '02', '--agent', AGENT));
    expect(refused.error).toContain(`Todo ${BATCH}/02-b is in work: claude-code/other on elsewhere`);
    expect(exists(root, LOCK_01)).toBe(false);
  });

  test('another session takes another todo of the batch; the held todo and the whole batch are refused', () => {
    const root = batchProject();
    foreignTodoLock(root, '01-a', { minutesAgo: 5 });
    expect(json(run(root, 'work', 'start', `${BATCH}/01`, '--agent', AGENT))).toEqual({
      error: `Todo ${BATCH}/01-a is in work: claude-code/other on elsewhere, last waypoint 5 min ago, at phase 3 WORK. If that session is gone, pass --take to take the lock over.`,
    });
    expect(json(run(root, 'work', 'start', `${BATCH}/02`, '--agent', AGENT)).path).toBe(LOCK_02);
    // `work start <batch>` speaks of the locks here: the live one of the other session refuses it.
    const whole = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(whole.error).toContain(`Todo ${BATCH}/01-a is in work: claude-code/other on elsewhere`);
    expect(whole.error).toContain(`The batch's other todos can be started by name: \`novadev work start ${BATCH}/<todo>\`.`);
    expect(exists(root, `.novadev/todos/${BATCH}/working.md`)).toBe(false);
    // --take takes that one todo over; the other lock is not touched.
    const taken = json(run(root, 'work', 'start', `${BATCH}/01`, '--agent', AGENT, '--take'));
    expect(taken).toMatchObject({ from: 'taken', previous: { agent: 'claude-code/other' } });
    expect(taken.latest.text).toBe('Halfway through.');
  });

  test('a lock on the whole batch and a todo\'s lock never coexist', () => {
    const root = batchProject();
    run(root, 'work', 'start', BATCH, '--agent', AGENT);
    expect(json(run(root, 'work', 'start', `${BATCH}/01`, '--agent', AGENT)).error).toContain(`Batch ${BATCH} is locked here for all its todos — --todo cannot narrow that lock.`);
    run(root, 'work', 'stop', BATCH);
    run(root, 'work', 'start', `${BATCH}/01`, '--agent', AGENT);
    // With a todo locked here, `work start <batch>` resumes that lock: it does not widen to the batch.
    const again = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(again).toMatchObject({ ref: `${BATCH}/01-a`, path: LOCK_01, from: 'same-session' });
    expect(exists(root, `.novadev/todos/${BATCH}/working.md`)).toBe(false);
  });
});

describe('waypoint, pause, stop and claim on a todo\'s lock', () => {
  test('the todo names the lock; a session with one lock may go on naming the batch', () => {
    const root = batchProject();
    run(root, 'work', 'start', `${BATCH}/02`, '--agent', AGENT);
    const wp = payload(root, 'wp.json', { phase: 3, note: 'By the todo.' });
    expect(json(run(root, 'work', 'waypoint', `${BATCH}/02-b`, wp)).waypoint).toBe(1);
    expect(json(run(root, 'work', 'waypoint', BATCH, wp))).toMatchObject({ ref: `${BATCH}/02-b`, path: LOCK_02, waypoint: 2 });
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'wp2.json', { todo: '02-b', note: 'By the payload.' }))).waypoint).toBe(3);
    // A todo's lock is about its todo: an entry for another todo is refused, not filed in the wrong trail.
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'wp3.json', { todo: '01-a', note: 'Wrong trail.' })))).toEqual({
      error: `The lock here is on todo ${BATCH}/02-b; todo ${BATCH}/01-a is not in work — \`novadev work start ${BATCH}/01-a\` first.`,
    });
    expect(json(run(root, 'work', 'waypoint', `${BATCH}/01`, wp))).toEqual({ error: `Todo ${BATCH}/01-a is not in work — \`novadev work start ${BATCH}/01-a\` first.` });
    expect(json(run(root, 'work', 'claim', BATCH, 'src/b.ts'))).toMatchObject({ ref: `${BATCH}/02-b`, added: ['src/b.ts'], claims: ['src/b.ts'] });
    expect(read(root, LOCK_02)).toContain('claims: src/b.ts');

    const paused = json(run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { stopped: 'Half of B.', next: ['Finish B.'] })));
    expect(paused).toMatchObject({ ref: `${BATCH}/02-b`, path: LOCK_02, state: 'paused', waypoint: 4, todo: '02-b', phase: 3 });
    const text = read(root, LOCK_02);
    expect(text).toContain('## PAUSED — waypoint 4 — ');
    expect(text).toContain('### Stopped at\n\nHalf of B.');
    // Its own todo at the pause, not the whole batch.
    expect(text).toContain('### The todo at the pause\n\n- · 02-b — open\n');
    expect(text).not.toContain('01-a — open');
    expect(json(run(root, 'work', 'waypoint', `${BATCH}/02`, wp))).toEqual({ error: `Todo ${BATCH}/02-b is paused — \`novadev work start ${BATCH}/02-b\` resumes it first.` });

    const sync = run(root, 'sync').stdout;
    expect(sync).toMatch(new RegExp(`‖ ${BATCH}/02-b — PAUSED \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} by ${AGENT} — at phase 3 WORK: "Half of B\\."`));
    expect(sync).toContain(`⧗ ${BATCH}/02-b is PAUSED (`);
    expect(sync).toContain(`\`/novadev-work\` resumes it from todos/${BATCH}/02-b/working.md`);
    const status = run(root, 'status').stdout;
    expect(status).toContain(`  ${BATCH}  [paused]`);
    expect(status).toMatch(new RegExp(`    · 02-b  \\(open\\) — paused \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} by ${AGENT}, phase 3 WORK\\n`));
    expect(status).toContain('→ a paused todo resumes with `/novadev-work`; it reads the PAUSED section of its working.md first');

    // Resumed by the batch's name: the answer carries the pause record.
    const resumed = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(resumed).toMatchObject({ ref: `${BATCH}/02-b`, resumed: true, from: 'paused', state: 'working' });
    expect(resumed.latest).toMatchObject({ kind: 'pause', waypoint: 4 });

    const stopped = json(run(root, 'work', 'stop', `${BATCH}/02`));
    expect(stopped).toMatchObject({ batch: BATCH, ref: `${BATCH}/02-b`, state: 'released', path: LOCK_02, covers: ['02-b'], wasPaused: false, waypoints: 4, unfinished: ['02-b'] });
    expect(exists(root, LOCK_02)).toBe(false);
    expect(json(run(root, 'work', 'stop', `${BATCH}/02`))).toEqual({ error: `Todo ${BATCH}/02-b is not in work — there is no lock to release.` });
  });

  test('several locks in one worktree: a waypoint needs the todo, a pause reaches every working lock, a stop releases all', () => {
    const root = batchProject();
    run(root, 'work', 'start', BATCH, '--todo', '01', '--todo', '02', '--agent', AGENT);
    const wp = payload(root, 'wp.json', { note: 'Which one?' });
    expect(json(run(root, 'work', 'waypoint', BATCH, wp))).toEqual({
      error: `Batch ${BATCH} has 2 locks in this worktree (${BATCH}/01-a, ${BATCH}/02-b) — say which: \`novadev work waypoint ${BATCH}/<todo> …\`, or "todo" in the payload.`,
    });
    expect(json(run(root, 'work', 'claim', BATCH, 'src/')).error).toContain(`say which: \`novadev work claim ${BATCH}/<todo> …\`.`);
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'wp1.json', { todo: '01-a', phase: 3, note: 'In A.' }))).path).toBe(LOCK_01);
    expect(json(run(root, 'work', 'waypoint', `${BATCH}/02`, payload(root, 'wp2.json', { phase: 4, note: 'In B.' }))).path).toBe(LOCK_02);

    const status = run(root, 'status').stdout;
    expect(status).toContain('in work — 2 todo(s)');
    expect(status).toContain(`● ${BATCH}/01-a — WORKING`);
    expect(status).toContain('— at phase 3 WORK: "In A."');
    expect(status).toContain(`● ${BATCH}/02-b — WORKING`);
    expect(status).toContain('— at phase 4 RECORD: "In B."');

    // One todo paused by name: the other goes on.
    run(root, 'work', 'pause', `${BATCH}/01`, payload(root, 'p1.json', { stopped: 'A waits for the owner.', next: ['Ask.'] }));
    expect(readWorkLock(join(root, '.novadev'), BATCH, '02-b')).toMatchObject({ state: 'ok', lock: { state: 'working' } });
    // The batch paused: every lock still working gets the record; the one paused already keeps its own.
    const paused = json(run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { stopped: 'The session ends.', next: ['Go on with B.'] })));
    expect(paused).toMatchObject({ ref: `${BATCH}/02-b`, state: 'paused' });
    expect(read(root, LOCK_01)).not.toContain('The session ends.');
    // Both paused: `work start <batch>` resumes both, and a pause of the batch then reaches both.
    const resumed = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(resumed.locks.map((l: { ref: string; from: string }) => [l.ref, l.from])).toEqual([[`${BATCH}/01-a`, 'paused'], [`${BATCH}/02-b`, 'paused']]);
    const all = json(run(root, 'work', 'pause', BATCH, payload(root, 'p2.json', { stopped: 'Both stop here.', next: ['Resume both.'] })));
    expect(all.paused.map((p: { ref: string }) => p.ref)).toEqual([`${BATCH}/01-a`, `${BATCH}/02-b`]);
    expect(read(root, LOCK_01)).toContain('Both stop here.');
    expect(read(root, LOCK_02)).toContain('Both stop here.');

    const stopped = json(run(root, 'work', 'stop', BATCH));
    expect(stopped.released.map((r: { ref: string; wasPaused: boolean }) => [r.ref, r.wasPaused])).toEqual([[`${BATCH}/01-a`, true], [`${BATCH}/02-b`, true]]);
    expect(exists(root, LOCK_01) || exists(root, LOCK_02)).toBe(false);
    expect(run(root, 'status').stdout).toContain('in work — none (nothing is locked;');
  });

  test('a live lock of another session refuses a stop of the batch before anything is released', () => {
    const root = batchProject();
    run(root, 'work', 'start', `${BATCH}/01`, '--agent', AGENT);
    foreignTodoLock(root, '02-b', { minutesAgo: 3 });
    expect(json(run(root, 'work', 'stop', BATCH))).toEqual({
      error: `Todo ${BATCH}/02-b is in work: claude-code/other on elsewhere, last waypoint 3 min ago. If that session is gone, pass --take to release the lock anyway.`,
    });
    expect(exists(root, LOCK_01)).toBe(true);
    // Its own todo, by name, is released; the other session's stays.
    expect(json(run(root, 'work', 'stop', `${BATCH}/01`)).state).toBe('released');
    expect(exists(root, LOCK_02)).toBe(true);
  });

  test('a todo of a lock on the whole batch: waypoints go to that lock, and it is not stopped one todo at a time', () => {
    const root = batchProject();
    run(root, 'work', 'start', BATCH, '--agent', AGENT);
    const wp = payload(root, 'wp.json', { phase: 3, note: 'Under the batch lock.' });
    expect(json(run(root, 'work', 'waypoint', `${BATCH}/02`, wp))).toMatchObject({ path: `.novadev/todos/${BATCH}/working.md`, todo: '02-b', waypoint: 1 });
    expect(json(run(root, 'work', 'stop', `${BATCH}/02`))).toEqual({
      error: `Todo ${BATCH}/02-b is held by the lock on the whole batch (todos/${BATCH}/working.md) — a todo is not taken out of it: \`novadev work stop ${BATCH}\` releases that lock.`,
    });
  });
});

describe('what the rest of novadev does with a todo\'s lock', () => {
  test('the batch is in work while any todo of it is: never complete, never archived, never filed into', () => {
    const root = batchProject();
    for (const name of ['01-a', '02-b', '03-c']) write(root, `.novadev/todos/${BATCH}/${name}/ai_completed.md`, completed(name));
    run(root, 'work', 'start', `${BATCH}/03`, '--agent', AGENT);
    const synced = run(root, 'sync').stdout;
    expect(synced).toContain(`● ${BATCH}/03-c — WORKING`);
    expect(synced).toContain(`— it is recorded: \`novadev work stop ${BATCH}/03-c\` releases it`);
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(false);
    const archived = run(root, 'archive', BATCH);
    expect(archived.code).toBe(1);
    expect(archived.stderr).toContain(`batch ${BATCH} is in work (working.md)`);
    expect(json(run(root, 'status', '--json')).batches[0]).toMatchObject({ batch: BATCH, readyToArchive: false, inWork: 'working' });

    expect(json(run(root, 'work', 'stop', `${BATCH}/03`)).unfinished).toBeUndefined();
    run(root, 'sync');
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(true);
  });

  test('file-todo never files into a batch a todo of which is in work', () => {
    const root = project();
    const filed = payload(root, 'file.json', { parts: [{ slug: 'first', title: 'First', request: 'Do it.' }] });
    const first = json(run(root, 'file-todo', 'file', filed));
    const batch = first.filed[0].ref.split('/')[0];
    expect(json(run(root, 'file-todo', 'plan'))).toMatchObject({ batch, reused: true });
    run(root, 'work', 'start', first.filed[0].ref, '--agent', AGENT);
    expect(json(run(root, 'file-todo', 'plan')).reused).toBe(false);
  });

  test('`todo addendum` waits for a live lock on THAT todo only', () => {
    const root = batchProject();
    foreignTodoLock(root, '01-a');
    const add = payload(root, 'add.json', { text: 'Also the logout.' });
    const held = run(root, 'todo', 'addendum', `${BATCH}/01-a`, add);
    expect(held.code).toBe(1);
    expect(json(held).error).toBe(`${BATCH}/01-a is in work right now (claude-code/other): tell that session, or try again when it pauses or stops.`);
    expect(run(root, 'todo', 'addendum', `${BATCH}/02-b`, add).code).toBe(0);
    // A paused todo accepts it.
    foreignTodoLock(root, '01-a', { state: 'paused' });
    expect(run(root, 'todo', 'addendum', `${BATCH}/01-a`, add).code).toBe(0);
  });

  test('an unreadable lock is a problem for sync, --check and doctor; an abandoned one a NEXT ACTION; stop removes either', () => {
    const root = batchProject();
    expect(run(root, 'deploy').code).toBe(0);
    write(root, LOCK_01, '---\nstate: busy\n---\n');
    const synced = run(root, 'sync');
    expect(synced.code).toBe(1);
    expect(synced.stdout).toContain(`✗ todos/${BATCH}/01-a/working.md: "state" must be working or paused, not "busy" — fix it, or delete it and \`novadev work start ${BATCH}/01-a\` again`);
    expect(run(root, 'sync', '--check').code).toBe(1);
    expect(run(root, 'doctor').code).toBe(1);
    expect(run(root, 'status').stdout).toContain(`  ${BATCH}  [lock unreadable]`);
    expect(json(run(root, 'work', 'start', `${BATCH}/01`)).error).toBe(`todos/${BATCH}/01-a/working.md cannot be read: "state" must be working or paused, not "busy" — fix it, or delete it and start again.`);
    // Another todo of the batch is not held up by it.
    expect(run(root, 'work', 'start', `${BATCH}/02`, '--agent', AGENT).code).toBe(0);
    run(root, 'work', 'stop', `${BATCH}/02`);
    expect(json(run(root, 'work', 'stop', `${BATCH}/01`))).toMatchObject({ ref: `${BATCH}/01-a`, state: 'released', unreadable: '"state" must be working or paused, not "busy"' });

    foreignTodoLock(root, '02-b', { minutesAgo: 300 });
    const stale = run(root, 'sync').stdout;
    expect(stale).toContain(`✗ ${BATCH}/02-b — ABANDONED: claude-code/other on elsewhere — no waypoint for 5 h 00 min`);
    expect(stale).toContain(`→ ${BATCH}/02-b is locked by claude-code/other on elsewhere, but no waypoint for 5 h 00 min`);
    expect(stale).toContain(`resume it (\`novadev work start ${BATCH}/02-b\` reads its last waypoint) or release it (\`novadev work stop ${BATCH}/02-b\`)`);
    expect(run(root, 'status').stdout).toContain('    · 02-b  (open) — abandoned: claude-code/other, phase 3 WORK\n');
    expect(run(root, 'doctor').stdout).toContain(`${BATCH}/02-b is locked by claude-code/other on elsewhere`);
    // Taken over on its own, like an abandoned batch lock.
    expect(json(run(root, 'work', 'start', `${BATCH}/02`, '--agent', AGENT))).toMatchObject({ from: 'stale', resumed: true });
  });

  test('a todo\'s lock is not one of its records: links, claims and doctor do not read it as one', () => {
    const root = batchProject();
    feature(root, 'FEAT-0001', 'auth', { touches: 'src/auth/' });
    run(root, 'sync');
    run(root, 'work', 'start', `${BATCH}/01`, '--agent', AGENT);
    write(root, 'wp.json', JSON.stringify({ note: 'Quoting a record:\n**Feature:** FEAT-0001\n**Commits:** deadbeef\n**Repos:** nowhere' }));
    expect(run(root, 'work', 'waypoint', `${BATCH}/01`, 'wp.json').code).toBe(0);
    const links = run(root, 'links');
    expect(links.stdout).not.toContain('deadbeef');
    expect(links.stdout).not.toContain('nowhere');
    // Starting again does not claim the feature a waypoint only quoted.
    expect(json(run(root, 'work', 'start', `${BATCH}/01`, '--agent', AGENT)).claims).toEqual([]);
    // The lock is not a brief either: a todo folder with only the lock has no brief.
    todo(root, `${BATCH}/04-d`);
    run(root, 'work', 'start', `${BATCH}/04`, '--agent', AGENT);
    require('node:fs').rmSync(join(root, `.novadev/todos/${BATCH}/04-d/prompt.md`));
    expect(run(root, 'doctor').stdout).toContain(`todos/${BATCH}/04-d: no brief (.txt/.md) file`);
  });

  test('the lock parses back exactly as it was rendered; status --json carries every lock and every holder', () => {
    const root = batchProject();
    run(root, 'work', 'start', `${BATCH}/01`, '--agent', AGENT, '--claim', 'src/a/');
    write(root, 'wp.json', JSON.stringify({ phase: 3, note: 'One.' }));
    run(root, 'work', 'waypoint', `${BATCH}/01`, 'wp.json');
    const before = read(root, LOCK_01);
    const lock = readWorkLock(join(root, '.novadev'), BATCH, '01-a');
    expect(lock).toMatchObject({ state: 'ok', batch: BATCH, todo: '01-a', lock: { unit: 'todo', covers: ['01-a'], todo: '01-a', claims: ['src/a'] } });
    if (lock?.state === 'ok') expect(renderLock(lock.lock)).toBe(before);
    // The batch-root reader does not see a todo's lock.
    expect(readWorkLock(join(root, '.novadev'), BATCH)).toBeNull();

    foreignTodoLock(root, '02-b', { state: 'paused' });
    const data = json(run(root, 'status', '--json'));
    expect(data.inWork.map((l: Record<string, unknown>) => [l.ref, l.unit, l.state, l.todo])).toEqual([[`${BATCH}/01-a`, 'todo', 'working', '01-a'], [`${BATCH}/02-b`, 'todo', 'paused', '02-b']]);
    expect(data.inWork[0]).toMatchObject({ batch: BATCH, covers: ['01-a'], phase: 3, phaseLabel: 'phase 3 WORK', latest: 'One.', entries: 1, live: true });
    expect(data.batches[0]).toMatchObject({ batch: BATCH, inWork: 'working', inWorkElsewhere: false });
    const holders = data.batches[0].todos.map((t: { todo: string; holder: Record<string, unknown> | null }) => [t.todo, t.holder?.state ?? null, t.holder?.agent ?? null, t.holder?.here ?? null]);
    expect(holders).toEqual([['01-a', 'working', AGENT, true], ['02-b', 'paused', 'claude-code/other', true], ['03-c', null, null, null]]);
    expect(data.batches[0].todos[0].holder).toMatchObject({ lock: `${BATCH}/01-a`, unit: 'todo', live: true, phase: 3, phaseLabel: 'phase 3 WORK', latest: 'One.', worktree: null });
  });
});

describe('across worktrees: the registry, claims, and the merge', () => {
  /** A project in git on main with batch 2026-11-12_2 (01-a names FEAT-0002 → src/x/, 02-b names FEAT-0003 → src/y/), and two plain worktrees. */
  function twoWorktrees(): { main: string; wt: string; wt2: string } {
    const main = project();
    feature(main, 'FEAT-0002', 'x', { touches: 'src/x/' });
    feature(main, 'FEAT-0003', 'y', { touches: 'src/y/' });
    todo(main, `${BATCH}/01-a`, { 'prompt.md': '# prompt\n\n**Feature:** FEAT-0002\n\nA.\n' });
    todo(main, `${BATCH}/02-b`, { 'prompt.md': '# prompt\n\n**Feature:** FEAT-0003\n\nB.\n' });
    todo(main, `${BATCH}/03-c`);
    git(main, 'init', '-q', '-b', 'main');
    commitAll(main);
    const wt = join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'task/a', wt);
    const wt2 = join(tempDir(), 'wt2');
    git(main, 'worktree', 'add', '-q', '-b', 'task/b', wt2);
    return { main, wt, wt2 };
  }

  test('two worktrees hold two todos of one batch; the same todo and the whole batch are refused; every worktree sees who holds what', () => {
    const { main, wt, wt2 } = twoWorktrees();
    const first = json(run(wt, 'work', 'start', `${BATCH}/01`, '--agent', AGENT));
    // A todo claims the touches of ITS features only.
    expect(first.claims).toEqual(['src/x']);
    expect(first.claimsFrom.features).toEqual({ 'FEAT-0002': ['src/x'] });
    expect(json(run(wt2, 'work', 'start', `${BATCH}/02`, '--agent', AGENT)).claims).toEqual(['src/y']);
    write(wt, 'wp.json', JSON.stringify({ phase: 3, note: 'A is half done.' }));
    run(wt, 'work', 'waypoint', BATCH, 'wp.json');

    expect(json(run(main, 'work', 'start', `${BATCH}/01-a`, '--agent', AGENT)).error).toContain(`Todo ${BATCH}/01-a is in work in another worktree: `);
    const whole = json(run(main, 'work', 'start', BATCH, '--agent', AGENT)).error;
    expect(whole).toContain(`Todo ${BATCH}/01-a is in work in another worktree: `);
    expect(whole).toContain(`The batch's other todos can be started by name: \`novadev work start ${BATCH}/<todo>\`.`);
    // An overlapping claim names the todo that owns the path.
    expect(json(run(main, 'work', 'start', `${BATCH}/03`, '--agent', AGENT, '--claim', 'src/x/a.ts')).error).toContain(`src/x/a.ts overlaps src/x — claimed by todo ${BATCH}/01-a in`);
    expect(run(main, 'work', 'start', `${BATCH}/03`, '--agent', AGENT).code).toBe(0);

    const synced = run(main, 'sync').stdout;
    expect(synced).toMatch(new RegExp(`◦ ${BATCH}/01-a — WORKING in another worktree: \\S+/wt \\(branch task/a\\) — ${AGENT}, last waypoint just now, at phase 3 WORK: "A is half done\\."; claims src/x`));
    expect(synced).toMatch(new RegExp(`◦ ${BATCH}/02-b — WORKING in another worktree: \\S+/wt2 \\(branch task/b\\)`));
    expect(synced).toContain(`● ${BATCH}/03-c — WORKING`);
    const status = run(main, 'status').stdout;
    expect(status).toContain('in work — 3 todo(s)');
    expect(status).toMatch(new RegExp(`/wt  task/a — ${BATCH}/01-a in work \\(${AGENT}\\), claims src/x`));
    expect(status).toMatch(new RegExp(`    · 01-a  \\(open\\) — in work: ${AGENT} in \\S+/wt \\(branch task/a\\), phase 3 WORK\\n`));
    expect(status).toMatch(new RegExp(`    · 02-b  \\(open\\) — in work: ${AGENT} in \\S+/wt2 \\(branch task/b\\)\\n`));
    expect(status).toContain(`    · 03-c  (open) — in work: ${AGENT}\n`);
    const data = json(run(main, 'status', '--json'));
    expect(data.batches[0].inWorkElsewhere).toBe(true);
    expect(data.batches[0].todos[0].holder).toMatchObject({ lock: `${BATCH}/01-a`, here: false, branch: 'task/a', latest: 'A is half done.', phase: 3 });
    expect(data.worktrees.find((w: { branch: string }) => w.branch === 'task/a').batches).toEqual([{ batch: BATCH, unit: 'todo', ref: `${BATCH}/01-a`, state: 'working', agent: AGENT, claims: ['src/x'], covers: ['01-a'] }]);
    // A todo held in another worktree shows its batch as in work here too; an addendum to it waits.
    expect(run(wt2, 'status').stdout).toContain(`  ${BATCH}  [in work]`);
    write(main, 'add.json', JSON.stringify({ text: 'More.' }));
    expect(json(run(main, 'todo', 'addendum', `${BATCH}/01-a`, 'add.json')).error).toContain(`${BATCH}/01-a is in work right now in another worktree`);
    expect(run(main, 'archive', BATCH).stderr).toContain('is in work in another worktree');

    // Stop releases only that todo's entry.
    run(wt, 'work', 'stop', `${BATCH}/01`);
    expect(readdirSync(join(main, '.git/novadev/locks')).sort()).toEqual([`${BATCH}.02-b.json`, `${BATCH}.03-c.json`]);
    expect(run(main, 'work', 'start', `${BATCH}/01`, '--agent', AGENT, '--allow-overlap').code).toBe(0);
  });

  test('--take moves one todo here and leaves the other where it is; the old holder\'s lock is stale', () => {
    const { main, wt, wt2 } = twoWorktrees();
    run(wt, 'work', 'start', `${BATCH}/01`, '--agent', AGENT);
    run(wt2, 'work', 'start', `${BATCH}/02`, '--agent', AGENT);
    const taken = json(run(main, 'work', 'start', `${BATCH}/01`, '--agent', AGENT, '--take'));
    expect(taken.takenFromWorktree.branch).toBe('task/a');
    const entries = readdirSync(join(main, '.git/novadev/locks')).map((f) => JSON.parse(read(main, `.git/novadev/locks/${f}`)));
    expect(entries.map((e) => `${e.branch} ${e.covers}`).sort()).toEqual(['main 01-a', 'task/b 02-b']);
    write(wt, 'w.json', JSON.stringify({ note: 'x' }));
    expect(json(run(wt, 'work', 'waypoint', `${BATCH}/01`, 'w.json')).error).toBe(
      `Todo ${BATCH}/01-a was taken over in another worktree: ${main} (branch main), by ${AGENT} — this lock is stale. Release it here with \`novadev work stop ${BATCH}/01-a\`.`,
    );
    // Its stop releases the file there and never the new holder's entry.
    expect(run(wt, 'work', 'stop', `${BATCH}/01`).code).toBe(0);
    expect(JSON.parse(read(main, `.git/novadev/locks/${BATCH}.01-a.json`)).branch).toBe('main');
    // A paused todo resumes where its pause record is.
    write(wt2, 'p.json', JSON.stringify({ stopped: 'Half of B.', next: ['Finish B.'] }));
    run(wt2, 'work', 'pause', BATCH, 'p.json');
    expect(json(run(main, 'work', 'start', `${BATCH}/02`, '--agent', AGENT)).error).toContain(`Todo ${BATCH}/02-b is paused in another worktree: `);
  });

  test('two worktrees lock todos 01 and 02 of one batch, pause both, merge both: no conflict, and status shows both waypoints', () => {
    const main = project({ worktree: { dir: join(tempDir(), 'wts') } });
    todo(main, `${BATCH}/01-a`);
    todo(main, `${BATCH}/02-b`);
    git(main, 'init', '-q', '-b', 'main');
    quiet(main);
    commit(main, 'start');
    expect(run(main, 'worktree', 'create', 't1', '--todo', `${BATCH}/01`).stdout).toContain(`  for: ${BATCH}/01-a — take its lock there first: novadev work start ${BATCH}/01-a`);
    expect(run(main, 'worktree', 'create', 't2', '--todo', `${BATCH}/02-b`).code).toBe(0);
    const [wt1, wt2] = json(run(main, 'worktree', 'list', '--json')).worktrees.map((w: { path: string }) => w.path) as [string, string];
    for (const [wt, name, file] of [[wt1, '01-a', 'a'], [wt2, '02-b', 'b']] as const) {
      expect(run(wt, 'work', 'start', `${BATCH}/${name}`, '--agent', AGENT).code).toBe(0);
      write(wt, 'p.json', JSON.stringify({ phase: 3, stopped: `Half of ${file}.`, next: [`Finish ${file}.`] }));
      expect(json(run(wt, 'work', 'pause', `${BATCH}/${name}`, join(wt, 'p.json'))).state).toBe('paused');
      require('node:fs').rmSync(join(wt, 'p.json'));
      write(wt, `src/${file}.ts`, `export const ${file} = 1;\n`);
      commit(wt, `${file}, and the pause`);
    }
    // Before the merge the lead sees both from the main checkout.
    const before = run(main, 'status').stdout;
    expect(before).toMatch(new RegExp(`◦ ${BATCH}/01-a — PAUSED in another worktree: \\S+/t1 \\(branch t1\\) — ${AGENT}, last waypoint just now, at phase 3 WORK: "Half of a\\."`));
    expect(before).toMatch(new RegExp(`◦ ${BATCH}/02-b — PAUSED in another worktree: \\S+/t2 \\(branch t2\\) — ${AGENT}, last waypoint just now, at phase 3 WORK: "Half of b\\."`));
    expect(before).toContain(`  ${BATCH}  [paused]`);
    const listed = run(main, 'worktree', 'list').stdout;
    expect(listed).toContain(`in work: ${BATCH}/01-a (paused)`);
    expect(run(main, 'worktree', 'mr', 't1').stdout).toContain(`Todo: \`${BATCH}/01-a\` — Do the thing. (open)`);

    const first = run(main, 'worktree', 'merge', 't1', '--yes');
    expect(first.stdout).toContain('✓ merged t1 into project main');
    const second = run(main, 'worktree', 'merge', 't2', '--yes');
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('✓ merged t2 into project main');
    // Both locks are on the default branch, each in its todo's folder, each readable.
    expect(read(main, LOCK_01)).toContain('### Stopped at\n\nHalf of a.');
    expect(read(main, LOCK_02)).toContain('### Stopped at\n\nHalf of b.');
    expect(exists(main, `.novadev/todos/${BATCH}/working.md`)).toBe(false);
    expect(git(main, 'status', '--porcelain').stdout).toBe('');
    const after = run(main, 'status').stdout;
    expect(after).toMatch(new RegExp(`‖ ${BATCH}/01-a — PAUSED \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} by ${AGENT} — at phase 3 WORK: "Half of a\\."`));
    expect(after).toMatch(new RegExp(`‖ ${BATCH}/02-b — PAUSED \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} by ${AGENT} — at phase 3 WORK: "Half of b\\."`));
    expect(run(main, 'sync', '--check').stdout).not.toContain('merge conflict');

    // The worktrees gone, each todo resumes on the default branch from its own pause record.
    run(main, 'worktree', 'remove', 't1');
    run(main, 'worktree', 'remove', 't2');
    expect(existsSync(join(main, '.git/novadev/locks')) ? readdirSync(join(main, '.git/novadev/locks')) : []).toEqual([]);
    const resumed = json(run(main, 'work', 'start', `${BATCH}/02`, '--agent', AGENT));
    expect(resumed).toMatchObject({ from: 'paused', resumed: true });
    expect(resumed.latest.text).toContain('Half of b.');
    expect(readWorkLock(join(main, '.novadev'), BATCH, '01-a')).toMatchObject({ lock: { state: 'paused' } });
  });

  test('a todo still WORKING on the branch refuses the merge; stopped, it merges', () => {
    const main = project({ worktree: { dir: join(tempDir(), 'wts') } });
    todo(main, `${BATCH}/01-a`);
    git(main, 'init', '-q', '-b', 'main');
    quiet(main);
    commit(main, 'start');
    run(main, 'worktree', 'create', 't1');
    const wt = json(run(main, 'worktree', 'list', '--json')).worktrees[0].path as string;
    run(wt, 'work', 'start', `${BATCH}/01`, '--agent', AGENT);
    write(wt, 'src/a.ts', 'export const a = 1;\n');
    commit(wt, 'a, with the lock');
    expect(run(main, 'worktree', 'mr', 't1').stdout).toContain(`Todos in work there: ${BATCH}/01-a — stop (or pause) them before the merge`);
    expect(run(main, 'worktree', 'merge', 't1').stdout).toContain(`✗ the branch carries a todo still in work (${LOCK_01}) — stop it (or pause it) in the worktree, commit, then merge`);
    run(wt, 'work', 'stop', `${BATCH}/01`);
    commit(wt, 'stopped');
    expect(run(main, 'worktree', 'merge', 't1', '--yes').stdout).toContain('✓ merged t1 into project main');
    expect(exists(main, LOCK_01)).toBe(false);
  });
});

describe('the worktree command and its todo', () => {
  /** A project on main with a worktree folder set, batch 2026-11-12_2 committed. */
  function repo(): string {
    const main = batchProject({ worktree: { dir: join(tempDir(), 'wts') } });
    git(main, 'init', '-q', '-b', 'main');
    quiet(main);
    commit(main, 'start');
    return main;
  }

  test('`create --todo` records what the worktree is for; list, status and the merge request name it', () => {
    const main = repo();
    const made = run(main, 'worktree', 'create', 't1', '--claim', 'src/a/', '--todo', `${BATCH}/01`);
    expect(made.code).toBe(0);
    expect(made.stdout).toContain(`  for: ${BATCH}/01-a`);
    expect(JSON.parse(read(main, '.git/novadev/worktrees/t1.json')).todos).toEqual([`${BATCH}/01-a`]);
    const list = json(run(main, 'worktree', 'list', '--json')).worktrees;
    expect(list[0]).toMatchObject({ name: 't1', todos: [`${BATCH}/01-a`], batches: [] });
    expect(run(main, 'worktree', 'list').stdout).toContain(`claims: src/a  for: ${BATCH}/01-a`);
    expect(run(main, 'worktree', 'status', 't1').stdout).toContain(`  for: ${BATCH}/01-a`);
    expect(run(main, 'worktree', 'mr', 't1').stdout.split('\n').slice(0, 2)).toEqual([
      `**Merge request: t1** — branch \`t1\` (worktree \`${list[0].path}\`)`,
      `Todo: \`${BATCH}/01-a\` — Do the thing. (open)`,
    ]);
    // A todo that does not exist is refused before anything is made; a second worktree for the todo is said.
    const typo = run(main, 'worktree', 'create', 't2', '--todo', `${BATCH}/09`);
    expect(typo.code).toBe(1);
    expect(typo.stderr).toContain(`No open todo matches "${BATCH}/09"`);
    expect(json(run(main, 'worktree', 'list', '--json')).worktrees).toHaveLength(1);
    expect(run(main, 'worktree', 'create', 't2', '--todo', `${BATCH}/01-a`).stdout).toContain(`  note: todo ${BATCH}/01-a is also the task of worktree t1`);
  });

  test('a todo started in a worktree is the worktree\'s: the lock claims the worktree\'s files, and the merge request names the todo after the lock is gone', () => {
    const main = repo();
    run(main, 'worktree', 'create', 't1', '--claim', 'src/a/');
    const wt = json(run(main, 'worktree', 'list', '--json')).worktrees[0].path as string;
    const started = json(run(wt, 'work', 'start', `${BATCH}/01`, '--agent', AGENT, '--claim', 'docs/a.md'));
    expect(started.claims).toEqual(['docs/a.md', 'src/a']);
    expect(started.claimsFrom.worktree).toEqual(['src/a']);
    const entry = JSON.parse(read(main, '.git/novadev/worktrees/t1.json'));
    expect(entry.todos).toEqual([`${BATCH}/01-a`]);
    expect(entry.claims).toEqual(['src/a', 'docs/a.md']);
    const list = json(run(main, 'worktree', 'list', '--json')).worktrees;
    expect(list[0].batches).toEqual([{ batch: BATCH, state: 'working', agent: AGENT, todo: '01-a', ref: `${BATCH}/01-a` }]);
    expect(run(main, 'worktree', 'list').stdout).toContain(`in work: ${BATCH}/01-a`);

    write(wt, 'src/a/x.ts', 'export const x = 1;\n');
    write(wt, 'docs/a.md', 'A.\n');
    write(wt, `.novadev/todos/${BATCH}/01-a/ai_completed.md`, completed('01-a'));
    expect(run(wt, 'work', 'stop', `${BATCH}/01`).code).toBe(0);
    commit(wt, 'a done');
    // The gate accepts the file the lock claimed, after the lock is gone (the claim became the worktree's).
    expect(run(main, 'worktree', 'gate', 't1').stdout).not.toContain('changed outside the claims');
    const mr = run(main, 'worktree', 'mr', 't1').stdout;
    expect(mr).toContain(`Todo: \`${BATCH}/01-a\` — Do the thing. (completed)`);
    expect(mr).not.toContain('in work there');
    // A todo whose record the branch wrote is named too, without ever being locked there.
    write(wt, `.novadev/todos/${BATCH}/02-b/ai_progress.md`, '# ai_progress — 02-b\n\n**Date:** 2026-11-12\n**Feature:** none — test fixture\n');
    commit(wt, 'b started');
    expect(run(main, 'worktree', 'mr', 't1').stdout).toContain(`Todo: \`${BATCH}/02-b\` — Do the thing. (progress)`);
  });

  test('the whole batch started in a worktree makes every open todo of it the worktree\'s', () => {
    const main = repo();
    run(main, 'worktree', 'create', 't1');
    const wt = json(run(main, 'worktree', 'list', '--json')).worktrees[0].path as string;
    write(wt, `.novadev/todos/${BATCH}/03-c/ai_completed.md`, completed('03-c'));
    expect(run(wt, 'work', 'start', BATCH, '--agent', AGENT).code).toBe(0);
    expect(JSON.parse(read(main, '.git/novadev/worktrees/t1.json')).todos).toEqual([`${BATCH}/01-a`, `${BATCH}/02-b`]);
    expect(json(run(main, 'worktree', 'list', '--json')).worktrees[0].batches).toEqual([{ batch: BATCH, state: 'working', agent: AGENT }]);
  });
});

describe('`novadev work start <batch>`: one developer takes the whole batch', () => {
  test('end to end as before: one lock at the batch root, waypoints, pause, resume, stop, complete', () => {
    const root = batchProject();
    git(root, 'init', '-q', '-b', 'main');
    commitAll(root);
    const started = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(started).toMatchObject({ batch: BATCH, path: `.novadev/todos/${BATCH}/working.md`, state: 'working', taken: true, resumed: false, from: null, todo: null });
    expect(started.ref).toBeUndefined();
    expect(started.covers).toBeUndefined();
    // Exactly what 0.17.0 wrote: one file at the batch root, one registry entry named after the batch.
    expect(read(root, `.novadev/todos/${BATCH}/working.md`)).toContain(`# Working — ${BATCH}\n\n<!-- The batch's LOCK`);
    expect(exists(root, LOCK_01)).toBe(false);
    expect(readdirSync(join(root, '.git/novadev/locks'))).toEqual([`${BATCH}.json`]);
    const entry = JSON.parse(read(root, `.git/novadev/locks/${BATCH}.json`));
    expect(Object.keys(entry)).toEqual(['batch', 'worktree', 'branch', 'state', 'agent', 'host', 'pid', 'session', 'started', 'updated', 'todo', 'phase', 'claims']);

    // The round moves from todo to todo in ONE trail.
    run(root, 'work', 'waypoint', BATCH, payload(root, 'w1.json', { todo: '01-a', phase: 3, note: 'A first.' }));
    write(root, `.novadev/todos/${BATCH}/01-a/ai_completed.md`, completed('01-a'));
    run(root, 'work', 'waypoint', BATCH, payload(root, 'w2.json', { todo: '02-b', phase: 3, note: 'A landed; B next.' }));
    const status = run(root, 'status').stdout;
    expect(status).toContain('in work — 1 batch(es)');
    expect(status).toContain(`● ${BATCH} — WORKING: ${AGENT} on ${hostname()}`);
    expect(status).toContain('— at 02-b · phase 3 WORK: "A landed; B next."');
    // The batch's mark says it; its todos carry no holder line of their own.
    expect(status).toContain(`  ${BATCH}  [in work]\n    ✓ 01-a  (completed)\n    · 02-b  (open)\n    · 03-c  (open)\n`);
    // As data, every todo of the batch names the batch's lock as its holder.
    const data = json(run(root, 'status', '--json'));
    expect(data.batches[0].todos.map((t: { holder: { lock: string; unit: string } }) => [t.holder.lock, t.holder.unit])).toEqual([[BATCH, 'batch'], [BATCH, 'batch'], [BATCH, 'batch']]);
    expect(data.batches[0].todos[1].holder).toMatchObject({ phase: 3, latest: 'A landed; B next.' });
    expect(data.batches[0].todos[2].holder).toMatchObject({ phase: null, latest: null });

    const paused = json(run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { todo: '02-b', phase: 3, stopped: 'Half of B.', next: ['Finish B.', 'Then C.'] })));
    expect(paused).toMatchObject({ batch: BATCH, path: `.novadev/todos/${BATCH}/working.md`, state: 'paused', waypoint: 3, todo: '02-b' });
    expect(read(root, `.novadev/todos/${BATCH}/working.md`)).toContain('### Todos at the pause\n\n- ✓ 01-a — completed\n- · 02-b — open\n- · 03-c — open\n');
    expect(run(root, 'sync').stdout).toContain(`⧗ ${BATCH} is PAUSED (`);

    const resumed = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(resumed).toMatchObject({ resumed: true, from: 'paused', state: 'working', todo: '02-b', phase: 3 });
    expect(resumed.latest).toMatchObject({ kind: 'pause', waypoint: 3 });
    for (const name of ['02-b', '03-c']) write(root, `.novadev/todos/${BATCH}/${name}/ai_completed.md`, completed(name));
    expect(run(root, 'sync').stdout).toContain(`— every todo is recorded: \`novadev work stop ${BATCH}\` closes the round`);
    const stopped = json(run(root, 'work', 'stop', BATCH));
    expect(stopped).toMatchObject({ batch: BATCH, state: 'released', path: `.novadev/todos/${BATCH}/working.md`, wasPaused: false, waypoints: 3 });
    expect(stopped.unfinished).toBeUndefined();
    expect(readdirSync(join(root, '.git/novadev/locks'))).toEqual([]);
    run(root, 'sync');
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(true);
  });

  test('the whole batch is refused while a todo of it is in work in another worktree, and a todo while the whole batch is', () => {
    const main = batchProject();
    git(main, 'init', '-q', '-b', 'main');
    commitAll(main);
    const wt = join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'task/a', wt);
    run(wt, 'work', 'start', BATCH, '--agent', AGENT);
    expect(json(run(main, 'work', 'start', `${BATCH}/01`, '--agent', AGENT)).error).toContain(`Batch ${BATCH} is in work in another worktree: `);
    // One lock holds the whole batch: the batch's mark says so, and the line above says where.
    const status = run(main, 'status').stdout;
    expect(status).toContain(`◦ ${BATCH} — WORKING in another worktree: ${wt} (branch task/a) — ${AGENT}`);
    expect(status).toContain(`  ${BATCH}  [in work]\n    · 01-a  (open)\n`);
    expect(json(run(main, 'todo', 'list', '--json')).todos[0].holder).toMatchObject({ lock: BATCH, unit: 'batch', worktree: wt, branch: 'task/a' });
    run(wt, 'work', 'stop', BATCH);
    run(wt, 'work', 'start', `${BATCH}/02`, '--agent', AGENT);
    expect(json(run(main, 'work', 'start', BATCH, '--agent', AGENT)).error).toContain(`Todo ${BATCH}/02-b is in work in another worktree: `);
    // --take moves every todo lock of the batch here, into the one lock on the batch.
    const taken = json(run(main, 'work', 'start', BATCH, '--agent', AGENT, '--take'));
    expect(taken.takenFromWorktree.branch).toBe('task/a');
    expect(readdirSync(join(main, '.git/novadev/locks'))).toEqual([`${BATCH}.json`]);
  });
});

describe('the docs teach the todo as the unit of work', () => {
  test('the playbooks, the folder READMEs, the README, the adapters and the CLI help', () => {
    const playbook = read(REPO, 'templates/skills/novadev-work.md');
    for (const phrase of [
      'The unit of work is the todo: one\ntodo, one owner, one lock',
      'novadev work start 2026-10-24_1/02-dark-mode',
      '`todos/<batch>/<todo>/working.md`',
      '**The whole batch, alone.**',
      '`todos/<batch>/working.md`',
      '**The batch\'s name on the other commands.**',
      '**A lock from an older novadev.**',
      'novadev work waypoint 2026-10-24_1/02-dark-mode',
      'novadev work stop <batch>/<todo>',
      '--todo <batch>/<todo>',
    ]) {
      expect(playbook).toContain(phrase);
    }
    const pause = read(REPO, 'templates/skills/novadev-pause.md');
    for (const phrase of ['`.novadev/todos/<batch>/<todo>/working.md`', 'novadev work pause 2026-10-24_1/02-dark-mode', 'Holding a whole batch as one round']) {
      expect(pause).toContain(phrase);
    }
    expect(read(REPO, 'templates/readmes/todos.md')).toContain('`<batch>/<todo>/working.md`');
    expect(read(REPO, 'templates/readmes/root.md')).toContain('`todos/<batch>/<todo>/working.md`');
    const readme = read(REPO, 'README.md');
    for (const phrase of [
      '**a todo in work carries `todos/<batch>/<todo>/working.md`, its\nlock.**',
      '**The unit of work is the todo**',
      '**The whole batch.**',
      '`<git common dir>/novadev/locks/<batch>.<todo>.json`',
      '**Two todos of one batch**',
      '**Locks written by 0.17.0 and earlier keep working, with no migration.**',
      '`locks/<batch>@<worktree hash>.json`',
      '`--todo <ref>` (repeatable) says which todo the worktree is for',
      '`batches[].todos[].holder`',
    ]) {
      expect(readme).toContain(phrase);
    }
    const help = run(project(), 'help').stdout;
    for (const phrase of ['the lock of a todo in work (todos/<batch>/<todo>/working.md)', '"start <batch>" with no todo: one developer takes the WHOLE batch', '[--todo <ref>]…']) {
      expect(help).toContain(phrase);
    }
  });

  test('the README\'s sample status block is what the CLI prints for those locks', () => {
    const root = project();
    const batch = '2026-10-24_1';
    todo(root, `${batch}/01-fix-login`, { 'ai_completed.md': completed('01-fix-login') });
    todo(root, `${batch}/02-dark-mode`);
    todo(root, `${batch}/03-export`, { 'ai_progress.md': '# ai_progress — 03-export\n\n**Date:** 2026-10-23\n**Feature:** none — test fixture\n' });
    const lock = (name: string, state: 'working' | 'paused', updated: string, phase: number, heading: string, body: string): void => {
      const text: WorkLock = {
        batch, unit: 'todo', path: '', state, agent: 'claude-code/claude-opus-5-5', host: 'fil-desktop', pid: null, session: 's', started: updated, updated,
        resumed: null, todo: name, phase, claims: [], covers: [name], entries: [{ kind: state === 'paused' ? 'pause' : 'waypoint', number: 1, heading, body }],
      };
      write(root, `.novadev/todos/${batch}/${name}/working.md`, renderLock(text));
    };
    const now = nowTimestamp(new Date(Date.now() - 5 * 60000));
    lock('02-dark-mode', 'working', now, 3, `## Waypoint 1 — ${now.slice(0, 16).replace('T', ' ')} · 02-dark-mode · phase 3 WORK`, 'Tokens in src/theme.ts done; wiring the toggle next.');
    lock('03-export', 'paused', '2026-10-23T22:49:30+02:00', 4, '## PAUSED — waypoint 1 — 2026-10-23 22:49 · 03-export · phase 4 RECORD', '### Stopped at\n\nThe CSV writer is done and tested; ai_completed.md needs its Verification section.\n\n### Next\n\n1. Write it.');
    const status = run(root, 'status').stdout.split('\n');
    const readme = read(REPO, 'README.md').split('\n');
    const at = readme.indexOf('in work — 2 todo(s)');
    expect(at).toBeGreaterThan(0);
    // The holder's process is this machine's business: the sample names one, the fixture has none.
    const sample = readme.slice(at, at + 10).map((line) => line.replace(' (process 3702151, alive)', ''));
    expect(status.slice(0, 4)).toEqual(sample.slice(0, 4));
    expect(status.slice(status.indexOf('todos — 1 open batch(es)'), status.indexOf('todos — 1 open batch(es)') + 5)).toEqual(sample.slice(5, 10));
  });
});
