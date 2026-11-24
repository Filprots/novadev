// A todo's recipient (todo.json, todo-meta.ts; the names in recipients.ts; the rules in todo-recipient.ts):
// set when filing, changed with `novadev todo recipient`, shown by every list, asked for with
// `novadev todo list --for`, and what `novadev work start` refuses anybody else on. A todo without one is
// anyone's, and a project that addresses no todo prints as it did before recipients existed.
import { describe, expect, test } from 'bun:test';
import { answersTo, matchesFor, parseForFilter, parseRecipient, readRecipients } from '../src/recipients.ts';
import { statusData } from '../src/status.ts';
import { listTodos, showTodo } from '../src/todo.ts';
import { readTodoMeta } from '../src/todo-meta.ts';
import { addressedTodos } from '../src/todo-recipient.ts';
import { commitAll, completed, exists, git, project, read, readJson, run, setManifest, todo, write } from './helpers.ts';

const BRIEF = (title: string) => `# prompt — x\n\n**Source:** chat-initiated — 2026-10-01\n\n## ${title}\nThe words.\n`;
const HQ = 'The headquarters session: the tools and the machines.';

function json(result: { stdout: string }): Record<string, any> {
  return JSON.parse(result.stdout);
}

function payload(root: string, name: string, value: unknown): string {
  write(root, name, JSON.stringify(value));
  return name;
}

/** Three open todos in two batches; the second is addressed to hq. */
function three(manifest: Record<string, unknown> = {}): string {
  const root = project(manifest);
  todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode') });
  todo(root, '2026-10-01_1/02-dev-env', { 'prompt.md': BRIEF('The dev tool forgets the second login'), 'todo.json': JSON.stringify({ recipient: 'hq', history: [{ at: '2026-10-01T09:00:00+02:00', by: 'paperclip/minifil', change: 'filed', to: { recipient: 'hq' } }] }) });
  todo(root, '2026-10-02_1/01-login', { 'prompt.md': BRIEF('Magic link') });
  return root;
}

describe('the names', () => {
  test('a recipient is a team name or one actor; the words for "no one in particular" are not names', () => {
    expect(parseRecipient(' hq ')).toBe('hq');
    expect(parseRecipient('paperclip/tester')).toBe('paperclip/tester');
    expect(parseRecipient('human:filipp')).toBe('human:filipp');
    for (const bad of ['', 'anyone', 'Nobody', 'all', 'two words', 'hq/', '/hq', 'hq:', 'x'.repeat(81), undefined, 7]) expect(parseRecipient(bad)).toBeNull();
  });

  test('an actor answers to itself and to the team it is an actor of; a team does not answer to one of its actors', () => {
    expect(answersTo('hq/claude-opus-5-5', 'hq')).toBe(true);
    expect(answersTo('hq', 'hq')).toBe(true);
    expect(answersTo('paperclip/dev', 'paperclip/dev')).toBe(true);
    expect(answersTo('Paperclip/Dev', 'paperclip')).toBe(true);
    expect(answersTo('paperclip/dev', 'paperclip/tester')).toBe(false);
    expect(answersTo('paperclip/dev', 'hq')).toBe(false);
    expect(answersTo('hq', 'hq/claude-opus-5-5')).toBe(false);
    expect(answersTo('hqx/one', 'hq')).toBe(false);
    expect(answersTo('human:filipp', 'human')).toBe(false);
  });

  test('--for: names and `anyone`; a name asks for what that one may take because it is addressed to it', () => {
    expect(parseForFilter('hq, Anyone')).toEqual(['hq', 'anyone']);
    expect(() => parseForFilter('two words')).toThrow('--for "two words": not a recipient');
    expect(() => parseForFilter(' , ')).toThrow('--for needs a recipient');
    expect(matchesFor(null, ['anyone'])).toBe(true);
    expect(matchesFor('hq', ['anyone'])).toBe(false);
    expect(matchesFor('hq', ['hq'])).toBe(true);
    expect(matchesFor('paperclip', ['paperclip/dev'])).toBe(true);
    expect(matchesFor('paperclip/tester', ['paperclip/dev'])).toBe(false);
    // a team's name asks for its actors' todos too: what a lead who hands the team's work out has to see
    expect(matchesFor('paperclip/tester', ['paperclip'])).toBe(true);
    expect(matchesFor('paperclipx/tester', ['paperclip'])).toBe(false);
    expect(matchesFor('hq', ['paperclip', 'anyone'])).toBe(false);
    expect(matchesFor(null, ['hq'])).toBe(false);
  });
});

