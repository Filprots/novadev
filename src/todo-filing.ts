// The MECHANICS of filing a chat request as a novadev todo batch — which batch, what number, the
// folder names, the brief's shape, where an attachment may land.
//
// It lives in the CLI rather than in a skill's prose because every one of these rules is a rule an
// agent writing the folder by hand would get wrong, and one of them — the `**Feature:**` defanging
// — is the difference between a filed todo and a `novadev sync` that fails on a quoted record.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BATCH_RE, listDirs, todayStamp } from './lib.ts';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
/** novadev's own record names — their presence is what makes a batch "touched". */
const RECORDS = [
  'ai_completed.md',
  'ai_failed.md',
  'ai_progress.md',
  'ai_needstest.md',
  'ai_confirmed.md',
];
/** Names a todo folder owns: novadev's records plus the brief. An attachment may never take one. */
export const RESERVED_NAMES = new Set([...RECORDS, 'prompt.md']);
/**
 * Written into a batch filed from a conversation, so a later filing may reuse it — and so a
 * HUMAN-authored batch never is, because the playbook forbids adding to those.
 */
export const CHAT_MARKER = '.filed-from-chat';
export const MAX_PARTS = 8;
const MAX_BRIEF_CHARS = 20000;

export type TodoPart = {
  readonly slug: string;
  readonly title: string;
  readonly request: string;
  readonly context?: string;
  readonly attachments?: readonly string[];
};

export type FiledTodo = {
  readonly ref: string;
  readonly path: string;
  readonly attachments: readonly string[];
};

export type BatchPlan = { readonly batch: string; readonly reused: boolean; readonly nextNumber: number };

/**
 * The batch to file into: reuse the most recent batch a conversation created while it is still
 * UNTOUCHED — no todo in it carries any ai_ record — so several things filed in a row from a phone
 * land together. The moment work starts on it, or if the newest batch is human-authored, open a
 * fresh one.
 */
export function planBatch(nd: string, today = todayStamp()): BatchPlan {
  const todos = join(nd, 'todos');
  // Ordered by the batch NUMBER, not lexically — '_10' must come after '_9'.
  const reusable = listDirs(todos)
    .filter((name) => BATCH_RE.test(name) && name.startsWith(`${today}_`))
    .sort((a, b) => Number(BATCH_RE.exec(b)![4]) - Number(BATCH_RE.exec(a)![4]));
  for (const batch of reusable) {
    const dir = join(todos, batch);
    if (!existsSync(join(dir, CHAT_MARKER))) break; // a human batch, or one we did not create
    const folders = listDirs(dir);
    if (folders.some((folder) => isTouched(join(dir, folder)))) break;
    return { batch, reused: true, nextNumber: folders.length + 1 };
  }
  return { batch: nextBatchName(nd, today), reused: false, nextNumber: 1 };
}

/** Create the folders, write the briefs, copy the attachments in. */
export function fileTodos(nd: string, parts: readonly TodoPart[]): readonly FiledTodo[] {
  if (parts.length === 0) throw new Error('Nothing to file.');
  if (parts.length > MAX_PARTS) throw new Error(`At most ${MAX_PARTS} todos in one filing.`);
  // Validate EVERY slug before touching the disk: a refusal must leave no half-made batch behind
  // (a stray empty batch is litter novadev then reports forever).
  const slugs = parts.map((part) => normalizeSlug(part.slug));
  const target = planBatch(nd);
  const batchDir = join(nd, 'todos', target.batch);
  mkdirSync(batchDir, { recursive: true });
  if (!existsSync(join(batchDir, CHAT_MARKER))) {
    writeFileSync(join(batchDir, CHAT_MARKER), `${todayStamp()}\n`);
  }
  const filed: FiledTodo[] = [];
  let number = target.nextNumber;
  for (const [index, part] of parts.entries()) {
    const folder = `${String(number).padStart(2, '0')}-${slugs[index]!}`;
    const dir = join(batchDir, folder);
    if (existsSync(dir)) throw new Error(`${target.batch}/${folder} already exists.`);
    mkdirSync(dir, { recursive: true });
    const attachments = copyAttachments(dir, part.attachments ?? []);
    // The brief is written LAST: it owns the name `prompt.md`, and an attachment that wanted that
    // name has already been moved out of its way.
    writeFileSync(join(dir, 'prompt.md'), renderBrief(slugs[index]!, part, attachments));
    filed.push({
      ref: `${target.batch}/${folder}`,
      path: `.novadev/todos/${target.batch}/${folder}`,
      attachments,
    });
    number += 1;
  }
  return filed;
}

/**
 * Copy each attachment into the todo folder. Two placement rules, both learned from review:
 * - a TEXT attachment (.md/.txt) goes into `attachments/` — novadev reads every top-level .md/.txt
 *   of a todo folder, so a note carrying a `**Feature:**` line would break `novadev sync`, and a
 *   file called `ai_completed.md` would make the brand-new todo read as finished work and get
 *   archived. A subfolder is invisible to that scan and still opens normally;
 * - everything else (images, archives, a project snapshot) sits beside the brief, the way the
 *   human's own todo folders look, with a reserved name defensively prefixed anyway.
 */
