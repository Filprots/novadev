// Backward compatibility of the work lock (batch 2026-11-12_2, todo 02): everything 0.16.0 and 0.17.0
// wrote — a lock on the whole batch (`todos/<batch>/working.md`, `locks/<batch>.json`), a lock on part
// of a batch (`covers:`, `locks/<batch>@<worktree hash>.json`), a worktree's registry entry without
// `todos` — must read, resume, pause, stop, gate and merge as it did, with no migration step. Every
// old file here is written BY HAND, character for character as those versions wrote it, never through
// today's code: the shapes are the contract.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitAll, completed, exists, git, project, read, run, tempDir, todo, write } from './helpers.ts';

const BATCH = '2026-11-11_1';
const AGENT = 'claude-code/test';
const OLD = 'claude-code/old';
const ROOT_LOCK = `.novadev/todos/${BATCH}/working.md`;
const COMMENT =
  "<!-- The batch's LOCK, managed by `novadev work`: an agent is working this batch, or paused in it.\n" +
  '     Newest entry first — the top section is where the work resumes. Never edit it by hand:\n' +
  '     `novadev work waypoint` and `/novadev-pause` write it, `novadev work stop` removes it. -->';

type Old = { state: 'working' | 'paused'; updated?: string; todo?: string | null; covers?: string[]; claims?: string[]; note?: string };

