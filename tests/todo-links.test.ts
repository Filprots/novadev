// "Do after" links (todo-links.ts): `after` in the filing payload and `novadev todo after`, the refusal of
// `novadev work start` while a dependency is not completed, `ready` / `waits for` in the lists and the
// JSON, and what sync and doctor say about a link to no todo, to a cancelled one, and a cycle.
import { describe, expect, test } from 'bun:test';
import { statusData } from '../src/status.ts';
import { afterTodo, listTodos } from '../src/todo.ts';
import { auditTodoLinks, linkPath, refuseWaitingTodos, resolveLinkRef, todoIndex } from '../src/todo-links.ts';
import { forgetReviewCache } from '../src/review.ts';
import { completed, exists, git, project, read, readJson, run, todo, write } from './helpers.ts';

const BATCH = '2026-10-01_1';
const AGENT = 'claude-code/test';
const NOW = new Date('2026-10-25T12:00:00Z');
const BRIEF = (title: string) => `# prompt — x\n\n## ${title}\nThe words.\n`;

function json(result: { stdout: string }): Record<string, any> {
  return JSON.parse(result.stdout);
}

function payload(root: string, name: string, value: unknown): string {
  write(root, name, JSON.stringify(value));
  return name;
}

/** One batch: 01-schema, 02-api, 03-ui — and a second batch with 01-docs. No links yet. */
function chain(manifest: Record<string, unknown> = {}): string {
  const root = project(manifest);
  todo(root, `${BATCH}/01-schema`, { 'prompt.md': BRIEF('The schema') });
  todo(root, `${BATCH}/02-api`, { 'prompt.md': BRIEF('The API') });
  todo(root, `${BATCH}/03-ui`, { 'prompt.md': BRIEF('The screen') });
  todo(root, '2026-10-02_1/01-docs', { 'prompt.md': BRIEF('The docs') });
  return root;
}

const done = (root: string, ref: string) => write(root, `.novadev/todos/${ref}/ai_completed.md`, completed(ref.split('/')[1]!));
const start = (root: string, batch: string, ...extra: string[]) => run(root, 'work', 'start', batch, '--agent', AGENT, ...extra);

