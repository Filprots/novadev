// `novadev todo` and the --json views of status and totest: the data a tool away from the repository (a chat bot) reads.
import { describe, expect, test } from 'bun:test';
import { addAddendum, briefTitle, cancelTodo, listTodos, resolveTodo, showTodo } from '../src/todo.ts';
import { statusData } from '../src/status.ts';
import { exists, project, read, run, todo, write } from './helpers.ts';

const BRIEF = (title: string) => `# prompt — x\n\n**Source:** chat-initiated — 2026-10-01\n\n## ${title}\nThe words.\n\n## Context from the conversation\nMore.\n`;

describe('novadev todo', () => {
  test('list: every open todo with its title and state; --state filters; titles from the brief', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode for the editor') });
    todo(root, '2026-10-01_1/02-export', { 'prompt.md': BRIEF('PDF export'), 'ai_completed.md': '# done\n' });
    todo(root, '2026-10-02_1/01-login', { 'prompt.md': BRIEF('Magic link'), 'ai_completed.md': '# done\n', 'ai_needstest.md': '# gate\n' });
    const nd = `${root}/.novadev`;
    expect(listTodos(nd).map((t) => [t.ref, t.state, t.title])).toEqual([
      ['2026-10-01_1/01-dark-mode', 'open', 'Dark mode for the editor'],
      ['2026-10-01_1/02-export', 'completed', 'PDF export'],
      ['2026-10-02_1/01-login', 'needstest', 'Magic link'],
    ]);
    const r = run(root, 'todo', 'list', '--state', 'open,needstest', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).todos.map((t: any) => t.todo)).toEqual(['01-dark-mode', '01-login']);
    expect(briefTitle('# Fix the crash on save\n\nIt crashes.')).toBe('Fix the crash on save');
  });

  test('a ref by full name, by number in its batch, or by a word only one todo has; an unclear one lists the candidates', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode') });
    todo(root, '2026-10-01_1/02-dark-icons', { 'prompt.md': BRIEF('Icons') });
    const nd = `${root}/.novadev`;
    expect(resolveTodo(nd, '2026-10-01_1/02').todo).toBe('02-dark-icons');
    expect(resolveTodo(nd, 'icons').ref).toBe('2026-10-01_1/02-dark-icons');
    expect(() => resolveTodo(nd, 'dark')).toThrow(/matches 2 todos/);
    expect(() => resolveTodo(nd, 'nothing')).toThrow(/No open todo/);
  });

  test('show: the brief, the records and the files', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode'), 'ai_progress.md': '# progress\nHalf.\n', 'shot.png': 'png' });
    const t = showTodo(`${root}/.novadev`, '2026-10-01_1/01');
    expect(t).toMatchObject({ state: 'progress', title: 'Dark mode', records: { 'ai_progress.md': '# progress\nHalf.\n' }, batchInWork: null });
    expect(t.files).toEqual(['ai_progress.md', 'prompt.md', 'shot.png']);
    const r = run(root, 'todo', 'show', 'nothing');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toMatch(/No open todo/);
  });

  test('addendum: a dated Chat addendum on an open todo; refused on a finished or test-waiting one, and in a batch in work', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode') });
    todo(root, '2026-10-01_1/02-export', { 'prompt.md': BRIEF('Export'), 'ai_completed.md': '# done\n' });
    const nd = `${root}/.novadev`;
    const now = new Date('2026-10-25T12:00:00Z');
    addAddendum(nd, '01-dark', { text: 'Also the minimap.', by: 'from the chat bot' }, now);
    expect(read(root, '.novadev/todos/2026-10-01_1/01-dark-mode/prompt.md')).toEndWith('More.\n\n**Chat addendum, 2026-10-25 (from the chat bot):** Also the minimap.\n');
    expect(() => addAddendum(nd, '02-export', { text: 'x' }, now)).toThrow(/terminal record .*file a NEW todo/);
    expect(() => addAddendum(nd, '01-dark', { text: ' ' }, now)).toThrow(/needs a 'text'/);
    write(root, '.novadev/todos/2026-10-01_1/working.md', lockText(now.toISOString()));
    expect(() => addAddendum(nd, '01-dark', { text: 'y' }, now)).toThrow(/in work right now/);
  });

  test('cancel: an ai_failed.md of the cancelled kind, through the CLI with a payload file', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode') });
    write(root, 'payload.json', JSON.stringify({ reason: 'Not needed: the theme follows the system now.' }));
    const r = run(root, 'todo', 'cancel', '2026-10-01_1/01', 'payload.json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ state: 'failed' });
    const rec = read(root, '.novadev/todos/2026-10-01_1/01-dark-mode/ai_failed.md');
    expect(rec).toContain('*cancelled* — the person decided not to do it.');
    expect(rec).toContain('Not needed: the theme follows the system now.');
    expect(exists(root, '.novadev/todos/2026-10-01_1/01-dark-mode/ai_failed.md')).toBe(true);
    expect(() => cancelTodo(`${root}/.novadev`, '2026-10-01_1/01-dark-mode', { reason: 'again' })).toThrow(/No open todo|terminal record/);
  });
});

function lockText(at: string): string {
  return `---\nbatch: 2026-10-01_1\nstate: working\nagent: claude-code/test\nhost: elsewhere\npid:\nsession:\nstarted: ${at}\nupdated: ${at}\nresumed:\ntodo: 01-dark-mode\nphase: 3\n---\n\n# Work lock — 2026-10-01_1\n`;
}

describe('--json views', () => {
  test('status --json: batches with todos and states, counts, the test queue; a lock with its holder and phase', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode'), 'ai_progress.md': '# p\n' });
    todo(root, '2026-10-02_1/01-login', { 'prompt.md': BRIEF('Magic link'), 'ai_completed.md': '# done\n' });
    const r = run(root, 'status', '--json');
    expect(r.code).toBe(0);
    const s = JSON.parse(r.stdout);
    expect(s.batches).toEqual([
      { batch: '2026-10-01_1', readyToArchive: false, inWork: null, todos: [{ todo: '01-dark-mode', title: 'Dark mode', state: 'progress' }] },
      { batch: '2026-10-02_1', readyToArchive: true, inWork: null, todos: [{ todo: '01-login', title: 'Magic link', state: 'completed' }] },
    ]);
    expect(s.todoCounts).toEqual({ progress: 1, completed: 1 });
    expect(s.inWork).toEqual([]);
    expect(s.totest).toEqual([]);
    write(root, '.novadev/todos/2026-10-01_1/working.md', lockText(new Date().toISOString()));
    const w = statusData(`${root}/.novadev`);
    expect((w.inWork as any[])[0]).toMatchObject({ batch: '2026-10-01_1', state: 'working', agent: 'claude-code/test', todo: '01-dark-mode', phase: 3, live: true });
  });

  test('totest --json: the queue as data', () => {
    const root = project();
    const r = run(root, 'totest', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ tasks: [] });
  });
});