/** `2026-11-11T22:49:30+01:00`, some minutes before now: a heartbeat fresh enough to be a live session's. */
function minutesAgo(minutes: number): string {
  const d = new Date(Date.now() - minutes * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const local = new Date(d.getTime() + offset * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/**
 * `todos/<batch>/working.md` as 0.17.0 rendered it (0.16.0: the same without `covers:`): the header
 * keys in that order, the title, the comment, then the trail — here one pause record or one waypoint.
 */
function oldLockText(o: Old): string {
  const updated = o.updated ?? '2026-11-11T22:49:30+01:00';
  const todoName = o.todo === undefined ? '01-a' : o.todo;
  const header = ['state: ' + o.state, `agent: ${OLD}`, 'host: elsewhere', 'session: session-of-another', 'started: 2026-11-11T18:02:11+01:00', `updated: ${updated}`];
  if (todoName !== null) header.push(`todo: ${todoName}`);
  header.push('phase: 3');
  if ((o.claims ?? []).length > 0) header.push(`claims: ${o.claims!.join(', ')}`);
  if (o.covers !== undefined) header.push(`covers: ${o.covers.join(', ')}`);
  const when = updated.slice(0, 16).replace('T', ' ');
  const where = `${todoName === null ? '' : ` · ${todoName}`} · phase 3 WORK`;
  const note = o.note ?? 'Half of the form.';
  const entry =
    o.state === 'paused'
      ? `## PAUSED — waypoint 2 — ${when}${where}\n\n**By:** ${OLD} on elsewhere\n\n### Stopped at\n\n${note}\n\n### Next\n\n1. Finish the form.\n\n### Todos at the pause\n\n- · 01-a — open\n- · 02-b — open\n- · 03-c — open\n\n## Waypoint 1 — 2026-11-11 18:30${where}\n\nStarted on the form.`
      : `## Waypoint 1 — ${when}${where}\n\n${note}`;
  return `---\n${header.join('\n')}\n---\n\n# Working — ${BATCH}\n\n${COMMENT}\n\n${entry}\n`;
}

/** The registry entry of that lock as 0.17.0 wrote it: these keys, `covers` only for a part, and the file name it chose. */
function oldEntry(common: string, worktree: string, branch: string, o: Old): string {
  const entry: Record<string, unknown> = {
    batch: BATCH,
    worktree,
    branch,
    state: o.state,
    agent: OLD,
    host: 'elsewhere',
    pid: null,
    session: 'session-of-another',
    started: '2026-11-11T18:02:11+01:00',
    updated: o.updated ?? '2026-11-11T22:49:30+01:00',
    todo: o.todo === undefined ? '01-a' : o.todo,
    phase: 3,
    claims: o.claims ?? [],
  };
  if (o.covers !== undefined) entry.covers = o.covers;
  const name = o.covers === undefined ? `${BATCH}.json` : `${BATCH}@${createHash('sha1').update(realpathSync(worktree)).digest('hex').slice(0, 12)}.json`;
  mkdirSync(join(common, 'novadev', 'locks'), { recursive: true });
  writeFileSync(join(common, 'novadev', 'locks', name), `${JSON.stringify(entry, null, 2)}\n`);
  return name;
}

/** Write the old lock into a checkout: the file, and its registry entry in `common` (the main checkout's .git). */
function oldLock(checkout: string, common: string, branch: string, o: Old): string {
  write(checkout, ROOT_LOCK, oldLockText(o));
  return oldEntry(common, checkout, branch, o);
}

/** A project in git on main with batch 2026-11-11_1 of three todos, committed. */
function repo(manifest: Record<string, unknown> = {}): string {
  const root = project(manifest);
  todo(root, `${BATCH}/01-a`);
  todo(root, `${BATCH}/02-b`);
  todo(root, `${BATCH}/03-c`);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'novadev tests');
  git(root, 'config', 'user.email', 'novadev@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.hooksPath', '/dev/null');
  commitAll(root);
  return root;
}

function commit(checkout: string, message: string): void {
  git(checkout, 'add', '-A');
  git(checkout, 'commit', '-q', '-m', message);
}

function json(result: { stdout: string }): Record<string, any> {
  return JSON.parse(result.stdout);
}

function payload(root: string, name: string, value: unknown): string {
  write(root, name, JSON.stringify(value));
  return join(root, name);
}

function locks(main: string): string[] {
  const dir = join(main, '.git', 'novadev', 'locks');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe('a lock on the whole batch, as 0.16.0 and 0.17.0 wrote it', () => {
  test('it reads as it did: status, status --json, sync, todo list', () => {
    const root = repo();
    oldLock(root, join(root, '.git'), 'main', { state: 'paused' });
    const status = run(root, 'status').stdout;
    expect(status.split('\n').slice(0, 3)).toEqual([
      'in work — 1 batch(es)',
      `  ‖ ${BATCH} — PAUSED 2026-11-11 22:49 by ${OLD} — at 01-a · phase 3 WORK: "Half of the form."`,
      '  → a paused batch resumes with `/novadev-work`; it reads the PAUSED section of working.md first',
    ]);
    expect(status).toContain(`  ${BATCH}  [paused]\n    · 01-a  (open)\n    · 02-b  (open)\n    · 03-c  (open)\n`);
    const synced = run(root, 'sync').stdout;
    expect(synced).toContain(`in work (1):\n  ‖ ${BATCH} — PAUSED 2026-11-11 22:49 by ${OLD} — at 01-a · phase 3 WORK: "Half of the form."`);
    expect(synced).toContain(`⧗ ${BATCH} is PAUSED (2026-11-11 22:49, at 01-a · phase 3 WORK) — \`/novadev-work\` resumes it from todos/${BATCH}/working.md`);
    expect(exists(root, `.novadev/todos/${BATCH}/completed.md`)).toBe(false);
    const data = json(run(root, 'status', '--json'));
    expect(data.inWork).toHaveLength(1);
    expect(data.inWork[0]).toMatchObject({ batch: BATCH, state: 'paused', live: false, liveness: 'paused', agent: OLD, host: 'elsewhere', covers: null, todo: '01-a', phase: 3, phaseLabel: 'phase 3 WORK', latest: 'Half of the form.', entries: 2 });
    expect(data.batches[0]).toMatchObject({ batch: BATCH, readyToArchive: false, inWork: 'paused' });
    expect(json(run(root, 'todo', 'show', `${BATCH}/02`)).batchInWork).toMatchObject({ state: 'paused', agent: OLD, todo: '01-a' });
    expect(run(root, 'doctor').stdout).toContain(`${BATCH} is PAUSED (2026-11-11 22:49, at 01-a · phase 3 WORK)`);
  });

  test('it resumes, takes waypoints, claims and pauses, and stops — in the same file, under the same registry name', () => {
    const root = repo();
    expect(oldLock(root, join(root, '.git'), 'main', { state: 'paused', claims: ['src/form'] })).toBe(`${BATCH}.json`);
    const resumed = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(resumed).toMatchObject({ batch: BATCH, path: ROOT_LOCK, state: 'working', taken: true, resumed: true, from: 'paused', previous: { state: 'paused', agent: OLD }, todo: '01-a', phase: 3, claims: ['src/form'] });
    expect(resumed.ref).toBeUndefined();
    expect(resumed.covers).toBeUndefined();
    expect(resumed.latest).toMatchObject({ kind: 'pause', waypoint: 2 });
    expect(resumed.latest.text).toContain('### Stopped at\n\nHalf of the form.');
    // The file is still the batch's, written the old way, its trail kept; no todo got a lock of its own.
    const text = read(root, ROOT_LOCK);
    expect(text).toContain(`\nclaims: src/form\n---\n\n# Working — ${BATCH}\n\n${COMMENT}\n\n## PAUSED — waypoint 2 — 2026-11-11 22:49 · 01-a · phase 3 WORK`);
    expect(text).not.toContain('covers:');
    expect(exists(root, `.novadev/todos/${BATCH}/01-a/working.md`)).toBe(false);
    expect(locks(root)).toEqual([`${BATCH}.json`]);
    const entry = JSON.parse(read(root, `.git/novadev/locks/${BATCH}.json`));
    expect(entry).toMatchObject({ batch: BATCH, state: 'working', agent: AGENT, todo: '01-a', phase: 3, claims: ['src/form'] });
    expect(entry.unit).toBeUndefined();
    expect(entry.covers).toBeUndefined();

    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'w.json', { todo: '02-b', phase: 3, note: 'The form is done; B next.' })))).toMatchObject({ batch: BATCH, path: ROOT_LOCK, waypoint: 3, todo: '02-b' });
    expect(json(run(root, 'work', 'claim', BATCH, 'docs/'))).toMatchObject({ batch: BATCH, path: ROOT_LOCK, added: ['docs'], claims: ['src/form', 'docs'] });
    const paused = json(run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { stopped: 'B half done.', next: ['Finish B.'] })));
    expect(paused).toMatchObject({ batch: BATCH, path: ROOT_LOCK, state: 'paused', waypoint: 4, todo: '02-b', phase: 3 });
    expect(read(root, ROOT_LOCK)).toContain('### Todos at the pause\n\n- · 01-a — open\n- · 02-b — open\n- · 03-c — open\n');
    const stopped = json(run(root, 'work', 'stop', BATCH));
    expect(stopped).toMatchObject({ batch: BATCH, state: 'released', path: ROOT_LOCK, wasPaused: true, waypoints: 4, unfinished: ['01-a', '02-b', '03-c'] });
    expect(stopped.covers).toBeUndefined();
    expect(exists(root, ROOT_LOCK)).toBe(false);
    expect(locks(root)).toEqual([]);
  });

  test('a live one still holds every todo of the batch: a todo of it cannot be started beside it, here or in another worktree', () => {
    const main = repo();
    const wt = join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'task/a', wt);
    oldLock(wt, join(main, '.git'), 'task/a', { state: 'working', updated: minutesAgo(4) });
    expect(json(run(main, 'work', 'start', `${BATCH}/02`, '--agent', AGENT)).error).toBe(
      `Batch ${BATCH} is in work in another worktree: ${wt} (branch task/a) — ${OLD} on elsewhere, last waypoint 4 min ago. If that session is gone, pass --take.`,
    );
    expect(json(run(main, 'work', 'start', BATCH, '--agent', AGENT)).error).toContain(`Batch ${BATCH} is in work in another worktree: ${wt}`);
    expect(run(main, 'sync').stdout).toContain(`◦ ${BATCH} — WORKING in another worktree: ${wt} (branch task/a) — ${OLD}, last waypoint 4 min ago, at 01-a · phase 3 WORK`);
    write(main, 'add.json', JSON.stringify({ text: 'More.' }));
    expect(json(run(main, 'todo', 'addendum', `${BATCH}/03-c`, 'add.json')).error).toBe(`${BATCH} is in work right now in another worktree (${wt}, ${OLD}): tell that session, or try again when it pauses or stops.`);
    // In its own worktree: held by a live session, and never narrowed.
    expect(json(run(wt, 'work', 'start', BATCH, '--agent', AGENT)).error).toBe(
      `Batch ${BATCH} is in work: ${OLD} on elsewhere, last waypoint 4 min ago, at 01-a · phase 3 WORK. If that session is gone, pass --take to take the lock over.`,
    );
    expect(json(run(wt, 'work', 'start', `${BATCH}/02`, '--agent', AGENT)).error).toContain(`Batch ${BATCH} is locked here for all its todos — --todo cannot narrow that lock.`);
  });
});