describe('filing with a recipient', () => {
  test('a part with a recipient gets a todo.json that says so, who filed it and when; a part without one gets no file', () => {
    const root = project();
    const filed = json(
      run(root, 'file-todo', 'file', payload(root, 'f.json', {
        by: 'paperclip/minifil',
        parts: [
          { slug: 'dev-env-second-login', title: 'The dev tool gives only one login', request: 'the second login is missing', recipient: ' hq ' },
          { slug: 'new-icon', title: 'A new icon', request: 'a nicer icon' },
        ],
      })),
    ).filed as { ref: string; recipient?: string }[];
    expect(filed.map((f) => f.recipient)).toEqual(['hq', undefined]);
    const [addressed, anyones] = filed.map((f) => `.novadev/todos/${f.ref}`);
    expect(readJson(root, `${addressed}/todo.json`)).toMatchObject({ recipient: 'hq', history: [{ by: 'paperclip/minifil', change: 'filed', to: { recipient: 'hq' } }] });
    expect(readJson(root, `${addressed}/todo.json`).priority).toBeUndefined();
    expect(exists(root, `${anyones}/todo.json`)).toBe(false);
    expect(read(root, `${addressed}/prompt.md`)).not.toContain('ecipient');
    expect(json(run(root, 'todo', 'list', '--json')).todos.map((t: any) => [t.todo, t.recipient])).toEqual([
      ['01-dev-env-second-login', 'hq'],
      ['02-new-icon', null],
    ]);
  });

  test('a word that is no name is refused before anything is written', () => {
    const root = project();
    for (const bad of ['anyone', 'the headquarters', '']) {
      const result = run(root, 'file-todo', 'file', payload(root, 'f.json', { parts: [{ slug: 'one', title: 'One', request: 'do one', recipient: bad }] }));
      expect(result.code).toBe(1);
      expect(json(result).error).toBe(
        `A part's 'recipient' must be a team's name (like \`hq\`: every actor \`hq/…\`), or one actor (\`paperclip/tester\` for an agent, \`human:<id>\` for a person) — not "${bad}". Leave it out for a todo that is anyone's.`,
      );
    }
    expect(exists(root, '.novadev/todos')).toBe(false);
  });

  test('in a project that names its recipients, only one of them — or one of their actors — can be addressed', () => {
    const root = project({ recipients: { hq: HQ, paperclip: null } });
    const stray = run(root, 'file-todo', 'file', payload(root, 'f.json', { parts: [{ slug: 'one', title: 'One', request: 'do one', recipient: 'headquarters' }, { slug: 'two', title: 'Two', request: 'do two' }] }));
    expect(stray.code).toBe(1);
    expect(json(stray).error).toBe(
      `"headquarters" is not a recipient of this project — nobody would pick the todo up. The recipients ("recipients" in .novadev/novadev.json): hq (${HQ}), paperclip. Address it to one of them or to one of their actors, or leave the recipient out: the todo is then anyone's.`,
    );
    expect(exists(root, '.novadev/todos')).toBe(false);
    // the project's own spelling is what is stored; an actor of a listed team is accepted as it is written
    const filed = json(run(root, 'file-todo', 'file', payload(root, 'g.json', { parts: [{ slug: 'one', title: 'One', request: 'do one', recipient: 'HQ' }, { slug: 'two', title: 'Two', request: 'do two', recipient: 'paperclip/tester' }] }))).filed;
    expect(filed.map((f: any) => f.recipient)).toEqual(['hq', 'paperclip/tester']);
  });

  test('`file-todo plan` answers the project\'s recipients with what belongs to each — and nothing new in a project that names none', () => {
    const plain = project();
    expect(Object.keys(json(run(plain, 'file-todo', 'plan')))).toEqual(['batch', 'reused', 'nextNumber']);
    const named = project({ recipients: { hq: HQ, paperclip: null } });
    expect(json(run(named, 'file-todo', 'plan')).recipients).toEqual({ hq: HQ, paperclip: null });
    const listed = project({ recipients: ['hq', 'human:filipp'] });
    expect(json(run(listed, 'file-todo', 'plan')).recipients).toEqual({ hq: null, 'human:filipp': null });
  });
});

describe('a project that addresses no todo', () => {
  test('prints its lists as before, and its todos read as anyone\'s', () => {
    const root = project();
    todo(root, '2026-10-01_1/01-dark-mode', { 'prompt.md': BRIEF('Dark mode') });
    expect(run(root, 'todo', 'list').stdout).toBe('2026-10-01_1/01-dark-mode  (open)  Dark mode\n');
    expect(run(root, 'status').stdout).toContain('    · 01-dark-mode  (open)\n');
    const sync = run(root, 'sync').stdout;
    expect(sync).toContain('→ 2026-10-01_1/01-dark-mode has no record yet — do the work, then record it');
    expect(sync).not.toContain('ADDRESSED');
    expect(listTodos(`${root}/.novadev`)[0]!.recipient).toBeNull();
    expect(statusData(`${root}/.novadev`).addressed).toEqual({});
    expect(json(run(root, 'work', 'start', '2026-10-01_1/01')).taken).toBe(true);
  });
});

