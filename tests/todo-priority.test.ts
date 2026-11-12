// A todo's priority (todo.json, todo-meta.ts): set when filing, changed by a person's decision with
// `novadev todo priority`, and the order of every list — `todo list`, `status`, `status --json`, sync's
// NEXT ACTIONS. A todo without the file (everything 0.17.0 wrote) reads as normal.
import { describe, expect, test } from 'bun:test';
import { statusData } from '../src/status.ts';
import { listTodos, priorityTodo, showTodo, todosInOrder } from '../src/todo.ts';
import { batchesByPriority, comparePriority, orderByPriority, parsePriority, readTodoMeta, todoPriority } from '../src/todo-meta.ts';
import { todoState } from '../src/lib.ts';
import { completed, exists, project, read, readJson, run, todo, write } from './helpers.ts';

const BRIEF = (title: string) => `# prompt — x\n\n**Source:** chat-initiated — 2026-10-01\n\n## ${title}\nThe words.\n`;
const NOW = new Date('2026-10-25T12:00:00Z');

function json(result: { stdout: string }): Record<string, any> {
  return JSON.parse(result.stdout);
}

function payload(root: string, name: string, value: unknown): string {
  write(root, name, JSON.stringify(value));
  return name;
}

/** Three open todos in two batches, in filing order: normal, normal, normal. */
function three(): string {
  const root = project();
  todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode') });
  todo(root, '2026-10-01_1/02-export', { 'prompt.md': BRIEF('PDF export') });
  todo(root, '2026-10-02_1/01-login', { 'prompt.md': BRIEF('Magic link') });
  return root;
}