describe('a lock on part of a batch, as 0.17.0 wrote it (`covers:`)', () => {
  test('it reads as it did, and each todo it covers names its holder', () => {
    const root = repo();
    const name = oldLock(root, join(root, '.git'), 'main', { state: 'paused', covers: ['01-a', '02-b'] });
    expect(name).toMatch(new RegExp(`^${BATCH}@[0-9a-f]{12}\\.json$`));
    const status = run(root, 'status').stdout;
    expect(status.split('\n').slice(0, 2)).toEqual([
      'in work — 1 batch(es)',
      `  ‖ ${BATCH} (todos 01-a, 02-b) — PAUSED 2026-11-11 22:49 by ${OLD} — at 01-a · phase 3 WORK: "Half of the form."`,
    ]);
    expect(status).toContain(`  ${BATCH}  [paused]\n    · 01-a  (open) — paused 2026-11-11 22:49 by ${OLD}, phase 3 WORK (the lock on ${BATCH})\n    · 02-b  (open) — paused 2026-11-11 22:49 by ${OLD} (the lock on ${BATCH})\n    · 03-c  (open)\n`);
    expect(run(root, 'sync').stdout).toContain(`⧗ ${BATCH} is PAUSED (2026-11-11 22:49, at 01-a · phase 3 WORK) — \`/novadev-work\` resumes it from todos/${BATCH}/working.md`);
    const data = json(run(root, 'status', '--json'));
    expect(data.inWork[0]).toMatchObject({ batch: BATCH, state: 'paused', covers: ['01-a', '02-b'], todo: '01-a' });
    expect(data.batches[0].todos.map((t: { holder: { lock: string } | null }) => t.holder?.lock ?? null)).toEqual([BATCH, BATCH, null]);
  });

  test('it resumes by the batch, or by a todo it covers — the same file, the same registry name, `covers:` kept', () => {
    const root = repo();
    const name = oldLock(root, join(root, '.git'), 'main', { state: 'paused', covers: ['01-a', '02-b'], claims: ['src/form'] });
    const resumed = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(resumed).toMatchObject({ batch: BATCH, path: ROOT_LOCK, state: 'working', resumed: true, from: 'paused', covers: ['01-a', '02-b'], claims: ['src/form'] });
    expect(resumed.ref).toBeUndefined();
    expect(resumed.latest.kind).toBe('pause');
    expect(read(root, ROOT_LOCK)).toContain('\nclaims: src/form\ncovers: 01-a, 02-b\n---\n');
    expect(locks(root)).toEqual([name]);
    const entry = JSON.parse(read(root, `.git/novadev/locks/${name}`));
    expect(entry).toMatchObject({ state: 'working', agent: AGENT, covers: ['01-a', '02-b'] });
    expect(entry.unit).toBeUndefined();
    // By a todo it covers, in either spelling: the old lock answers; the todo gets no second lock.
    for (const args of [[BATCH, '--todo', '01'], [`${BATCH}/02`], [BATCH, '--todo', '01', '--todo', 'b']]) {
      const again = json(run(root, 'work', 'start', ...args, '--agent', AGENT));
      expect(again).toMatchObject({ path: ROOT_LOCK, from: 'same-session', covers: ['01-a', '02-b'] });
    }
    expect(exists(root, `.novadev/todos/${BATCH}/01-a/working.md`)).toBe(false);
    expect(exists(root, `.novadev/todos/${BATCH}/02-b/working.md`)).toBe(false);

    // Waypoint and pause by the batch, or by a covered todo: all into the old lock.
    expect(json(run(root, 'work', 'waypoint', BATCH, payload(root, 'w.json', { todo: '02-b', note: 'On B.' }))).path).toBe(ROOT_LOCK);
    expect(json(run(root, 'work', 'waypoint', `${BATCH}/01`, payload(root, 'w2.json', { note: 'On A.' })))).toMatchObject({ path: ROOT_LOCK, todo: '01-a', waypoint: 4 });
    expect(json(run(root, 'work', 'pause', BATCH, payload(root, 'p.json', { stopped: 'A half done.', next: ['Finish A.'] })))).toMatchObject({ path: ROOT_LOCK, state: 'paused', waypoint: 5 });
    expect(JSON.parse(read(root, `.git/novadev/locks/${name}`)).state).toBe('paused');
    // A stop releases the part as a whole, and names only its todos as unfinished.
    expect(json(run(root, 'work', 'stop', `${BATCH}/01`))).toEqual({
      error: `Todo ${BATCH}/01-a is held by the lock on todos 01-a, 02-b (todos/${BATCH}/working.md) — a todo is not taken out of it: \`novadev work stop ${BATCH}\` releases that lock.`,
    });
    const stopped = json(run(root, 'work', 'stop', BATCH));
    expect(stopped).toMatchObject({ batch: BATCH, state: 'released', path: ROOT_LOCK, covers: ['01-a', '02-b'], wasPaused: true, unfinished: ['01-a', '02-b'] });
    expect(exists(root, ROOT_LOCK)).toBe(false);
    expect(locks(root)).toEqual([]);
  });

  test('a todo it does not cover gets its own lock beside it; the batch\'s name then speaks of both', () => {
    const root = repo();
    const name = oldLock(root, join(root, '.git'), 'main', { state: 'paused', covers: ['01-a'] });
    const third = json(run(root, 'work', 'start', BATCH, '--todo', '03', '--agent', AGENT));
    expect(third).toMatchObject({ ref: `${BATCH}/03-c`, path: `.novadev/todos/${BATCH}/03-c/working.md`, covers: ['03-c'], from: null });
    // The old lock is as it was: still paused, still covering its todo, still under its old name.
    expect(read(root, ROOT_LOCK)).toBe(oldLockText({ state: 'paused', covers: ['01-a'] }));
    expect(locks(root)).toEqual([`${BATCH}.03-c.json`, name].sort());
    const status = run(root, 'status').stdout;
    expect(status).toContain('in work — 1 todo(s), 1 batch(es)');
    expect(status).toContain(`‖ ${BATCH} (todos 01-a) — PAUSED 2026-11-11 22:49 by ${OLD}`);
    expect(status).toContain(`● ${BATCH}/03-c — WORKING: ${AGENT}`);
    const both = json(run(root, 'work', 'start', BATCH, '--agent', AGENT));
    expect(both.locks.map((l: { path: string; from: string }) => [l.path, l.from])).toEqual([[ROOT_LOCK, 'paused'], [`.novadev/todos/${BATCH}/03-c/working.md`, 'same-session']]);
    // A part of exactly one todo may be stopped by that todo's name.
    expect(json(run(root, 'work', 'stop', `${BATCH}/01`))).toMatchObject({ batch: BATCH, path: ROOT_LOCK, covers: ['01-a'], state: 'released' });
    expect(locks(root)).toEqual([`${BATCH}.03-c.json`]);
  });

  test('in another worktree it holds its todos as it did: they are refused here, the others are free', () => {
    const main = repo();
    const wt = join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'task/a', wt);
    oldLock(wt, join(main, '.git'), 'task/a', { state: 'working', updated: minutesAgo(4), covers: ['01-a'], claims: ['src/form'] });
    const synced = run(main, 'sync').stdout;
    expect(synced).toContain(`◦ ${BATCH} (todos 01-a) — WORKING in another worktree: ${wt} (branch task/a) — ${OLD}, last waypoint 4 min ago, at 01-a · phase 3 WORK; claims src/form`);
    const status = run(main, 'status').stdout;
    expect(status).toContain(`${wt}  task/a — ${BATCH} (todos 01-a) in work (${OLD}), claims src/form`);
    expect(status).toContain(`  ${BATCH}  [in work]\n    · 01-a  (open) — in work: ${OLD} in ${wt} (branch task/a), phase 3 WORK (the lock on ${BATCH})\n    · 02-b  (open)\n`);
    for (const args of [[BATCH, '--todo', '01'], [`${BATCH}/01-a`]]) {
      expect(json(run(main, 'work', 'start', ...args, '--agent', AGENT)).error).toBe(
        `Batch ${BATCH} (its todos 01-a) is in work in another worktree: ${wt} (branch task/a) — ${OLD} on elsewhere, last waypoint 4 min ago. If that session is gone, pass --take.`,
      );
    }
    expect(json(run(main, 'work', 'start', BATCH, '--agent', AGENT)).error).toContain(`Batch ${BATCH} (its todos 01-a) is in work in another worktree: `);
    expect(json(run(main, 'work', 'start', `${BATCH}/02`, '--agent', AGENT, '--claim', 'src/form/a.ts')).error).toContain(`src/form/a.ts overlaps src/form — claimed by batch ${BATCH} in ${wt} on branch task/a (${OLD})`);
    expect(json(run(main, 'work', 'start', `${BATCH}/02`, '--agent', AGENT)).path).toBe(`.novadev/todos/${BATCH}/02-b/working.md`);
    write(main, 'add.json', JSON.stringify({ text: 'More.' }));
    expect(json(run(main, 'todo', 'addendum', `${BATCH}/01-a`, 'add.json')).error).toContain(`${BATCH} is in work right now in another worktree`);
    expect(run(main, 'todo', 'addendum', `${BATCH}/03-c`, 'add.json').code).toBe(0);
    expect(run(main, 'archive', BATCH).stderr).toContain('is in work in another worktree');
    // --take moves that part here: its registry entry goes, and the todo is this worktree's own lock.
    const taken = json(run(main, 'work', 'start', `${BATCH}/01`, '--agent', AGENT, '--take'));
    expect(taken).toMatchObject({ ref: `${BATCH}/01-a`, takenFromWorktree: { branch: 'task/a', agent: OLD } });
    expect(locks(main)).toEqual([`${BATCH}.01-a.json`, `${BATCH}.02-b.json`]);
    expect(json(run(wt, 'work', 'waypoint', BATCH, payload(wt, 'w.json', { note: 'x' }))).error).toContain(`Batch ${BATCH} was taken over in another worktree: `);
  });
});