function copyAttachments(dir: string, paths: readonly string[]): readonly string[] {
  const written: string[] = [];
  for (const from of paths) {
    if (!existsSync(from)) continue; // a path that did not travel is not fatal; the caller reports it
    const original = from.split('/').pop()!;
    const text = /\.(md|txt)$/i.test(original);
    const folder = text ? join(dir, 'attachments') : dir;
    if (text) mkdirSync(folder, { recursive: true });
    // In `attachments/` the real name is safe (nothing scans there); at the TOP level a name a
    // todo folder owns (a record, or the brief) is prefixed out of the way.
    let name = !text && RESERVED_NAMES.has(original.toLowerCase()) ? `attached-${original}` : original;
    for (let n = 2; existsSync(join(folder, name)); n += 1) name = numbered(original, n);
    copyFileSync(from, join(folder, name));
    written.push(text ? `attachments/${name}` : name);
  }
  return written;
}

/** `shot.png` + 2 → `shot-2.png`. */
export function numbered(original: string, n: number): string {
  const dot = original.lastIndexOf('.');
  return dot > 0 ? `${original.slice(0, dot)}-${n}${original.slice(dot)}` : `${original}-${n}`;
}

/** The playbook's chat-initiated brief, plus the attachment note the human would have written. */
export function renderBrief(
  slug: string,
  part: TodoPart,
  attachments: readonly string[],
): string {
  const lines = [
    `# prompt — ${slug}`,
    '',
    `**Source:** chat-initiated, filed by the agent with /novadev-file-a-todo — ${todayStamp()}`,
    '',
    `## ${part.title.trim() !== '' ? part.title.trim() : 'Request'}`,
    '',
    neutralizeFields(part.request),
  ];
  if (part.context !== undefined && part.context.trim() !== '') {
    lines.push('', '## Context from the conversation', '', neutralizeFields(part.context));
  }
  if (attachments.length > 0) {
    lines.push('', '## Attached', '', ...attachments.map((name) => `- \`${name}\``));
  }
  const text = `${lines.join('\n')}\n`;
  return text.length > MAX_BRIEF_CHARS ? `${text.slice(0, MAX_BRIEF_CHARS)}\n\n_(truncated)_\n` : text;
}

/**
 * novadev parses `**Feature:**` / `**Commits:**` at the start of ANY line of ANY brief, and an id
 * that does not exist is a hard `novadev sync` failure. A human quoting an old record into chat
 * must not be able to break their own tree, so the field FORM is defanged — the words survive, only
 * the bold markers that make it a parsed field are dropped.
 */
export function neutralizeFields(text: string): string {
  return text.trim().replace(/^\*\*(Feature|Commits):\*\*/gim, '$1:');
}

/** A folder name the agent suggested → a safe kebab-case slug. */
export function normalizeSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/^\d+[-_]/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (!SLUG.test(slug)) throw new Error(`Cannot use '${raw}' as a folder name.`);
  return slug;
}

/**
 * `YYYY-MM-DD_N` with N one past the highest same-day batch — counting the ARCHIVE, exactly like
 * `novadev new` does. An archived batch still owns its number; reusing it would make the new batch
 * un-archivable later.
 */
function nextBatchName(nd: string, today: string): string {
  const year = today.slice(0, 4);
  const candidates = [
    ...listDirs(join(nd, 'todos')),
    ...listDirs(join(nd, 'archive', year, 'todos')),
    ...listDirs(join(nd, 'archive', year)), // pre-0.6.0: batches sat directly under the year
  ];
  let max = 0;
  for (const name of candidates) {
    const match = BATCH_RE.exec(name);
    if (match && name.startsWith(`${today}_`)) max = Math.max(max, Number(match[4]));
  }
  return `${today}_${max + 1}`;
}

/** A todo folder is "touched" once any novadev record sits in it (work started or finished). */
function isTouched(todoDir: string): boolean {
  return RECORDS.some((record) => existsSync(join(todoDir, record)));
}

/** Validate a caller's raw `parts` payload (the JSON file the agent writes). */
export function parseParts(raw: unknown): readonly TodoPart[] {
  if (!Array.isArray(raw)) throw new Error("'parts' must be an array of todo parts.");
  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object') throw new Error('Each part must be an object.');
    const record = entry as Record<string, unknown>;
    const slug = typeof record['slug'] === 'string' ? record['slug'] : '';
    const title = typeof record['title'] === 'string' ? record['title'] : '';
    const request = typeof record['request'] === 'string' ? record['request'] : '';
    if (slug.trim() === '' || request.trim() === '') {
      throw new Error('Each part needs a slug and the request text.');
    }
    const context = typeof record['context'] === 'string' ? record['context'] : undefined;
    // `attachmentIds` is the older key the in-app filing used; both are accepted so one payload
    // shape works from either side.
    const rawFiles = record['attachments'] ?? record['attachmentIds'];
    const files = Array.isArray(rawFiles)
      ? rawFiles.filter((id): id is string => typeof id === 'string')
      : undefined;
    return {
      slug,
      title,
      request,
      ...(context !== undefined ? { context } : {}),
      ...(files !== undefined ? { attachments: files } : {}),
    };
  });
}