describe('the lists', () => {
  test('`todo list` names the recipient, and --for keeps the todos addressed to one (`anyone`: to nobody)', () => {
    const root = three();
    expect(run(root, 'todo', 'list').stdout).toBe(
      '2026-10-01_1/01-dark-mode  (open)  Dark mode\n' +
        '2026-10-01_1/02-dev-env  (open, for hq)  The dev tool forgets the second login\n' +
        '2026-10-02_1/01-login  (open)  Magic link\n',
    );
    expect(run(root, 'todo', 'list', '--for', 'hq').stdout).toBe('2026-10-01_1/02-dev-env  (open, for hq)  The dev tool forgets the second login\n');
    expect(run(root, 'todo', 'list', '--for', 'hq/claude-opus-5-5').stdout).toBe('2026-10-01_1/02-dev-env  (open, for hq)  The dev tool forgets the second login\n');
    expect(run(root, 'todo', 'list', '--for', 'anyone').stdout).toBe('2026-10-01_1/01-dark-mode  (open)  Dark mode\n2026-10-02_1/01-login  (open)  Magic link\n');
    expect(json(run(root, 'todo', 'list', '--for', 'paperclip/dev,anyone', '--json')).todos.map((t: any) => t.ref)).toEqual(['2026-10-01_1/01-dark-mode', '2026-10-02_1/01-login']);
    expect(json(run(root, 'todo', 'list', '--for', 'hq,anyone', '--state', 'open', '--json')).todos).toHaveLength(3);
    expect(run(root, 'todo', 'list', '--for', 'paperclip').stdout).toBe('todos — none open for paperclip\n');
    // a lead's view: the team's todos, each of its actors', and the ones with no recipient — never another recipient's
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'paperclip/tester', '--by', 'human:filipp')).changed).toBe(true);
    expect(json(run(root, 'todo', 'list', '--for', 'paperclip,anyone', '--json')).todos.map((t: any) => [t.todo, t.recipient])).toEqual([['01-dark-mode', 'paperclip/tester'], ['01-login', null]]);
    expect(run(root, 'todo', 'list', '--for', 'paperclip/dev').stdout).toBe('todos — none open for paperclip/dev\n');
    const bad = run(root, 'todo', 'list', '--for', 'two words');
    expect(bad.code).toBe(1);
    expect(json(bad).error).toContain('--for "two words": not a recipient');
  });

  test('status names it, status --json carries it and counts the addressed todos still to be worked, todo show tells who addressed it', () => {
    const root = three();
    expect(run(root, 'status').stdout).toContain('    · 02-dev-env  (open, for hq)\n');
    const data = statusData(`${root}/.novadev`) as any;
    expect(data.batches[0].todos.map((t: any) => [t.todo, t.recipient])).toEqual([['01-dark-mode', null], ['02-dev-env', 'hq']]);
    expect(data.addressed).toEqual({ hq: 1 });
    const shown = showTodo(`${root}/.novadev`, '2026-10-01_1/02') as any;
    expect(shown.recipient).toBe('hq');
    expect(shown.history[0]).toMatchObject({ by: 'paperclip/minifil', change: 'filed', to: { recipient: 'hq' } });
    // a finished todo is nobody's to take any more: the lists stop naming who it was for, and it is not counted
    write(root, '.novadev/todos/2026-10-01_1/02-dev-env/ai_completed.md', completed('02-dev-env'));
    expect(run(root, 'todo', 'list', '--for', 'hq').stdout).toBe('2026-10-01_1/02-dev-env  (completed)  The dev tool forgets the second login\n');
    expect((statusData(`${root}/.novadev`) as any).addressed).toEqual({});
  });
});

