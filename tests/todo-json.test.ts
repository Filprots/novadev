// `novadev todo` and the --json views of status and totest: the data a tool away from the repository (a chat bot) reads.
import { describe, expect, test } from 'bun:test';
import { addAddendum, briefParts, briefTitle, cancelTodo, editTodo, listTodos, resolveTodo, showTodo } from '../src/todo.ts';
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

  test('addendum with attachments: a screenshot sent later is copied into the todo folder and named in the dated line; text is optional then', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode') });
    write(root, 'shots/screen.png', 'PNG');
    write(root, 'shots/prompt.md', 'a note that must not become the brief');
    const nd = `${root}/.novadev`;
    const now = new Date('2026-10-25T12:00:00Z');
    const r = addAddendum(nd, '01-dark', { attachments: [`${root}/shots/screen.png`], by: 'from the chat bot' }, now);
    expect(r).toMatchObject({ attached: ['screen.png'] });
    expect(read(root, '.novadev/todos/2026-10-01_1/01-dark-mode/screen.png')).toBe('PNG');
    expect(read(root, '.novadev/todos/2026-10-01_1/01-dark-mode/prompt.md')).toEndWith('More.\n\n**Chat addendum, 2026-10-25 (from the chat bot):** Attached: `screen.png`\n');
    // the same name again is numbered; a text file goes under attachments/; a path that is gone is reported, not fatal
    const r2 = addAddendum(nd, '01-dark', { text: 'The menu too.', attachments: [`${root}/shots/screen.png`, `${root}/shots/prompt.md`, `${root}/gone.png`] }, now);
    expect(r2).toMatchObject({ attached: ['screen-2.png', 'attachments/prompt.md'], missing: [`${root}/gone.png`] });
    expect(read(root, '.novadev/todos/2026-10-01_1/01-dark-mode/prompt.md')).toEndWith('**Chat addendum, 2026-10-25:** The menu too. Attached: `screen-2.png`, `attachments/prompt.md`\n');
    expect(() => addAddendum(nd, '01-dark', { attachments: [`${root}/gone.png`] }, now)).toThrow(/None of the attachments exists/);
    expect(() => addAddendum(nd, '01-dark', { attachments: 'x' }, now)).toThrow(/list of file paths/);
  });

  test('edit: title, request or context rewritten as asked; attachments and addenda kept; the old brief kept and the change noted; refused where an addendum is', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': `${BRIEF('Dark mode')}\n## Attached\n\n- \`shot.png\`\n\n**Chat addendum, 2026-10-02:** Also the minimap.\n` });
    todo(root, '2026-10-01_1/02-export', { 'prompt.md': BRIEF('Export'), 'ai_completed.md': '# done\n' });
    const nd = `${root}/.novadev`;
    const now = new Date('2026-10-25T12:00:00Z');
    const r = editTodo(nd, '01-dark', { title: 'Dark mode for the editor and the minimap', request: 'Dark mode everywhere.', reason: 'the person asked', by: 'from the chat bot' }, now);
    expect(r).toMatchObject({ changed: ['title', 'request'], previous: 'todos/2026-10-01_1/01-dark-mode/.brief-history/2026-10-25T12-00-00-000Z.md' });
    const brief = read(root, '.novadev/todos/2026-10-01_1/01-dark-mode/prompt.md');
    expect(brief).toBe(
      '# prompt — x\n\n**Source:** chat-initiated — 2026-10-01\n\n## Dark mode for the editor and the minimap\n\nDark mode everywhere.\n\n' +
        '## Context from the conversation\n\nMore.\n\n## Attached\n\n- `shot.png`\n\n**Chat addendum, 2026-10-02:** Also the minimap.\n\n' +
        '**Edited, 2026-10-25 (from the chat bot):** title, request changed — the person asked (before: `.brief-history/2026-10-25T12-00-00-000Z.md`)\n',
    );
    expect(read(root, '.novadev/todos/2026-10-01_1/01-dark-mode/.brief-history/2026-10-25T12-00-00-000Z.md')).toContain('## Dark mode\nThe words.');
    expect(listTodos(nd)[0]!.title).toBe('Dark mode for the editor and the minimap');
    expect(showTodo(nd, '01-dark').files).not.toContain('.brief-history');
    // nothing different: nothing written; a finished todo, an empty request, nothing to change: refused
    expect(editTodo(nd, '01-dark', { context: 'More.' }, now)).toMatchObject({ written: null, changed: [] });
    expect(() => editTodo(nd, '02-export', { title: 'x' }, now)).toThrow(/terminal record/);
    expect(() => editTodo(nd, '01-dark', { request: ' ' }, now)).toThrow(/without one/);
    expect(() => editTodo(nd, '01-dark', {}, now)).toThrow(/needs a 'title', a 'request' or a 'context'/);
    // the CLI, and a later edit of the context only
    write(root, 'edit.json', JSON.stringify({ context: 'Seen on a 4K screen.' }));
    const cli = run(root, 'todo', 'edit', '2026-10-01_1/01', 'edit.json');
    expect(cli.code).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ changed: ['context'] });
    expect(read(root, '.novadev/todos/2026-10-01_1/01-dark-mode/prompt.md')).toContain('## Context from the conversation\n\nSeen on a 4K screen.\n');
  });

  test('briefParts: a filed brief in its parts; a free brief is all request under its first line', () => {
    expect(briefParts(`${BRIEF('Dark mode')}\n**Chat addendum, 2026-10-02:** More words\non two lines.\n`, 'x')).toEqual({
      head: '# prompt — x\n\n**Source:** chat-initiated — 2026-10-01', title: 'Dark mode', request: 'The words.', context: 'More.', attached: '', notes: ['**Chat addendum, 2026-10-02:** More words\non two lines.'],
    });
    expect(briefParts('Fix the crash on save\n\nIt crashes when the disk is full.\n', 'fallback')).toMatchObject({ head: '', title: 'Fix the crash on save', request: 'Fix the crash on save\n\nIt crashes when the disk is full.' });
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