describe('novadev todo after', () => {
  test('adds links by ref, by number or by a word of the slug; the full refs are stored, with who and when', () => {
    const root = chain();
    const nd = `${root}/.novadev`;
    const r = afterTodo(nd, `${BATCH}/03`, [`${BATCH}/02`, 'schema'], { by: 'claude-code/lead' }, NOW);
    expect(r).toEqual({
      ref: `${BATCH}/03-ui`,
      after: [`${BATCH}/02-api`, `${BATCH}/01-schema`],
      waitsFor: [{ ref: `${BATCH}/02-api`, state: 'open' }, { ref: `${BATCH}/01-schema`, state: 'open' }],
      ready: false,
      changed: true,
      written: `todos/${BATCH}/03-ui/todo.json`,
    });
    const meta = readJson(root, `.novadev/todos/${BATCH}/03-ui/todo.json`);
    expect(meta.after).toEqual([`${BATCH}/02-api`, `${BATCH}/01-schema`]);
    expect(meta.history).toEqual([{ at: meta.history[0].at, by: 'claude-code/lead', change: 'after', from: [], to: [`${BATCH}/02-api`, `${BATCH}/01-schema`] }]);
    expect(meta).not.toHaveProperty('priority');
    // the same link again changes nothing; with no refs the command only shows them
    expect(afterTodo(nd, 'ui', ['api'], {}, NOW)).toMatchObject({ changed: false, written: null });
    expect(afterTodo(nd, 'ui', [])).toEqual({ ref: `${BATCH}/03-ui`, after: [`${BATCH}/02-api`, `${BATCH}/01-schema`], waitsFor: [{ ref: `${BATCH}/02-api`, state: 'open' }, { ref: `${BATCH}/01-schema`, state: 'open' }], ready: false });
  });

  test('--clear removes the links, or replaces them with the ones named; the CLI takes --by', () => {
    const root = chain();
    expect(json(run(root, 'todo', 'after', 'ui', 'api', 'schema', '--by', 'human:filipp'))).toMatchObject({ after: [`${BATCH}/02-api`, `${BATCH}/01-schema`], changed: true });
    expect(json(run(root, 'todo', 'after', 'ui', '--clear', '2026-10-02_1/01'))).toMatchObject({ after: ['2026-10-02_1/01-docs'], changed: true });
    expect(json(run(root, 'todo', 'after', 'ui'))).toMatchObject({ after: ['2026-10-02_1/01-docs'], ready: false });
    expect(json(run(root, 'todo', 'after', 'ui', '--clear'))).toMatchObject({ after: [], waitsFor: [], ready: true, changed: true });
    const history = readJson(root, `.novadev/todos/${BATCH}/03-ui/todo.json`).history;
    expect(history.map((h: any) => [h.by, h.to.length])).toEqual([['human:filipp', 2], [null, 1], [null, 0]]);
    expect(readJson(root, `.novadev/todos/${BATCH}/03-ui/todo.json`)).not.toHaveProperty('after');
  });

  test('refused: itself, a todo nobody has, a word several todos have, a finished todo, and a link that closes a cycle', () => {
    const root = chain();
    const nd = `${root}/.novadev`;
    todo(root, '2026-10-03_1/01-done', { 'ai_completed.md': completed('01-done') });
    expect(() => afterTodo(nd, 'ui', ['ui'])).toThrow(`${BATCH}/03-ui cannot wait for itself.`);
    expect(() => afterTodo(nd, 'ui', ['2026-01-01_1/01-nothing'])).toThrow('No todo matches "2026-01-01_1/01-nothing" — name it as <batch>/<todo> (an archived todo by its batch and number).');
    expect(() => afterTodo(nd, 'ui', ['0'])).toThrow(/"0" matches 5 todos/);
    expect(() => afterTodo(nd, '2026-10-03_1/01', ['api'])).toThrow('2026-10-03_1/01-done is finished (completed): it waits for nothing any more.');
    afterTodo(nd, 'api', ['schema']);
    afterTodo(nd, 'ui', ['api']);
    expect(() => afterTodo(nd, 'schema', ['ui'])).toThrow(
      `${BATCH}/01-schema cannot wait for ${BATCH}/03-ui: ${BATCH}/03-ui already waits for it (${BATCH}/03-ui → ${BATCH}/02-api → ${BATCH}/01-schema → ${BATCH}/03-ui), so neither could ever start.`,
    );
    expect(exists(root, `.novadev/todos/${BATCH}/01-schema/todo.json`)).toBe(false);
    expect(json(run(root, 'todo', 'after', 'schema', 'ui')).error).toContain('already waits for it');
    expect(linkPath(`${BATCH}/03-ui`, `${BATCH}/01-schema`, todoIndex(nd))).toEqual([`${BATCH}/03-ui`, `${BATCH}/02-api`, `${BATCH}/01-schema`]);
  });
});