describe('novadev todo recipient', () => {
  test('addresses a todo, on the record: who, when, from whom to whom, and why', () => {
    const root = three();
    expect(json(run(root, 'todo', 'recipient', 'dark-mode'))).toEqual({ ref: '2026-10-01_1/01-dark-mode', recipient: null });
    const set = json(run(root, 'todo', 'recipient', 'dark-mode', 'hq', payload(root, 'p.json', { by: 'paperclip/minifil', reason: 'It is the dev tool,\nand that is the headquarters session\'s.' })));
    expect(set).toEqual({ ref: '2026-10-01_1/01-dark-mode', recipient: 'hq', from: null, changed: true, by: 'paperclip/minifil', written: 'todos/2026-10-01_1/01-dark-mode/todo.json' });
    const meta = readJson(root, '.novadev/todos/2026-10-01_1/01-dark-mode/todo.json');
    expect(meta.recipient).toBe('hq');
    expect(meta.history[0]).toMatchObject({ by: 'paperclip/minifil', change: 'recipient', from: null, to: 'hq', reason: 'It is the dev tool, and that is the headquarters session\'s.' });
    expect(json(run(root, 'todo', 'recipient', 'dark-mode'))).toMatchObject({ recipient: 'hq', addressedBy: 'paperclip/minifil' });
    // the recipient it already has changes nothing
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'hq', '--by', 'human:filipp'))).toEqual({ ref: '2026-10-01_1/01-dark-mode', recipient: 'hq', changed: false, written: null });
    // re-addressed, then anyone's again
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'paperclip/tester', '--by', 'hq/claude-opus-5-5'))).toMatchObject({ recipient: 'paperclip/tester', from: 'hq', changed: true });
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', '--clear', '--by', 'human:filipp'))).toMatchObject({ recipient: null, from: 'paperclip/tester', changed: true });
    const after = readJson(root, '.novadev/todos/2026-10-01_1/01-dark-mode/todo.json');
    expect(after.recipient).toBeUndefined();
    expect(after.history.map((h: any) => [h.by, h.from, h.to])).toEqual([['paperclip/minifil', null, 'hq'], ['hq/claude-opus-5-5', 'hq', 'paperclip/tester'], ['human:filipp', 'paperclip/tester', null]]);
    expect(run(root, 'todo', 'list', '--for', 'anyone').stdout).toContain('01-dark-mode  (open)');
  });

  test('a change names who made it; a name with --clear, a word that is no name, and a finished todo are refused', () => {
    const root = three();
    const nobody = run(root, 'todo', 'recipient', 'dark-mode', 'hq');
    expect(nobody.code).toBe(1);
    expect(json(nobody).error).toBe('Say who addressed the todo: "by" in the payload, or --by <actor> — human:<id>, or "human" for git\'s user.name, or an agent\'s actor (claude-code/<model>).');
    expect(json(run(root, 'todo', 'recipient', 'dev-env', '--clear')).error).toContain('Say who made the todo anyone\'s');
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'hq', '--clear', '--by', 'human:filipp')).error).toContain('Name a recipient or pass --clear, not both');
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'everyone', '--by', 'human:filipp')).error).toContain('"everyone" is not a recipient — write a team\'s name');
    expect(exists(root, '.novadev/todos/2026-10-01_1/01-dark-mode/todo.json')).toBe(false);
    write(root, '.novadev/todos/2026-10-02_1/01-login/ai_completed.md', completed('01-login'));
    expect(json(run(root, 'todo', 'recipient', '2026-10-02_1/01', 'hq', '--by', 'human:filipp')).error).toBe(
      '2026-10-02_1/01-login is finished (completed): there is nothing left in it to address. New work gets a new todo (novadev file-todo).',
    );
  });

  test('in a project that names its recipients, a todo is re-addressed only to one of them, and the answer lists them', () => {
    const root = three({ recipients: { hq: HQ } });
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'paperclip', '--by', 'human:filipp')).error).toContain('"paperclip" is not a recipient of this project');
    expect(json(run(root, 'todo', 'recipient', 'dark-mode')).recipients).toEqual({ hq: HQ });
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'Hq', '--by', 'human:filipp')).recipient).toBe('hq');
  });

  test('a priority change and a "do after" link keep the recipient, and the keys novadev does not know', () => {
    const root = three();
    const path = '.novadev/todos/2026-10-01_1/02-dev-env/todo.json';
    write(root, path, JSON.stringify({ recipient: 'hq', history: [], ticket: 'IRS-1' }));
    expect(json(run(root, 'todo', 'priority', 'dev-env', 'high', '--by', 'human:filipp')).changed).toBe(true);
    expect(json(run(root, 'todo', 'after', 'dev-env', '2026-10-01_1/01', '--by', 'human:filipp')).changed).toBe(true);
    expect(readJson(root, path)).toMatchObject({ priority: 'high', after: ['2026-10-01_1/01-dark-mode'], recipient: 'hq', ticket: 'IRS-1' });
    expect(run(root, 'todo', 'list', '--for', 'hq').stdout).toBe('2026-10-01_1/02-dev-env  (open, high, for hq, waits for 01-dark-mode)  The dev tool forgets the second login\n');
  });
});