describe('filing with a priority', () => {
  test('a part with a priority gets a todo.json that says so, who asked and when; a part without one gets no file', () => {
    const root = project();
    const filed = json(
      run(root, 'file-todo', 'file', payload(root, 'f.json', {
        by: 'human:filipp',
        parts: [
          { slug: 'tidy-names', title: 'Tidy the names', request: 'when there is time', priority: 'later' },
          { slug: 'crash-on-save', title: 'Saving crashes', request: 'it crashes, fix it NOW', priority: 'Urgent' },
          { slug: 'new-icon', title: 'A new icon', request: 'a nicer icon' },
        ],
      })),
    ).filed as { ref: string; priority?: string }[];
    expect(filed.map((f) => f.priority)).toEqual(['later', 'urgent', undefined]);
    const [later, urgent, normal] = filed.map((f) => `.novadev/todos/${f.ref}`);
    expect(readJson(root, `${urgent}/todo.json`)).toMatchObject({ priority: 'urgent', history: [{ by: 'human:filipp', change: 'filed', to: { priority: 'urgent' } }] });
    expect(readJson(root, `${urgent}/todo.json`).history[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(readJson(root, `${later}/todo.json`).priority).toBe('later');
    expect(exists(root, `${normal}/todo.json`)).toBe(false);
    // the filing order numbers the folders; the lists order by priority
    expect(json(run(root, 'todo', 'list', '--json')).todos.map((t: any) => [t.todo, t.priority])).toEqual([
      ['02-crash-on-save', 'urgent'],
      ['03-new-icon', 'normal'],
      ['01-tidy-names', 'later'],
    ]);
  });

  test('a payload without priorities files exactly as 0.17.0 did: the same answer, no todo.json', () => {
    const root = project();
    const filed = json(run(root, 'file-todo', 'file', payload(root, 'f.json', { parts: [{ slug: 'one', title: 'One', request: 'do one' }] }))).filed;
    expect(filed).toEqual([{ ref: filed[0].ref, path: `.novadev/todos/${filed[0].ref}`, attachments: [] }]);
    expect(exists(root, `.novadev/todos/${filed[0].ref}/todo.json`)).toBe(false);
    expect(read(root, `.novadev/todos/${filed[0].ref}/prompt.md`)).not.toContain('riority');
  });

  test('a priority that is none of the four, or a "by" that is no actor, is refused before anything is written', () => {
    const root = project();
    const bad = run(root, 'file-todo', 'file', payload(root, 'f.json', { parts: [{ slug: 'one', title: 'One', request: 'do one', priority: 'critical' }] }));
    expect(bad.code).toBe(1);
    expect(json(bad).error).toBe('A part\'s \'priority\' must be one of urgent, high, normal, later — not "critical".');
    const who = run(root, 'file-todo', 'file', payload(root, 'g.json', { by: 'the boss', parts: [{ slug: 'one', title: 'One', request: 'do one', priority: 'high' }] }));
    expect(who.code).toBe(1);
    expect(json(who).error).toContain('"the boss" is not an actor');
    expect(exists(root, '.novadev/todos')).toBe(false);
  });
});

describe('a todo without todo.json — everything filed before priorities existed', () => {
  test('reads as normal everywhere, and every list prints as it did', () => {
    const root = three();
    const nd = `${root}/.novadev`;
    expect(listTodos(nd).map((t) => t.priority)).toEqual(['normal', 'normal', 'normal']);
    expect(todoPriority(`${nd}/todos/2026-10-01_1/01-dark-mode`)).toBe('normal');
    expect(run(root, 'todo', 'list').stdout).toBe(
      '2026-10-01_1/01-dark-mode  (open)  Dark mode\n2026-10-01_1/02-export  (open)  PDF export\n2026-10-02_1/01-login  (open)  Magic link\n',
    );
    const status = run(root, 'status').stdout;
    expect(status).toContain('  2026-10-01_1\n    · 01-dark-mode  (open)\n    · 02-export  (open)\n  2026-10-02_1\n    · 01-login  (open)\n');
    const sync = run(root, 'sync').stdout;
    expect(sync).toContain(
      '  → 2026-10-01_1/01-dark-mode has no record yet — do the work, then record it\n  → 2026-10-01_1/02-export has no record yet — do the work, then record it\n  → 2026-10-02_1/01-login has no record yet — do the work, then record it\n',
    );
    expect(showTodo(nd, '2026-10-02_1/01')).not.toHaveProperty('history');
    expect(run(root, 'doctor').stdout).not.toContain('todo.json');
  });
});

describe('novadev todo priority', () => {
  test('a person\'s decision: the level, who, when and why are recorded; the same level again changes nothing', () => {
    const root = three();
    const nd = `${root}/.novadev`;
    const dir = '.novadev/todos/2026-10-02_1/01-login';
    const r = priorityTodo(nd, '2026-10-02_1/01', 'urgent', { by: 'human:filipp', reason: 'Board on IRR-260:\nnobody can log in.' }, NOW);
    expect(r).toMatchObject({ ref: '2026-10-02_1/01-login', priority: 'urgent', from: 'normal', changed: true, by: 'human:filipp', written: 'todos/2026-10-02_1/01-login/todo.json' });
    const meta = readJson(root, `${dir}/todo.json`);
    expect(meta.priority).toBe('urgent');
    expect(meta.history).toHaveLength(1);
    expect(meta.history[0]).toMatchObject({ by: 'human:filipp', change: 'priority', from: 'normal', to: 'urgent', reason: 'Board on IRR-260: nobody can log in.' });
    expect(Date.parse(meta.history[0].at)).toBe(NOW.getTime());
    expect(priorityTodo(nd, 'login', 'urgent', { by: 'human:filipp' }, NOW)).toEqual({ ref: '2026-10-02_1/01-login', priority: 'urgent', changed: false, written: null });
    // back to normal: the file says so, and keeps both changes
    priorityTodo(nd, 'login', 'normal', { by: 'human:anna' }, NOW);
    const after = readJson(root, `${dir}/todo.json`);
    expect(after.priority).toBe('normal');
    expect(after.history.map((h: any) => [h.by, h.from, h.to])).toEqual([['human:filipp', 'normal', 'urgent'], ['human:anna', 'urgent', 'normal']]);
    expect(showTodo(nd, 'login')).toMatchObject({ priority: 'normal', history: [{ to: 'urgent' }, { to: 'normal' }] });
  });

  test('through the CLI: --by, or a payload with the reason; "human" is the person git knows', () => {
    const root = three();
    const flag = run(root, 'todo', 'priority', '2026-10-01_1/02', 'high', '--by', 'human:filipp');
    expect(flag.code).toBe(0);
    expect(json(flag)).toMatchObject({ priority: 'high', from: 'normal', changed: true });
    const file = run(root, 'todo', 'priority', 'dark', 'later', payload(root, 'p.json', { by: 'human:filipp', reason: 'After the release — `not` before.' }));
    expect(file.code).toBe(0);
    expect(readJson(root, '.novadev/todos/2026-10-01_1/01-dark-mode/todo.json').history[0]).toMatchObject({ by: 'human:filipp', to: 'later', reason: 'After the release — `not` before.' });
  });

  test('refused: no person named, an agent as the decider, a level that is none of the four, a finished todo', () => {
    const root = three();
    todo(root, '2026-10-03_1/01-done', { 'prompt.md': BRIEF('Done'), 'ai_completed.md': completed('01-done') });
    const nobody = run(root, 'todo', 'priority', 'login', 'urgent');
    expect(nobody.code).toBe(1);
    expect(json(nobody).error).toBe('Say who decided the priority: "by" in the payload, or --by <actor> — human:<id>, or "human" for git\'s user.name.');
    expect(json(run(root, 'todo', 'priority', 'login', 'urgent', '--by', 'claude-code/claude-opus-5-5')).error).toBe(
      '"claude-code/claude-opus-5-5" is not a person. Name the person who decided the priority (human:<id>, or "human" for git\'s user.name) and quote what they said in "reason": this is a person\'s decision, never an agent\'s own.',
    );
    expect(json(run(root, 'todo', 'priority', 'login', 'critical', '--by', 'human:filipp')).error).toBe('A priority is one of urgent, high, normal, later — not "critical".');
    expect(json(run(root, 'todo', 'priority', 'login', '--by', 'human:filipp')).error).toBe('A priority is one of urgent, high, normal, later — not "".');
    expect(json(run(root, 'todo', 'priority', '2026-10-03_1/01', 'high', '--by', 'human:filipp')).error).toBe(
      '2026-10-03_1/01-done is finished (completed): its priority no longer orders anything. New work gets a new todo (novadev file-todo).',
    );
    expect(exists(root, '.novadev/todos/2026-10-02_1/01-login/todo.json')).toBe(false);
  });

  test('a todo in live work takes a new priority: an urgent todo is often one somebody is already on', () => {
    const root = three();
    expect(run(root, 'work', 'start', '2026-10-02_1', '--agent', 'claude-code/test').code).toBe(0);
    expect(json(run(root, 'todo', 'priority', 'login', 'urgent', '--by', 'human:filipp'))).toMatchObject({ priority: 'urgent', changed: true });
  });
});

describe('every list orders by priority, then by filing order', () => {
  function prioritised(): string {
    const root = three();
    const nd = `${root}/.novadev`;
    priorityTodo(nd, '2026-10-02_1/01', 'urgent', { by: 'human:filipp' }, NOW);
    priorityTodo(nd, '2026-10-01_1/01', 'later', { by: 'human:filipp' }, NOW);
    return root;
  }

  test('todo list: urgent first, later last; the priority is named beside the state', () => {
    const root = prioritised();
    expect(run(root, 'todo', 'list').stdout).toBe(
      '2026-10-02_1/01-login  (open, urgent)  Magic link\n2026-10-01_1/02-export  (open)  PDF export\n2026-10-01_1/01-dark-mode  (open, later)  Dark mode\n',
    );
    expect(todosInOrder(`${root}/.novadev`).map((t) => t.ref)).toEqual(['2026-10-02_1/01-login', '2026-10-01_1/02-export', '2026-10-01_1/01-dark-mode']);
    expect(json(run(root, 'todo', 'list', '--state', 'open', '--json')).todos.map((t: any) => t.priority)).toEqual(['urgent', 'normal', 'later']);
  });

  test('status: the batch with the urgent todo first, and in a batch the higher priority first; --json carries the priority', () => {
    const root = prioritised();
    const status = run(root, 'status').stdout;
    expect(status).toContain('  2026-10-02_1\n    · 01-login  (open, urgent)\n  2026-10-01_1\n    · 02-export  (open)\n    · 01-dark-mode  (open, later)\n');
    const data = statusData(`${root}/.novadev`) as { batches: { batch: string; todos: { todo: string; priority: string }[] }[] };
    expect(data.batches.map((b) => [b.batch, b.todos.map((t) => `${t.todo}:${t.priority}`)])).toEqual([
      ['2026-10-02_1', ['01-login:urgent']],
      ['2026-10-01_1', ['02-export:normal', '01-dark-mode:later']],
    ]);
  });

  test('sync: NEXT ACTIONS name the urgent todo first, with its priority', () => {
    const root = prioritised();
    expect(run(root, 'sync').stdout).toContain(
      '  → 2026-10-02_1/01-login [urgent] has no record yet — do the work, then record it\n  → 2026-10-01_1/02-export has no record yet — do the work, then record it\n  → 2026-10-01_1/01-dark-mode [later] has no record yet — do the work, then record it\n',
    );
  });

  test('a finished urgent todo no longer lifts its batch; a batch with only "later" work left goes last', () => {
    const root = prioritised();
    const todos = `${root}/.novadev/todos`;
    expect(batchesByPriority(todos, todoState)).toEqual(['2026-10-02_1', '2026-10-01_1']);
    write(root, '.novadev/todos/2026-10-02_1/01-login/ai_completed.md', completed('01-login'));
    expect(batchesByPriority(todos, todoState)).toEqual(['2026-10-01_1', '2026-10-02_1']);
    write(root, '.novadev/todos/2026-10-01_1/02-export/ai_completed.md', completed('02-export'));
    todo(root, '2026-10-03_1/01-more', { 'prompt.md': BRIEF('More') });
    expect(batchesByPriority(todos, todoState)).toEqual(['2026-10-02_1', '2026-10-03_1', '2026-10-01_1']);
  });

  test('the order itself: urgent, high, normal, later; equal priorities keep the order they came in', () => {
    expect(['later', 'normal', 'urgent', 'high'].map((p) => parsePriority(p)!).sort(comparePriority)).toEqual(['urgent', 'high', 'normal', 'later']);
    expect(orderByPriority(['a:normal', 'b:high', 'c:normal', 'd:high'], (x) => parsePriority(x.split(':')[1])!)).toEqual(['b:high', 'd:high', 'a:normal', 'c:normal']);
    expect(parsePriority(' HIGH ')).toBe('high');
    expect(parsePriority('critical')).toBeNull();
    expect(parsePriority(undefined)).toBeNull();
  });
});

describe('a todo.json novadev cannot read', () => {
  test('is a problem sync and doctor name; the todo reads as normal, and what can be read is kept', () => {
    const root = three();
    const dir = '.novadev/todos/2026-10-01_1/01-dark-mode';
    write(root, `${dir}/todo.json`, '<<<<<<< HEAD\n{ "priority": "urgent" }\n');
    expect(readTodoMeta(`${root}/${dir}`)).toMatchObject({ priority: 'normal', after: [], raw: null, error: 'it is not valid JSON (a merge conflict?)' });
    const problem =
      '✗ todos/2026-10-01_1/01-dark-mode/todo.json: it is not valid JSON (a merge conflict?) — fix it, or delete it; until then the todo reads as priority normal, with no "do after" links. It is written by `novadev todo priority` and `novadev todo after`, never by hand.';
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stdout).toContain(problem);
    const doctor = run(root, 'doctor');
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toContain(problem);
    expect(json(run(root, 'todo', 'priority', 'dark', 'high', '--by', 'human:filipp')).error).toContain('todo.json cannot be read: it is not valid JSON');
    // one bad value: named, read as its default; the rest of the file still counts, and unknown keys survive a change
    write(root, `${dir}/todo.json`, JSON.stringify({ priority: 'critical', owner: 'dev-2', history: [] }));
    expect(readTodoMeta(`${root}/${dir}`)).toMatchObject({ priority: 'normal', error: '"priority" must be one of urgent, high, normal, later' });
    expect(run(root, 'sync').stdout).toContain('todo.json: "priority" must be one of urgent, high, normal, later — fix it, or delete it; until then that value reads as its default.');
    priorityTodo(`${root}/.novadev`, 'dark', 'high', { by: 'human:filipp' }, NOW);
    expect(readJson(root, `${dir}/todo.json`)).toMatchObject({ priority: 'high', owner: 'dev-2' });
    expect(run(root, 'sync').stdout).not.toContain('todo.json');
  });
});