describe('filing with links', () => {
  test('a part waits for another part of the same filing (by its slug) and for an existing todo; the refs are stored', () => {
    const root = chain();
    const filed = json(
      run(root, 'file-todo', 'file', payload(root, 'f.json', {
        by: 'human:filipp',
        parts: [
          { slug: 'new-table', title: 'A table', request: 'add the table' },
          { slug: 'fill-table', title: 'Fill it', request: 'fill the table', after: ['new-table', `${BATCH}/01`], priority: 'high' },
        ],
      })),
    ).filed as { ref: string; after?: string[]; priority?: string }[];
    expect(filed[0]).not.toHaveProperty('after');
    expect(filed[1]).toMatchObject({ after: [filed[0]!.ref, `${BATCH}/01-schema`], priority: 'high' });
    const meta = readJson(root, `.novadev/todos/${filed[1]!.ref}/todo.json`);
    expect(meta).toMatchObject({ priority: 'high', after: [filed[0]!.ref, `${BATCH}/01-schema`], history: [{ by: 'human:filipp', change: 'filed', to: { priority: 'high', after: [filed[0]!.ref, `${BATCH}/01-schema`] } }] });
    expect(exists(root, `.novadev/todos/${filed[0]!.ref}/todo.json`)).toBe(false);
  });

  test('refused before anything is written: a link to no todo, parts that wait for each other, a part that waits for itself, an "after" that is no list', () => {
    const root = project();
    const file = (parts: unknown[]) => json(run(root, 'file-todo', 'file', payload(root, 'f.json', { parts })));
    expect(file([{ slug: 'one', title: 'One', request: 'x', after: ['2026-01-01_1/01-nothing'] }]).error).toContain('No todo matches "2026-01-01_1/01-nothing"');
    expect(file([{ slug: 'one', title: 'One', request: 'x', after: ['two'] }, { slug: 'two', title: 'Two', request: 'y', after: ['one'] }]).error).toMatch(/^Parts wait for each other \(.*01-one → .*02-two → .*01-one\): none of them could ever start\. Remove one 'after'\.$/);
    expect(file([{ slug: 'one', title: 'One', request: 'x', after: ['one'] }]).error).toBe("Part 'one' cannot wait for itself.");
    expect(file([{ slug: 'one', title: 'One', request: 'x', after: 'two' }]).error).toContain("A part's 'after' must be a list of todos it waits for");
    expect(exists(root, '.novadev/todos')).toBe(false);
  });
});