describe('novadev work start on an addressed todo', () => {
  test('anybody but the recipient is refused, and told whose it is and what is theirs to take', () => {
    const root = three();
    const other = run(root, 'work', 'start', '2026-10-01_1/02', '--agent', 'paperclip/dev');
    expect(other.code).toBe(1);
    expect(json(other).error).toBe(
      'Not started — 2026-10-01_1/02-dev-env is addressed to hq (by paperclip/minifil, 2026-10-01), and you are paperclip/dev. Only its recipient works an addressed todo: leave it to its recipient. ' +
        '`novadev todo list --for paperclip/dev,anyone` lists what you may take: the todos addressed to you, and the ones with no recipient. ' +
        'If you are the recipient, start it under the recipient\'s actor (`--agent hq/<your name>`). When the person or the lead decided it is yours after all, it is re-addressed first, on the record: `novadev todo recipient 2026-10-01_1/02-dev-env <recipient> --by <actor>` (`--clear` makes it anyone\'s).',
    );
    expect(exists(root, '.novadev/todos/2026-10-01_1/02-dev-env/working.md')).toBe(false);
    const unnamed = run(root, 'work', 'start', '2026-10-01_1/02');
    expect(unnamed.code).toBe(1);
    expect(json(unnamed).error).toBe(
      'Not started — 2026-10-01_1/02-dev-env is addressed to hq (by paperclip/minifil, 2026-10-01). Only its recipient works an addressed todo, so say who starts: `--agent <actor>` (the recipient\'s: `--agent hq/<your name>`). A todo with no recipient is anyone\'s.',
    );
  });

  test('the recipient starts it: an actor of the team, the one actor it names — and a person is never refused', () => {
    const team = three();
    expect(json(run(team, 'work', 'start', '2026-10-01_1/02', '--agent', 'hq/claude-opus-5-5'))).toMatchObject({ taken: true, agent: 'hq/claude-opus-5-5' });
    const person = three();
    expect(json(run(person, 'work', 'start', '2026-10-01_1/02', '--agent', 'human:filipp')).taken).toBe(true);
    const one = three();
    expect(json(run(one, 'todo', 'recipient', 'dev-env', 'paperclip/tester', '--by', 'human:filipp')).changed).toBe(true);
    expect(json(run(one, 'work', 'start', '2026-10-01_1/02', '--agent', 'paperclip/dev')).error).toContain('is addressed to paperclip/tester (by human:filipp, ');
    expect(json(run(one, 'work', 'start', '2026-10-01_1/02', '--agent', 'paperclip/tester')).taken).toBe(true);
  });

  test('a start of the whole batch is refused while it holds another\'s todo that is still to be worked; the todos that are yours start by name', () => {
    const root = three();
    const whole = run(root, 'work', 'start', '2026-10-01_1', '--agent', 'paperclip/dev');
    expect(whole.code).toBe(1);
    expect(json(whole).error).toContain('Not started — 2026-10-01_1/02-dev-env is addressed to hq (by paperclip/minifil, 2026-10-01), and you are paperclip/dev.');
    expect(json(whole).error).toContain('Start only the todos that are yours (`novadev work start 2026-10-01_1 --todo <nn>`; `novadev todo list --for paperclip/dev,anyone` lists them).');
    expect(exists(root, '.novadev/todos/2026-10-01_1/working.md')).toBe(false);
    expect(json(run(root, 'work', 'start', '2026-10-01_1', '--todo', '01', '--agent', 'paperclip/dev')).taken).toBe(true);
    // once the recipient has finished its todo, it holds nobody up any more
    const done = three();
    write(done, '.novadev/todos/2026-10-01_1/02-dev-env/ai_completed.md', completed('02-dev-env'));
    expect(json(run(done, 'work', 'start', '2026-10-01_1', '--agent', 'paperclip/dev')).taken).toBe(true);
  });

  test('re-addressed on the record, it is the new recipient\'s; made anyone\'s, it is anyone\'s', () => {
    const root = three();
    expect(json(run(root, 'todo', 'recipient', 'dev-env', '--clear', payload(root, 'p.json', { by: 'human:filipp', reason: 'The company can do this one.' }))).changed).toBe(true);
    expect(json(run(root, 'work', 'start', '2026-10-01_1/02', '--agent', 'paperclip/dev')).taken).toBe(true);
  });
});