describe('worktrees and merges with locks 0.17.0 left', () => {
  /** A project with a worktree folder, and worktrees t1 and t2 whose registry entries are as 0.17.0 wrote them (no `todos`). */
  function withWorktrees(): { main: string; t1: string; t2: string } {
    const main = repo({ worktree: { dir: join(tempDir(), 'wts') } });
    run(main, 'worktree', 'create', 't1', '--claim', 'src/a/');
    run(main, 'worktree', 'create', 't2', '--claim', 'src/b/');
    for (const name of ['t1', 't2']) {
      const path = join(main, '.git', 'novadev', 'worktrees', `${name}.json`);
      const { todos: _todos, ...entry } = JSON.parse(read(main, `.git/novadev/worktrees/${name}.json`));
      writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`);
    }
    const [t1, t2] = json(run(main, 'worktree', 'list', '--json')).worktrees.map((w: { path: string }) => w.path) as [string, string];
    return { main, t1, t2 };
  }

  test('list, status, gate and mr read an old worktree and the old lock in it', () => {
    const { main, t1, t2 } = withWorktrees();
    oldLock(t1, join(main, '.git'), 't1', { state: 'paused', covers: ['01-a'], claims: ['src/a', 'docs/a.md'] });
    oldLock(t2, join(main, '.git'), 't2', { state: 'working', updated: minutesAgo(2), todo: null });
    const list = json(run(main, 'worktree', 'list', '--json')).worktrees;
    expect(list[0]).toMatchObject({ name: 't1', claims: ['src/a'], todos: [], batches: [{ batch: BATCH, state: 'paused', agent: OLD, covers: ['01-a'] }] });
    expect(list[1].batches).toEqual([{ batch: BATCH, state: 'working', agent: OLD }]);
    const text = run(main, 'worktree', 'list').stdout.split('\n');
    expect(text[0]).toBe(`${'t1'.padEnd(24)} ${'t1'.padEnd(32)} repos: -  claims: src/a  in work: ${BATCH} (paused)`);
    expect(text[1]).toBe(`${'t2'.padEnd(24)} ${'t2'.padEnd(32)} repos: -  claims: src/b  in work: ${BATCH}`);

    // The gate accepts a file the old lock claimed (`work claim` kept it in the lock only).
    write(t1, 'docs/a.md', 'A.\n');
    write(t1, 'src/a/x.ts', 'export const x = 1;\n');
    commit(t1, 'a, with its paused lock');
    const gate = run(main, 'worktree', 'gate', 't1');
    expect(gate.stdout).toContain('✓ gate passed for t1');
    const mr = run(main, 'worktree', 'mr', 't1').stdout;
    expect(mr).toContain('**Merge request: t1** — branch `t1`');
    expect(mr).toContain(`Todo: \`${BATCH}/01-a\` — Do the thing. (open)`);
    expect(mr).toContain('Claims: src/a, docs/a.md');
    expect(mr).toContain(`Batches in work there: ${BATCH} — stop (or pause) them before the merge`);
    // A worktree with no lock and no `todos` names no todo, as before.
    run(t2, 'work', 'stop', BATCH, '--take');
    expect(run(main, 'worktree', 'mr', 't2').stdout.split('\n').slice(0, 2)).toEqual([`**Merge request: t2** — branch \`t2\` (worktree \`${t2}\`)`, '']);
  });

  test('an old lock still WORKING on the branch refuses the merge with the old words; paused, it travels', () => {
    const { main, t1 } = withWorktrees();
    oldLock(t1, join(main, '.git'), 't1', { state: 'working', updated: minutesAgo(2) });
    write(t1, 'src/a/x.ts', 'export const x = 1;\n');
    commit(t1, 'a, with its lock');
    expect(run(main, 'worktree', 'merge', 't1').stdout).toContain(`✗ the branch carries a batch still in work (${ROOT_LOCK}) — stop it (or pause it) in the worktree, commit, then merge`);
    oldLock(t1, join(main, '.git'), 't1', { state: 'paused' });
    commit(t1, 'paused');
    expect(run(main, 'worktree', 'merge', 't1', '--yes').stdout).toContain('✓ merged t1 into project main');
    expect(read(main, ROOT_LOCK)).toBe(oldLockText({ state: 'paused' }));
    expect(run(main, 'status').stdout).toContain(`‖ ${BATCH} — PAUSED 2026-11-11 22:49 by ${OLD}`);
    // The worktree removed, the batch resumes on the default branch from its pause record.
    run(main, 'worktree', 'remove', 't1');
    expect(json(run(main, 'work', 'start', BATCH, '--agent', AGENT))).toMatchObject({ from: 'paused', path: ROOT_LOCK });
  });

  test('two paused parts of one batch (todo 2026-11-12_2/01): the first merges, the second is refused with the reason, and merges once stopped', () => {
    const { main, t1, t2 } = withWorktrees();
    oldLock(t1, join(main, '.git'), 't1', { state: 'paused', covers: ['01-a'], note: 'Half of A.' });
    write(t1, 'src/a/x.ts', 'export const x = 1;\n');
    commit(t1, 'part 01, paused');
    oldLock(t2, join(main, '.git'), 't2', { state: 'paused', covers: ['02-b'], todo: '02-b', note: 'Half of B.' });
    write(t2, 'src/b/y.ts', 'export const y = 1;\n');
    commit(t2, 'part 02, paused');

    expect(run(main, 'worktree', 'merge', 't1', '--yes').stdout).toContain('✓ merged t1 into project main');
    const refused = run(main, 'worktree', 'merge', 't2', '--yes');
    expect(refused.code).toBe(1);
    expect(refused.stdout.trim()).toBe(
      `✗ project: t2 carries a paused lock on part of a batch (${ROOT_LOCK}), and main already holds another part's — two parts of one batch share that one file. Nothing merged. Finish or stop this part in the worktree (\`novadev work stop ${BATCH}\`), commit, then merge.`,
    );
    expect(exists(main, 'src/b/y.ts')).toBe(false);
    expect(read(main, ROOT_LOCK)).toBe(oldLockText({ state: 'paused', covers: ['01-a'], note: 'Half of A.' }));

    write(t2, `.novadev/todos/${BATCH}/02-b/ai_completed.md`, completed('02-b'));
    expect(json(run(t2, 'work', 'stop', BATCH))).toMatchObject({ state: 'released', covers: ['02-b'], wasPaused: true });
    commit(t2, 'part 02 done, stopped');
    expect(run(main, 'worktree', 'merge', 't2', '--yes').stdout).toContain('✓ merged t2 into project main');
    expect(exists(main, 'src/b/y.ts')).toBe(true);
    // The default branch shows the part that is still paused, and only that one.
    const status = run(main, 'status').stdout;
    expect(status).toContain(`  ‖ ${BATCH} (todos 01-a) — PAUSED 2026-11-11 22:49 by ${OLD} — at 01-a · phase 3 WORK: "Half of A."`);
    expect(status).not.toContain('Half of B.');
    expect(status).toContain('    ✓ 02-b  (completed)\n');
  });
});