describe('novadev work start and the links', () => {
  test('a todo that waits is refused, naming what it waits for; once that is completed the same start goes through', () => {
    const root = chain();
    afterTodo(`${root}/.novadev`, 'docs', [`${BATCH}/01`]);
    const refused = start(root, '2026-10-02_1');
    expect(refused.code).toBe(1);
    expect(json(refused).error).toBe(
      `Not started — 2026-10-02_1/01-docs waits for ${BATCH}/01-schema (open). A todo starts once every todo it waits for is completed. Wait for them. ` +
        'When the person or the lead decided the order no longer holds, remove the link first: `novadev todo after 2026-10-02_1/01-docs --clear`.',
    );
    expect(exists(root, '.novadev/todos/2026-10-02_1/working.md')).toBe(false);
    done(root, `${BATCH}/01-schema`);
    const allowed = start(root, '2026-10-02_1');
    expect(allowed.code).toBe(0);
    expect(json(allowed)).toMatchObject({ taken: true });
  });

  test('--todo: only the todos the start covers are judged; a dependency in another part of the batch must be completed', () => {
    const root = chain();
    const nd = `${root}/.novadev`;
    afterTodo(nd, 'api', ['schema']);
    // 03-ui waits for nothing: starting it alone is fine although 02-api of the same batch waits
    expect(start(root, BATCH, '--todo', '03').code).toBe(0);
    expect(run(root, 'work', 'stop', BATCH).code).toBe(0);
    const refused = json(start(root, BATCH, '--todo', '02'));
    expect(refused.error).toContain(`Not started — ${BATCH}/02-api waits for ${BATCH}/01-schema (open).`);
    expect(refused.error).toContain('Wait for them.');
    // both in one start: one holder works them in order
    expect(start(root, BATCH, '--todo', '01', '--todo', '02').code).toBe(0);
  });

  test('a whole-batch start goes through when every dependency is inside the batch; one outside it must be completed', () => {
    const root = chain();
    const nd = `${root}/.novadev`;
    afterTodo(nd, 'api', ['schema']);
    afterTodo(nd, 'ui', ['api']);
    expect(() => refuseWaitingTodos(nd, BATCH, null)).not.toThrow();
    expect(start(root, BATCH).code).toBe(0);
    expect(run(root, 'work', 'stop', BATCH).code).toBe(0);
    afterTodo(nd, 'ui', ['2026-10-02_1/01']);
    const refused = json(start(root, BATCH));
    expect(refused.error).toBe(
      `Not started — ${BATCH}/03-ui waits for 2026-10-02_1/01-docs (open). A todo starts once every todo it waits for is completed. ` +
        `Start only the todos that are ready (\`novadev work start ${BATCH} --todo <nn>\`; \`novadev todo list\` says which), or wait. ` +
        `When the person or the lead decided the order no longer holds, remove the link first: \`novadev todo after ${BATCH}/03-ui --clear\`.`,
    );
    // removing the link is the recorded way to start early
    expect(json(run(root, 'todo', 'after', `${BATCH}/03`, '--clear', 'api', '--by', 'human:filipp'))).toMatchObject({ changed: true });
    expect(start(root, BATCH).code).toBe(0);
  });

  test('a dependency that did not land holds the todo even inside the same start; a finished todo of the batch is not judged', () => {
    const root = chain();
    const nd = `${root}/.novadev`;
    afterTodo(nd, 'api', ['schema']);
    afterTodo(nd, 'ui', ['api']);
    write(root, `.novadev/todos/${BATCH}/01-schema/ai_failed.md`, '# ai_failed — 01-schema\n\n**Feature:** none — cancelled\n');
    expect(() => refuseWaitingTodos(nd, BATCH, null)).toThrow(`Not started — ${BATCH}/02-api waits for ${BATCH}/01-schema (did not land).`);
    done(root, `${BATCH}/02-api`);
    // 02-api is finished now: it is not being started, and 03-ui's dependency is satisfied
    expect(() => refuseWaitingTodos(nd, BATCH, null)).not.toThrow();
  });

  test('an archived completed dependency is satisfied', () => {
    const root = chain();
    const nd = `${root}/.novadev`;
    todo(root, '2026-09-01_1/01-old', { 'ai_completed.md': completed('01-old') });
    afterTodo(nd, 'docs', ['2026-09-01_1/01']);
    expect(run(root, 'archive', '2026-09-01_1').code).toBe(0);
    expect(exists(root, '.novadev/archive/2026/todos/2026-09-01_1/01-old/ai_completed.md')).toBe(true);
    expect(listTodos(nd).find((t) => t.todo === '01-docs')).toMatchObject({ after: ['2026-09-01_1/01-old'], waitsFor: [], ready: true });
    expect(start(root, '2026-10-02_1').code).toBe(0);
    // … and an archived todo can be named as a dependency, by batch and number
    expect(resolveLinkRef('2026-09-01_1/01', todoIndex(nd))).toBe('2026-09-01_1/01-old');
    expect(auditTodoLinks(nd)).toEqual({ problems: [], actions: [] });
  });

  test('in team mode a dependency counts only once it is approved and merged', () => {
    const root = chain({ team: true });
    const nd = `${root}/.novadev`;
    git(root, 'init', '-q', '-b', 'main');
    afterTodo(nd, 'docs', [`${BATCH}/01`]);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'checkout', '-q', '-b', 'task/schema');
    done(root, `${BATCH}/01-schema`);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'schema');
    expect(json(start(root, '2026-10-02_1')).error).toContain(`2026-10-02_1/01-docs waits for ${BATCH}/01-schema (review). A todo starts once every todo it waits for is completed (in team mode: approved and merged).`);
    write(root, 'review.json', JSON.stringify({ verdict: 'APPROVE', by: 'claude-code/reviewer', checks: ['looked at it'] }));
    expect(run(root, 'todo', 'review', `${BATCH}/01`, 'review.json').code).toBe(0);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'review');
    expect(json(start(root, '2026-10-02_1')).error).toContain(`waits for ${BATCH}/01-schema (unmerged)`);
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', '-q', '--no-ff', '-m', 'merge', 'task/schema');
    forgetReviewCache();
    expect(start(root, '2026-10-02_1').code).toBe(0);
  });
});