describe('sync and doctor', () => {
  test('an addressed todo is listed apart from NEXT ACTIONS: it is its recipient\'s, not whoever runs sync', () => {
    const root = three();
    write(root, '.novadev/todos/2026-10-01_1/01-dark-mode/ai_completed.md', completed('01-dark-mode'));
    write(root, '.novadev/todos/2026-10-02_1/01-login/ai_completed.md', completed('01-login'));
    expect(json(run(root, 'todo', 'priority', 'dev-env', 'urgent', '--by', 'human:filipp')).changed).toBe(true);
    const sync = run(root, 'sync');
    expect(sync.code).toBe(0);
    expect(sync.stdout).not.toContain('NEXT ACTIONS');
    expect(sync.stdout).toContain(
      '\nADDRESSED TO A RECIPIENT — theirs to do, yours only if you are the recipient (1):\n  ✉ 2026-10-01_1/02-dev-env [urgent] — for hq: no record yet\n\nsync: clean — everything left is addressed to its recipient.\n',
    );
    expect(addressedTodos(`${root}/.novadev`)).toEqual([{ ref: '2026-10-01_1/02-dev-env', recipient: 'hq', state: 'open', line: '2026-10-01_1/02-dev-env [urgent] — for hq: no record yet' }]);
    expect(run(root, 'sync', '--check').code).toBe(0);
  });

  test('a todo addressed to a name the project no longer lists is a NEXT ACTION: nobody will pick it up', () => {
    const root = three({ recipients: { paperclip: 'The company.' } });
    const action =
      '2026-10-01_1/02-dev-env is addressed to hq, which "recipients" in novadev.json does not name (paperclip (The company.)) — nobody will pick it up. Ask who it is for, then re-address it: `novadev todo recipient 2026-10-01_1/02-dev-env <recipient> --by <actor>` (`--clear` makes it anyone\'s)';
    expect(run(root, 'sync').stdout).toContain(`  → ${action}\n`);
    expect(run(root, 'doctor').stdout).toContain(action);
    expect(json(run(root, 'todo', 'recipient', 'dev-env', 'paperclip', '--by', 'human:filipp')).changed).toBe(true);
    expect(run(root, 'sync').stdout).not.toContain('does not name');
  });

  test('a "recipients" setting novadev cannot read is a problem, and until it is fixed that entry names nobody', () => {
    const root = three({ recipients: { hq: HQ, 'two words': 'x', paperclip: 7 } });
    // … but a recipient whose description cannot be read is still a recipient: its todos keep it
    expect(readRecipients(`${root}/.novadev`)).toEqual({
      known: [{ name: 'hq', about: HQ }, { name: 'paperclip', about: null }],
      error: '"two words" is not a name (a team\'s name (like `hq`: every actor `hq/…`), or one actor (`paperclip/tester` for an agent, `human:<id>` for a person)); what belongs to "paperclip" must be a text',
    });
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stdout).toContain('✗ .novadev/novadev.json: "recipients" — "two words" is not a name');
    expect(run(root, 'doctor').code).toBe(1);
    setManifest(root, { recipients: 'hq' });
    expect(run(root, 'sync').stdout).toContain('✗ .novadev/novadev.json: "recipients" — it must be an object of names with what belongs to each ({ "hq": "…" }), or a list of names. Until it is fixed that entry names nobody.');
  });

  test('a recipient in todo.json that is no name is a problem, and the todo reads as anyone\'s until it is fixed', () => {
    const root = three();
    write(root, '.novadev/todos/2026-10-01_1/02-dev-env/todo.json', JSON.stringify({ recipient: 'the headquarters', priority: 'high' }));
    expect(readTodoMeta(`${root}/.novadev/todos/2026-10-01_1/02-dev-env`)).toMatchObject({ recipient: null, priority: 'high', error: '"recipient" must be a team\'s name (like `hq`: every actor `hq/…`), or one actor (`paperclip/tester` for an agent, `human:<id>` for a person)' });
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stdout).toContain('✗ todos/2026-10-01_1/02-dev-env/todo.json: "recipient" must be a team\'s name');
  });
});