describe('ready and waits-for in the lists and the JSON', () => {
  function linked(): string {
    const root = chain();
    const nd = `${root}/.novadev`;
    afterTodo(nd, 'api', ['schema']);
    afterTodo(nd, 'docs', [`${BATCH}/02`, `${BATCH}/03`]);
    return root;
  }

  test('todo list and status say "waits for …" and, once a project uses links, "ready"', () => {
    const root = linked();
    expect(run(root, 'todo', 'list').stdout).toBe(
      `${BATCH}/01-schema  (open, ready)  The schema\n${BATCH}/02-api  (open, waits for 01-schema)  The API\n${BATCH}/03-ui  (open, ready)  The screen\n` +
        `2026-10-02_1/01-docs  (open, waits for ${BATCH}/02-api, ${BATCH}/03-ui)  The docs\n`,
    );
    expect(run(root, 'status').stdout).toContain(
      `  ${BATCH}\n    · 01-schema  (open, ready)\n    · 02-api  (open, waits for 01-schema)\n    · 03-ui  (open, ready)\n  2026-10-02_1\n    · 01-docs  (open, waits for ${BATCH}/02-api, ${BATCH}/03-ui)\n`,
    );
    // the dependency lands: the todo that waited is ready, the finished one says neither
    done(root, `${BATCH}/01-schema`);
    expect(run(root, 'todo', 'list').stdout).toContain(`${BATCH}/01-schema  (completed)  The schema\n${BATCH}/02-api  (open, ready)  The API\n`);
  });

  test('the JSON of todo list, todo show and status carries the links, what is still waited for, and the ready flag', () => {
    const root = linked();
    const list = json(run(root, 'todo', 'list', '--json')).todos as any[];
    expect(list.map((t) => [t.todo, t.after, t.waitsFor, t.ready])).toEqual([
      ['01-schema', [], [], true],
      ['02-api', [`${BATCH}/01-schema`], [{ ref: `${BATCH}/01-schema`, state: 'open' }], false],
      ['03-ui', [], [], true],
      ['01-docs', [`${BATCH}/02-api`, `${BATCH}/03-ui`], [{ ref: `${BATCH}/02-api`, state: 'open' }, { ref: `${BATCH}/03-ui`, state: 'open' }], false],
    ]);
    expect(json(run(root, 'todo', 'show', 'api'))).toMatchObject({ after: [`${BATCH}/01-schema`], waitsFor: [{ ref: `${BATCH}/01-schema`, state: 'open' }], ready: false, history: [{ change: 'after' }] });
    done(root, `${BATCH}/01-schema`);
    done(root, `${BATCH}/03-ui`);
    const status = statusData(`${root}/.novadev`) as { batches: { todos: any[] }[] };
    expect(status.batches.flatMap((b) => b.todos).map((t) => [t.todo, t.waitsFor.map((d: any) => d.ref), t.ready])).toEqual([
      ['01-schema', [], false],
      ['02-api', [], true],
      ['03-ui', [], false],
      ['01-docs', [`${BATCH}/02-api`], false],
    ]);
  });

  test('sync: a todo that waits is not "do the work" but "do that first"; a project without links prints as before', () => {
    const root = linked();
    const sync = run(root, 'sync').stdout;
    expect(sync).toContain(`  → ${BATCH}/01-schema has no record yet — do the work, then record it\n  → ${BATCH}/02-api has no record yet — it waits for 01-schema (open): do that first\n`);
    expect(sync).toContain(`  → 2026-10-02_1/01-docs has no record yet — it waits for ${BATCH}/02-api (open), ${BATCH}/03-ui (open): do those first\n`);
    const plain = chain();
    expect(run(plain, 'todo', 'list').stdout).toBe(`${BATCH}/01-schema  (open)  The schema\n${BATCH}/02-api  (open)  The API\n${BATCH}/03-ui  (open)  The screen\n2026-10-02_1/01-docs  (open)  The docs\n`);
    expect(listTodos(`${plain}/.novadev`).map((t) => [t.after, t.waitsFor, t.ready])).toEqual([[[], [], true], [[], [], true], [[], [], true], [[], [], true]]);
  });
});