// The independent review of batch 2026-11-24_1 (2026-11-24): eleven findings, one test each, kept as written.
describe('review of 2026-11-24', () => {
  test('1 — a recipient\'s own todo in work here keeps its sync round open: it is a NEXT ACTION, not only an addressed line', () => {
    const root = three();
    write(root, '.novadev/todos/2026-10-01_1/01-dark-mode/ai_completed.md', completed('01-dark-mode'));
    write(root, '.novadev/todos/2026-10-02_1/01-login/ai_completed.md', completed('01-login'));
    expect(json(run(root, 'work', 'start', '2026-10-01_1/02', '--agent', 'hq/claude-opus-5-5')).taken).toBe(true);
    write(root, '.novadev/todos/2026-10-01_1/02-dev-env/ai_progress.md', '# ai_progress — 02-dev-env\n\nHalf done.\n');
    const sync = run(root, 'sync').stdout;
    expect(sync).toContain('  → 2026-10-01_1/02-dev-env (for hq, in work here) is mid-flight — finish it or update ai_progress.md\n');
    expect(sync).not.toContain('ADDRESSED TO A RECIPIENT');
    expect(sync).not.toContain('sync: clean');
    // released, it is its recipient's again and no longer this session's action
    expect(json(run(root, 'work', 'stop', '2026-10-01_1/02')).state).toBe('released');
    const after = run(root, 'sync').stdout;
    expect(after).toContain('  ✉ 2026-10-01_1/02-dev-env — for hq: mid-flight\n');
    expect(after).toContain('sync: clean — everything left is addressed to its recipient.');
  });

  test('2 — an argument in the wrong place never becomes a recipient: a payload file, a todo\'s ref', () => {
    const root = three();
    write(root, 'why.json', JSON.stringify({ by: 'hq/claude-opus-5-5', reason: 'x' }));
    write(root, 'payloads/why.json', JSON.stringify({ by: 'hq/claude-opus-5-5' }));
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'why.json', '--by', 'hq/claude-opus-5-5')).error).toBe(
      '"why.json" is a file, not a recipient: name the recipient before the payload (`novadev todo recipient <ref> <recipient> why.json`), or pass --clear to make the todo anyone\'s.',
    );
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'why.json')).error).toContain('"why.json" is a file, not a recipient');
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'payloads/why.json', '--by', 'hq/claude-opus-5-5')).error).toContain('is a file, not a recipient');
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'missing.json', '--by', 'hq/claude-opus-5-5')).error).toContain('"missing.json" is not a recipient');
    // the arguments swapped: `hq` is a word only one todo's title has, the todo's ref is not a name
    expect(json(run(root, 'todo', 'recipient', 'second', '2026-10-01_1/01', '--by', 'paperclip/dev')).error).toContain('"2026-10-01_1/01" is not a recipient');
    expect(parseRecipient('2026-10-01_1')).toBeNull();
    expect(exists(root, '.novadev/todos/2026-10-01_1/01-dark-mode/todo.json')).toBe(false);
    expect(readJson(root, '.novadev/todos/2026-10-01_1/02-dev-env/todo.json').recipient).toBe('hq');
    // the payload's own `by` is read when the recipient is named
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'hq', 'why.json'))).toMatchObject({ changed: true, by: 'hq/claude-opus-5-5' });
  });

  test('3 — a lock at the batch root that covers another\'s todo: the refusal says the way on that works', () => {
    const root = three();
    expect(json(run(root, 'todo', 'recipient', 'dev-env', '--clear', '--by', 'human:filipp')).changed).toBe(true);
    expect(json(run(root, 'work', 'start', '2026-10-01_1', '--agent', 'paperclip/dev')).taken).toBe(true);
    expect(json(run(root, 'todo', 'recipient', 'dev-env', 'hq', '--by', 'human:filipp')).changed).toBe(true);
    const resume = run(root, 'work', 'start', '2026-10-01_1', '--agent', 'paperclip/dev');
    expect(resume.code).toBe(1);
    expect(json(resume).error).toContain(
      'The lock this worktree holds at the root of 2026-10-01_1 covers it and cannot be narrowed: write down where you are (`novadev work waypoint 2026-10-01_1 <payload.json>`), release that lock (`novadev work stop 2026-10-01_1`), then start your own todos by name (`novadev work start 2026-10-01_1/<todo>`).',
    );
    expect(json(resume).error).not.toContain('--todo <nn>');
    expect(json(run(root, 'work', 'stop', '2026-10-01_1')).state).toBe('released');
    expect(json(run(root, 'work', 'start', '2026-10-01_1/01', '--agent', 'paperclip/dev')).taken).toBe(true);
  });

  test('4 — a recipient in todo.json that is no name can be replaced or cleared, on the record, and no other writer drops it', () => {
    const root = three();
    const path = '.novadev/todos/2026-10-01_1/02-dev-env/todo.json';
    write(root, path, JSON.stringify({ recipient: 'the headquarters', history: [] }));
    expect(json(run(root, 'todo', 'priority', 'dev-env', 'high', '--by', 'human:filipp')).changed).toBe(true);
    expect(json(run(root, 'todo', 'after', 'dev-env', '2026-10-01_1/01', '--by', 'human:filipp')).changed).toBe(true);
    expect(readJson(root, path)).toMatchObject({ priority: 'high', recipient: 'the headquarters' });
    expect(run(root, 'sync').stdout).toContain('✗ todos/2026-10-01_1/02-dev-env/todo.json: "recipient" must be a team\'s name');
    expect(json(run(root, 'todo', 'recipient', 'dev-env', '--clear', '--by', 'human:filipp'))).toMatchObject({ recipient: null, from: 'the headquarters', changed: true });
    const cleared = readJson(root, path);
    expect(cleared.recipient).toBeUndefined();
    expect(cleared.history.at(-1)).toMatchObject({ change: 'recipient', from: 'the headquarters', to: null, by: 'human:filipp' });
    expect(run(root, 'sync').stdout).not.toContain('"recipient" must be');
    write(root, path, JSON.stringify({ recipient: 'the headquarters', history: [] }));
    expect(json(run(root, 'todo', 'recipient', 'dev-env', 'hq', '--by', 'human:filipp'))).toMatchObject({ recipient: 'hq', from: 'the headquarters', changed: true });
  });

  test('5 — a todo.json that cannot be read and names a recipient: nobody starts the todo, and sync does not say "do the work"', () => {
    const root = three();
    write(root, '.novadev/todos/2026-10-01_1/02-dev-env/todo.json', '<<<<<<< HEAD\n{ "recipient": "hq" }\n=======\n{ "recipient": "paperclip/tester" }\n>>>>>>> other\n');
    const start = run(root, 'work', 'start', '2026-10-01_1/02', '--agent', 'paperclip/dev');
    expect(start.code).toBe(1);
    expect(json(start).error).toBe(
      'Not started — todos/2026-10-01_1/02-dev-env/todo.json cannot be read (it is not valid JSON (a merge conflict?)), and it names a recipient: whose the todo is cannot be told. Fix the file first (after a merge conflict: keep one side), then start again.',
    );
    const sync = run(root, 'sync');
    expect(sync.code).toBe(1);
    expect(sync.stdout).toContain('  → 2026-10-01_1/02-dev-env: its todo.json cannot be read and names a recipient — whose the todo is cannot be told. Fix the file first (PROBLEMS, above); do not start it\n');
    expect(sync.stdout).not.toContain('02-dev-env has no record yet');
    // a broken file that names no recipient starts as it always did
    write(root, '.novadev/todos/2026-10-01_1/01-dark-mode/todo.json', '<<<<<<< HEAD\n{ "priority": "urgent" }\n');
    expect(json(run(root, 'work', 'start', '2026-10-01_1/01', '--agent', 'paperclip/dev')).taken).toBe(true);
  });

  test('6 — a long description in "recipients" is no problem, in the main checkout or a worktree; messages show its start', () => {
    const long = `${'The headquarters session keeps the tools. '.repeat(12)}End.`;
    const root = three({ recipients: { hq: long, paperclip: 'The company.' } });
    git(root, 'init', '-q', '-b', 'main');
    commitAll(root);
    expect(readRecipients(`${root}/.novadev`)).toEqual({ known: [{ name: 'hq', about: long }, { name: 'paperclip', about: 'The company.' }], error: null });
    expect(run(root, 'sync', '--check').stdout).not.toContain('"recipients"');
    expect(json(run(root, 'file-todo', 'plan')).recipients.hq).toBe(long);
    const refused = json(run(root, 'todo', 'recipient', 'dark-mode', 'headquarters', '--by', 'human:filipp')).error as string;
    expect(refused).toContain(`hq (${long.slice(0, 160).trimEnd()}…), paperclip (The company.)`);
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'hq', '--by', 'human:filipp')).changed).toBe(true);
  });

  test('7 — one count per recipient, however its name is capitalised; a team\'s name is kept in lower case', () => {
    const root = three();
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'HQ', '--by', 'human:filipp')).recipient).toBe('hq');
    expect(json(run(root, 'todo', 'recipient', '2026-10-02_1/01', 'Paperclip/Tester', '--by', 'human:filipp')).recipient).toBe('Paperclip/Tester');
    todo(root, '2026-10-03_1/01-more', { 'prompt.md': BRIEF('More'), 'todo.json': JSON.stringify({ recipient: 'paperclip/tester' }) });
    expect((statusData(`${root}/.novadev`) as any).addressed).toEqual({ hq: 2, 'Paperclip/Tester': 2 });
    expect(readTodoMeta(`${root}/.novadev/todos/2026-10-01_1/02-dev-env`).recipient).toBe('hq');
  });

  test('8 — `human` and `process` open an actor and are no team: refused as a recipient', () => {
    const root = three();
    expect(parseRecipient('human')).toBeNull();
    expect(parseRecipient('Process')).toBeNull();
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'human', '--by', 'human:filipp')).error).toContain('"human" is not a recipient — write a team\'s name');
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'human:filipp', '--by', 'human:filipp')).recipient).toBe('human:filipp');
  });

  test('9 — a recipient beside `parts` addresses every part that names none; a word that is no name is refused before anything is written', () => {
    const root = project();
    const filed = json(run(root, 'file-todo', 'file', payload(root, 'f.json', { by: 'paperclip/minifil', recipient: 'hq', parts: [{ slug: 'one', title: 'One', request: 'do one' }, { slug: 'two', title: 'Two', request: 'do two', recipient: 'paperclip/tester' }] }))).filed;
    expect(filed.map((f: any) => f.recipient)).toEqual(['hq', 'paperclip/tester']);
    const bad = run(root, 'file-todo', 'file', payload(root, 'g.json', { recipient: 'the headquarters', parts: [{ slug: 'three', title: 'Three', request: 'do three' }] }));
    expect(bad.code).toBe(1);
    expect(json(bad).error).toContain('The payload\'s \'recipient\' must be a team\'s name');
    expect(json(run(root, 'todo', 'list', '--json')).todos).toHaveLength(2);
  });

  test('10 — `--for=hq` is `--for hq`: an option written with "=" is never dropped', () => {
    const root = three();
    expect(run(root, 'todo', 'list', '--for=hq').stdout).toBe('2026-10-01_1/02-dev-env  (open, for hq)  The dev tool forgets the second login\n');
    expect(run(root, 'todo', 'list', '--for=anyone', '--state=open').stdout).toBe('2026-10-01_1/01-dark-mode  (open)  Dark mode\n2026-10-02_1/01-login  (open)  Magic link\n');
    expect(json(run(root, 'todo', 'recipient', 'dark-mode', 'hq', '--by=human:filipp')).by).toBe('human:filipp');
    expect(json(run(root, 'todo', 'list', '--for=')).error).toContain('--for needs a value.');
  });

  test('11 — sync does not tell anybody to do another\'s todo first: a todo that waits for an addressed one waits for its recipient', () => {
    const root = three();
    expect(json(run(root, 'todo', 'after', 'dark-mode', '2026-10-01_1/02', '--by', 'human:filipp')).changed).toBe(true);
    expect(run(root, 'sync').stdout).toContain('  → 2026-10-01_1/01-dark-mode has no record yet — it waits for 02-dev-env (open, for hq): its recipient does that first\n');
    // … and one that waits for an unaddressed todo reads as before
    expect(json(run(root, 'todo', 'after', 'dark-mode', '2026-10-02_1/01', '--clear', '--by', 'human:filipp')).changed).toBe(true);
    expect(run(root, 'sync').stdout).toContain('  → 2026-10-01_1/01-dark-mode has no record yet — it waits for 2026-10-02_1/01-login (open): do that first\n');
  });
});