describe('sync and doctor on broken links', () => {
  /** Write links straight into todo.json, as a merge or a hand edit would leave them. */
  const link = (root: string, ref: string, after: string[]) => write(root, `.novadev/todos/${ref}/todo.json`, JSON.stringify({ after, history: [] }));

  test('a link to a todo that does not exist is a problem in both', () => {
    const root = chain();
    link(root, `${BATCH}/02-api`, ['2026-01-01_1/01-gone']);
    const problem = `✗ todos/${BATCH}/02-api/todo.json: it waits for "2026-01-01_1/01-gone", which is no todo of this project (not in todos/, not in the archive) — it can never start. Set its links again: \`novadev todo after ${BATCH}/02-api --clear [<ref>…]\``;
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stdout).toContain(problem);
    const doctor = run(root, 'doctor');
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toContain(problem);
    expect(run(root, 'sync', '--check').code).toBe(1);
    expect(json(run(root, 'work', 'start', BATCH, '--agent', AGENT, '--todo', '02')).error).toContain(`${BATCH}/02-api waits for 2026-01-01_1/01-gone (no such todo)`);
  });

  test('a cycle is a problem in both, named once', () => {
    const root = chain();
    link(root, `${BATCH}/01-schema`, [`${BATCH}/03-ui`]);
    link(root, `${BATCH}/02-api`, [`${BATCH}/01-schema`]);
    link(root, `${BATCH}/03-ui`, [`${BATCH}/02-api`]);
    const problem = `✗ "do after" links form a cycle: ${BATCH}/01-schema → ${BATCH}/03-ui → ${BATCH}/02-api → ${BATCH}/01-schema — none of these todos can ever start. Remove one link: \`novadev todo after <ref> --clear [<ref>…]\``;
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stdout.split(problem)).toHaveLength(2);
    const doctor = run(root, 'doctor');
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toContain(problem);
    expect(auditTodoLinks(`${root}/.novadev`).problems).toHaveLength(1);
    // a link out of the cycle that is completed breaks it: nothing is stuck any more
    done(root, `${BATCH}/03-ui`);
    expect(auditTodoLinks(`${root}/.novadev`)).toEqual({ problems: [], actions: [] });
  });

  test('a link to a cancelled todo is a NEXT ACTION in sync and a note in doctor — never a failure', () => {
    const root = chain();
    afterTodo(`${root}/.novadev`, 'api', ['schema']);
    write(root, 'cancel.json', JSON.stringify({ reason: 'Not needed any more.' }));
    expect(run(root, 'todo', 'cancel', 'schema', 'cancel.json').code).toBe(0);
    const action = `${BATCH}/02-api waits for ${BATCH}/01-schema, which did not land (ai_failed.md) — it can never start. Ask whoever decides the order, then remove or replace the link: \`novadev todo after ${BATCH}/02-api --clear [<ref>…]\``;
    const sync = run(root, 'sync');
    expect(sync.code).toBe(0);
    expect(sync.stdout).toContain(`  → ${action}`);
    expect(sync.stdout).not.toContain('PROBLEMS');
    const doctor = run(root, 'doctor');
    expect(doctor.stdout).toContain(`  · ${action}`);
    expect(doctor.stdout).not.toContain(`✗ ${action}`);
    expect(run(root, 'todo', 'list').stdout).toContain(`${BATCH}/02-api  (open, waits for 01-schema)`);
  });

  test('a finished todo\'s links are not judged, and todos without links cost no look at the archive', () => {
    const root = chain();
    link(root, `${BATCH}/02-api`, ['2026-01-01_1/01-gone']);
    done(root, `${BATCH}/02-api`);
    expect(auditTodoLinks(`${root}/.novadev`)).toEqual({ problems: [], actions: [] });
    expect(run(root, 'sync').stdout).not.toContain('todo.json');
    expect(read(root, `.novadev/todos/${BATCH}/02-api/todo.json`)).toContain('2026-01-01_1/01-gone');
  });
});
