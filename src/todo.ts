// `novadev todo` — one todo at a time, for a person (or an agent acting for one) away from the repository:
//
//   novadev todo list [--state open,progress,…] [--json]   the open todos with their titles and states
//   novadev todo show <ref>                                  one todo as JSON: its brief and its records
//   novadev todo addendum <ref> <payload.json>               {text, attachments}: a "Chat addendum" appended to the brief;
//                                                            attachments (screenshots) are copied into the todo folder
//   novadev todo edit <ref> <payload.json>                   {title, request, context, reason}: the brief rewritten where
//                                                            asked, the previous one kept in .brief-history/
//   novadev todo cancel <ref> <payload.json>                 {reason}: an ai_failed.md that says *cancelled*
//   novadev todo review <ref> <payload.json>                 {verdict, by, checks, findings?, notes?, override?}: ai_review.md,
//                                                            a reviewer's APPROVE or CHANGES on a finished todo (review.ts);
//                                                            with area owners (owners.ts) an APPROVE is PARTIAL until one
//                                                            reviewer of each matching rule approved, or a person or the
//                                                            lead overrides: "override": { "reason" }
//   novadev todo priority <ref> <level> [<payload.json>] [--by <actor>]
//                                                            urgent|high|normal|later, on a person's decision or the
//                                                            lead's ("lead" in novadev.json): {by, reason} — who, when
//                                                            and why go into the todo's todo.json (todo-meta.ts)
//   novadev todo priority --changed-since <date> [--by-agent] [--json]
//                                                            the recorded changes of priority since a day or a
//                                                            timestamp, saying which ones an agent made
//   novadev todo after <ref> [<ref>…] [--clear] [--by <actor>]
//                                                            the todos it waits for ("do after" links, todo-links.ts):
//                                                            refs add links, --clear removes them all (with refs:
//                                                            replaces them), no refs shows them
//
// `list` and the JSON views order the todos by priority (urgent first), then by filing order, and say for
// each todo whether it is ready or which todos it waits for.
//
// A <ref> is how people name a todo: `2026-10-16_2/02-router-…`, `2026-10-16_2/02`, or a word of its slug that only one
// open todo has. The two writes follow the playbook's intake rules: a todo with a terminal record, or one waiting on a
// human test, gets a NEW todo rather than an addendum; a batch an agent holds right now is not written behind its back.
// Answers are JSON on stdout; errors are `{ "error": … }` with a non-zero exit (as `test-result` and `file-todo`).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  RECORD_COMPLETED,
  RECORD_CONFIRMED,
  RECORD_TESTSKIPPED,
  RECORD_FAILED,
  RECORD_NEEDSTEST,
  RECORD_PROGRESS,
  TERMINAL_STATES,
  type TodoState,
  listAllTodos,
  listDirs,
  novadevDir,
  requireProjectRoot,
  todoState,
} from './lib.ts';
import { humanActor } from './knowledge-log.ts';
import { ACTOR_FORMAT, actorKind, nowTimestamp } from './okf.ts';
import { type SuggestedOwner, VERDICT_PARTIAL, judgeReviews, mayOverride, ownerSuggester, overrideText, readOwners, readSignOffs, recordCommits, requiredReviews, reviewFields, todoReviewRules } from './owners.ts';
import { RECORD_REVIEW, REVIEW_HISTORY_DIR, parseReviewPayload, renderReview } from './review.ts';
import { batchWorkLocks, holderNote, liveElsewhere, lockHolding, lockLiveness, todoHolders } from './work.ts';
import { copyAttachments } from './todo-filing.ts';
import { type LinkFacts, changeAfter, linkReader, linkTag } from './todo-links.ts';
import {
  PRIORITIES,
  type Priority,
  type PriorityChange,
  changePriority,
  decidedAs,
  orderByPriority,
  parseSince,
  priorityChangeLine,
  priorityChanges,
  priorityTag,
  readTodoMeta,
  reasonText,
  resolveActor,
} from './todo-meta.ts';

const PROMPT = 'prompt.md';
const RECORDS = [RECORD_NEEDSTEST, RECORD_CONFIRMED, RECORD_TESTSKIPPED, RECORD_REVIEW, RECORD_COMPLETED, RECORD_FAILED, RECORD_PROGRESS] as const;
const MAX_RECORD_CHARS = 12000;
const MAX_TEXT_BYTES = 20000;
const USAGE =
  'usage: novadev todo list [--state open,progress,needstest,…] [--json]\n' +
  '       novadev todo show <ref>\n' +
  '       novadev todo addendum <ref> <payload.json>   ({ "text": …, "attachments": [paths] })\n' +
  '       novadev todo edit <ref> <payload.json>       ({ "title"?, "request"?, "context"?, "reason"? })\n' +
  '       novadev todo cancel <ref> <payload.json>     ({ "reason": … })\n' +
  '       novadev todo review <ref> <payload.json>     ({ "verdict": "APPROVE"|"CHANGES", "by", "checks": […], "findings"?, "notes"?, "override"?: { "reason" } })\n' +
  `       novadev todo priority <ref> <${PRIORITIES.join('|')}> [<payload.json>] [--by <actor>]   ({ "by": "human:<id>" or the lead, "reason"? })\n` +
  '       novadev todo priority --changed-since <YYYY-MM-DD|timestamp> [--by-agent] [--json]   (who changed which priority, when and why)\n' +
  '       novadev todo after <ref> [<ref>…] [--clear] [--by <actor>]   (the todos it waits for; --clear removes them)';

/**
 * One open todo: where it is, what it is called, its state, its priority, and what its "do after" links say now.
 * `suggestedOwner` is there only in a project with area owners (owners.ts), on a todo a rule with an owner matches.
 */
export type TodoItem = { ref: string; batch: string; todo: string; title: string; state: TodoState; priority: Priority; suggestedOwner?: SuggestedOwner } & LinkFacts;

/** The brief's title: its first `## ` heading (the filed form), else the first line that says something. */
export function briefTitle(text: string): string {
  const h2 = text.match(/^##\s+(.+)$/m)?.[1];
  if (h2) return h2.trim();
  const line = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l !== '' && !/^prompt\s+—/i.test(l) && !l.startsWith('**Source:**'));
  return line ?? '';
}

/** Every todo of the open batches, oldest batch first. */
export function listTodos(nd: string): TodoItem[] {
  const out: TodoItem[] = [];
  const links = linkReader(nd);
  const owner = ownerSuggester(nd);
  for (const batch of listDirs(join(nd, 'todos'))) {
    for (const todo of listDirs(join(nd, 'todos', batch))) {
      const dir = join(nd, 'todos', batch, todo);
      const prompt = join(dir, PROMPT);
      const state = todoState(dir);
      const suggested = owner(dir);
      out.push({
        ref: `${batch}/${todo}`,
        batch,
        todo,
        title: existsSync(prompt) ? briefTitle(readFileSync(prompt, 'utf8')) : '',
        state,
        priority: readTodoMeta(dir).priority,
        ...links(dir, state),
        ...(suggested !== null ? { suggestedOwner: suggested } : {}),
      });
    }
  }
  return out;
}

/** The todos as every queue shows them: the highest priority first, then the filing order (batch, then todo). */
export function todosInOrder(nd: string): TodoItem[] {
  return orderByPriority(listTodos(nd), (t) => t.priority);
}

/**
 * A todo's state as the lists print it: `(open)`, `(open, urgent)`, `(open, waits for 05-todo-priority)`,
 * `(open, ready)`. `ready` is said only in a project that uses "do after" links (`showReady`), so a
 * project without them prints as it always did.
 */
export function stateText(t: TodoItem, showReady: boolean): string {
  return `(${t.state}${priorityTag(t.priority)}${linkTag(t, showReady)})`;
}

/** Does any of these todos wait for another? Then the lists say `ready` on the ones that do not. */
export function usesLinks(todos: readonly TodoItem[]): boolean {
  return todos.some((t) => t.after.length > 0);
}

/** One line of `novadev todo list`: the ref, its state (with its priority and what it waits for), its title. */
export function listLine(t: TodoItem, showReady = false): string {
  return `${t.ref}  ${stateText(t, showReady)}${t.title ? `  ${t.title}` : ''}`;
}

/** The one open todo a person means; an error that lists the candidates when it is not one. */
export function resolveTodo(nd: string, ref: string): TodoItem {
  const want = ref.trim().replace(/^todos\//, '').replace(/\/+$/, '');
  if (want === '') throw new Error('Name a todo: <batch>/<todo>, <batch>/<NN>, or a word of its slug.');
  const all = listTodos(nd);
  const exact = all.find((t) => t.ref === want);
  if (exact) return exact;
  const [batch, part] = want.split('/');
  let hits = part !== undefined ? all.filter((t) => t.batch === batch && (t.todo.startsWith(`${part}-`) || t.todo === part || t.todo.startsWith(part))) : [];
  if (part === undefined) {
    const word = want.toLowerCase();
    hits = all.filter((t) => t.todo.toLowerCase().includes(word) || t.title.toLowerCase().includes(word));
  }
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0) throw new Error(`No open todo matches "${ref}" (archived todos are not open).`);
  throw new Error(`"${ref}" matches ${hits.length} todos: ${hits.slice(0, 8).map((t) => t.ref).join(', ')}${hits.length > 8 ? ' …' : ''}`);
}

/** One todo: its brief, its state, its records (long ones cut), who holds it, and whether its batch is in work. */
export function showTodo(nd: string, ref: string, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  const dir = join(nd, 'todos', t.batch, t.todo);
  const records: Record<string, string> = {};
  for (const file of RECORDS) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    records[file] = text.length > MAX_RECORD_CHARS ? `${text.slice(0, MAX_RECORD_CHARS)}\n… (cut: ${text.length} characters)` : text;
  }
  // The lock here that holds this todo (its own, or the batch's); else any lock of its batch: the batch is in work.
  const lock = lockHolding(nd, t.batch, t.todo) ?? batchWorkLocks(nd, t.batch)[0] ?? null;
  const inWork =
    lock === null ? null : lock.state === 'invalid' ? { state: 'unreadable' } : { state: lock.lock.state, live: lockLiveness(lock.lock, now).live, agent: lock.lock.agent, todo: lock.lock.todo, updated: lock.lock.updated };
  const holder = todoHolders(nd, now).get(t.ref) ?? null;
  // What changed its priority (and its links), with who and when — only when something was ever recorded.
  const history = readTodoMeta(dir).history;
  // The reviews its area owners ask for (owners.ts) — only in a project with owners, on a todo a rule matches.
  const required = requiredReviews(todoReviewRules(nd, dir));
  return { ...t, ...(required.length > 0 ? { requiredReviewers: required.map(({ rule, reviewers }) => ({ rule, reviewers })) } : {}), ...(history.length > 0 ? { history } : {}), brief: existsSync(join(dir, PROMPT)) ? readFileSync(join(dir, PROMPT), 'utf8') : '', records, holder, batchInWork: inWork, files: listFilesIn(dir) };
}

function listFilesIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile()).sort();
}

/** Refuse a write the playbook routes elsewhere: a finished or test-waiting todo, a batch someone holds now. */
function writable(nd: string, t: TodoItem, what: string, now: Date): void {
  if (t.state === 'needstest') throw new Error(`${t.ref} is waiting on a human test: ${what} would be new work — file a NEW todo (novadev file-todo) and cross-link it.`);
  if ((TERMINAL_STATES as readonly string[]).includes(t.state)) throw new Error(`${t.ref} already has a terminal record (${t.state}): file a NEW todo for this (novadev file-todo).`);
  if (t.state === 'review' || t.state === 'unmerged') throw new Error(`${t.ref} is finished and waiting for its ${t.state === 'review' ? 'review' : 'merge'}: file a NEW todo for this (novadev file-todo).`);
  // Only a lock that holds THIS todo counts: its own, or a batch's lock that covers it.
  const lock = lockHolding(nd, t.batch, t.todo);
  if (lock !== null && lock.state === 'ok' && lock.lock.state === 'working' && lockLiveness(lock.lock, now).live) {
    throw new Error(`${lock.lock.unit === 'todo' ? t.ref : t.batch} is in work right now (${lock.lock.agent}): tell that session, or try again when it pauses or stops.`);
  }
  const there = liveElsewhere(nd, t.batch, now, t.todo);
  if (there !== null) {
    throw new Error(`${there.unit === 'todo' ? t.ref : t.batch} is in work right now in another worktree (${there.worktree}, ${there.agent}): tell that session, or try again when it pauses or stops.`);
  }
}

const today = (now: Date) => {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
};

function body(text: unknown, key: string): string {
  if (typeof text !== 'string' || text.trim() === '') throw new Error(`The payload needs a '${key}'.`);
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error(`That ${key} is too large to record.`);
  return text.trim();
}

const byOf = (payload: Record<string, unknown>) => (typeof payload['by'] === 'string' && payload['by'].trim() !== '' ? ` (${payload['by'].trim()})` : '');

/** Paths from a payload's `attachments` (strings only). */
function paths(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error("'attachments' must be a list of file paths.");
  return (value as string[]).map((v) => v.trim()).filter(Boolean);
}

/**
 * A "Chat addendum" — the playbook's way a later word from the person joins an open todo's brief. Files the person sends
 * later (a screenshot for a todo filed without one) come in the same way: copied into the todo folder as filing copies
 * them, and named in the addendum line. Text, attachments or both.
 */
export function addAddendum(nd: string, ref: string, payload: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  writable(nd, t, 'an addendum', now);
  const files = paths(payload['attachments']);
  const text = files.length > 0 && (payload['text'] === undefined || (typeof payload['text'] === 'string' && payload['text'].trim() === '')) ? '' : body(payload['text'], 'text');
  const dir = join(nd, 'todos', t.batch, t.todo);
  const missing = files.filter((f) => !existsSync(f));
  if (files.length > 0 && missing.length === files.length) throw new Error(`None of the attachments exists: ${missing.join(', ')}`);
  const attached = copyAttachments(dir, files);
  const path = join(dir, PROMPT);
  const before = existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : `# prompt — ${t.todo}`;
  const note = [text, attached.length > 0 ? `Attached: ${attached.map((a) => `\`${a}\``).join(', ')}` : ''].filter(Boolean).join(' ');
  writeFileSync(path, `${before}\n\n**Chat addendum, ${today(now)}${byOf(payload)}:** ${note}\n`);
  return { ref: t.ref, written: `todos/${t.ref}/${PROMPT}`, ...(attached.length > 0 ? { attached } : {}), ...(missing.length > 0 ? { missing } : {}) };
}

/** A brief in its parts: the lines before the first section, the title and request, the context, the attached list, and the
 *  dated notes after them (addenda, edits). A brief a person wrote freely is all request under its own first line. */
export function briefParts(text: string, fallbackTitle: string): { head: string; title: string; request: string; context: string; attached: string; notes: string[] } {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const notes: string[] = [];
  // dated notes are paragraphs of their own at the end: take them off first
  let body = lines.join('\n');
  for (;;) {
    const m = /\n\n(\*\*(?:Chat addendum|Edited),[^\n]*(?:\n(?!\n)[^\n]*)*)$/.exec(body);
    if (!m) break;
    notes.unshift(m[1]!);
    body = body.slice(0, m.index);
  }
  const at = body.search(/^## /m);
  if (at === -1) {
    const head = /^# prompt\b.*$/m.exec(body)?.[0] ?? '';
    const rest = body.replace(/^# prompt\b.*$/m, '').trim();
    return { head, title: briefTitle(body) || fallbackTitle, request: rest, context: '', attached: '', notes };
  }
  const head = body.slice(0, at).trimEnd();
  const sections = body.slice(at).split(/^(?=## )/m).map((s) => {
    const [first, ...more] = s.split('\n');
    return { name: first!.replace(/^##\s+/, '').trim(), text: more.join('\n').trim() };
  });
  const ctx = sections.find((s) => /^context from the conversation$/i.test(s.name));
  const att = sections.find((s) => /^attached$/i.test(s.name));
  const main = sections.filter((s) => s !== ctx && s !== att);
  const [first, ...others] = main;
  return {
    head,
    title: first?.name ?? fallbackTitle,
    request: [first?.text ?? '', ...others.map((s) => `## ${s.name}\n\n${s.text}`)].filter(Boolean).join('\n\n'),
    context: ctx?.text ?? '',
    attached: att?.text ?? '',
    notes,
  };
}

/**
 * Change an open todo's brief: its title, request or context, as the person asked (a chat bot acting for them). The previous
 * brief is kept in `.brief-history/` and the change is noted at the end, dated, so the work agent sees what moved. Refused
 * where the playbook refuses an addendum: a finished or test-waiting todo, a batch someone holds right now.
 */
export function editTodo(nd: string, ref: string, payload: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  writable(nd, t, 'an edit', now);
  const want: Record<'title' | 'request' | 'context', string | undefined> = { title: undefined, request: undefined, context: undefined };
  for (const key of ['title', 'request', 'context'] as const) {
    const v = payload[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') throw new Error(`'${key}' must be text.`);
    if (key !== 'context' && v.trim() === '') throw new Error(`An empty '${key}' would leave the todo without one.`);
    if (Buffer.byteLength(v, 'utf8') > MAX_TEXT_BYTES) throw new Error(`That ${key} is too large to record.`);
    want[key] = v.trim();
  }
  if (want.title === undefined && want.request === undefined && want.context === undefined) throw new Error("The payload needs a 'title', a 'request' or a 'context'.");
  const dir = join(nd, 'todos', t.batch, t.todo);
  const path = join(dir, PROMPT);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : `# prompt — ${t.todo}\n`;
  const p = briefParts(before, t.title || t.todo);
  const changed = (['title', 'request', 'context'] as const).filter((k) => want[k] !== undefined && want[k] !== p[k]);
  if (changed.length === 0) return { ref: t.ref, written: null, changed: [] };
  const next = { ...p, ...Object.fromEntries(changed.map((k) => [k, want[k]!])) };
  const history = join(dir, '.brief-history');
  mkdirSync(history, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(history, `${stamp}.md`), before);
  const reason = typeof payload['reason'] === 'string' && payload['reason'].trim() !== '' ? ` — ${payload['reason'].trim()}` : '';
  const out = [
    next.head || `# prompt — ${t.todo}`,
    '',
    `## ${next.title}`,
    '',
    next.request,
    ...(next.context ? ['', '## Context from the conversation', '', next.context] : []),
    ...(next.attached ? ['', '## Attached', '', next.attached] : []),
    ...next.notes.flatMap((n) => ['', n]),
    '',
    `**Edited, ${today(now)}${byOf(payload)}:** ${changed.join(', ')} changed${reason} (before: \`.brief-history/${stamp}.md\`)`,
  ];
  writeFileSync(path, `${out.join('\n')}\n`);
  return { ref: t.ref, written: `todos/${t.ref}/${PROMPT}`, changed, previous: `todos/${t.ref}/.brief-history/${stamp}.md` };
}

/** The person decided against it: an ai_failed.md of the *cancelled* kind, so the batch can close. */
export function cancelTodo(nd: string, ref: string, payload: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  writable(nd, t, 'a cancellation', now);
  const reason = body(payload['reason'], 'reason');
  const by = typeof payload['by'] === 'string' && payload['by'].trim() !== '' ? payload['by'].trim() : 'the person';
  const path = join(nd, 'todos', t.batch, t.todo, RECORD_FAILED);
  writeFileSync(
    path,
    `# ai_failed — ${t.todo}\n\n**Date:** ${today(now)}\n**Feature:** none — cancelled before any work\n\n## Prompt\n${t.title || t.todo}\n\n` +
      `## What happened\n*cancelled* — ${by} decided not to do it.\n\n## Placement\nnothing new placed\n\n## Decisions\n${reason}\n`,
  );
  return { ref: t.ref, written: `todos/${t.ref}/${RECORD_FAILED}`, state: 'failed' };
}

/**
 * A reviewer's verdict on a finished todo: ai_review.md beside its ai_completed.md. The review before
 * it, if any, moves to the todo's .review-history/. Not refused behind a lock: reviewing is part of
 * the loop, often done while the builder still holds the batch.
 *
 * In a project with area owners (owners.ts) an APPROVE is the approval only when one reviewer of EACH
 * rule the work falls under has approved. Until then every APPROVE is kept as a sign-off — the review
 * reads PARTIAL and names who is still needed — and the sign-offs stay for as long as the record names
 * the same commits. `"override": { "reason" }` from a person, the lead or an actor of `owners.override`
 * approves without the missing ones; who, when and why are written into the review.
 */
export function reviewTodo(nd: string, ref: string, payload: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  const dir = join(nd, 'todos', t.batch, t.todo);
  if (!existsSync(join(dir, RECORD_COMPLETED))) {
    throw new Error(`${t.ref} has no ${RECORD_COMPLETED} — there is nothing finished to review yet (its state is ${t.state}).`);
  }
  const review = parseReviewPayload(payload);
  if (review.by === 'human') {
    const human = humanActor(dirname(nd));
    if (human === null) throw new Error('"by": "human" needs git\'s user.name — set it, or write human:<id>.');
    review.by = human;
  } else if (actorKind(review.by) === null) {
    throw new Error(`'by' must be an actor — ${ACTOR_FORMAT}.`);
  }
  const path = join(dir, RECORD_REVIEW);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;

  // Area owners: which reviews this work needs, and which of them it has by now.
  const owners = readOwners(nd);
  const required = review.verdict === 'APPROVE' ? requiredReviews(todoReviewRules(nd, dir, owners)) : [];
  let more: { verdict?: string; fields?: string[] } = {};
  let answer: Record<string, unknown> = {};
  if (required.length > 0) {
    const commits = recordCommits(dir);
    const kept = before === null ? { signoffs: [], commits: null } : readSignOffs(before);
    // A sign-off is for the work as it was: new commits in the record ask for the reviews again.
    const carried = kept.commits === commits ? kept.signoffs.filter((s) => s.by !== review.by) : [];
    const dropped = kept.commits === commits ? [] : kept.signoffs.filter((s) => s.by !== review.by).map((s) => s.by);
    const signoffs = [...carried, { by: review.by, at: nowTimestamp(now) }];
    const judgement = judgeReviews(required, signoffs);
    let override: { by: string; at: string; reason: string } | null = null;
    if (payload['override'] !== undefined && payload['override'] !== null && payload['override'] !== false && judgement.missing.length > 0) {
      const given = payload['override'];
      const reason = reasonText(typeof given === 'string' ? given : (given as Record<string, unknown>)?.['reason']);
      if (reason === undefined) throw new Error('An override needs its reason: "override": { "reason": "why this is approved without the required review" } — it is recorded in the review.');
      if (!mayOverride(nd, owners, review.by)) {
        throw new Error(
          `"${review.by}" may not approve without the required reviews (${judgement.missing.map((m) => m.rule).join(', ')}): an override is for ${overrideText(nd, owners)}. Without "override" the approval is kept as a sign-off.`,
        );
      }
      override = { by: review.by, at: nowTimestamp(now), reason };
    }
    const approved = judgement.missing.length === 0 || override !== null;
    more = { ...(approved ? {} : { verdict: `${VERDICT_PARTIAL} — approved by ${signoffs.map((s) => s.by).join(', ')}; still needed: ${judgement.missing.map((m) => `${m.rule} (one of ${m.reviewers.join(', ')})`).join('; ')}` }), fields: reviewFields(judgement, signoffs, commits, override) };
    answer = {
      approved,
      signoffs,
      requiredReviewers: judgement.required.map(({ rule, reviewers, approvedBy }) => ({ rule, reviewers, approvedBy })),
      ...(approved ? {} : { waitingFor: judgement.missing.map(({ rule, reviewers }) => ({ rule, reviewers })), message: `Kept as a sign-off, not the approval yet: ${judgement.missing.map((m) => `${m.rule} needs one of ${m.reviewers.join(', ')}`).join('; ')}.` }),
      ...(override !== null ? { override: { ...override, without: judgement.missing.map((m) => m.rule) } } : {}),
      ...(dropped.length > 0 ? { dropped: { signoffs: dropped, why: `the record names other commits now (${commits}; reviewed: ${kept.commits ?? 'none'})` } } : {}),
    };
  }

  let previous: string | null = null;
  if (before !== null) {
    const history = join(dir, REVIEW_HISTORY_DIR);
    mkdirSync(history, { recursive: true });
    previous = `${now.toISOString().replace(/[:.]/g, '-')}.md`;
    writeFileSync(join(history, previous), before);
  }
  writeFileSync(path, renderReview(t.todo, today(now), review, more));
  return {
    ref: t.ref,
    written: `todos/${t.ref}/${RECORD_REVIEW}`,
    verdict: more.verdict !== undefined ? VERDICT_PARTIAL : review.verdict,
    state: todoState(dir),
    ...answer,
    ...(previous === null ? {} : { previous: `todos/${t.ref}/${REVIEW_HISTORY_DIR}/${previous}` }),
  };
}

/**
 * A person changed a todo's priority (they said so; an agent or a chat bot runs this for them), or the
 * project's lead did ("lead" in novadev.json — it gives its own actor and a reason): the level, and who
 * decided, when and why, go into the todo's todo.json. Any other agent is refused. Not refused behind a
 * lock: an urgent todo is often one somebody is already working on.
 */
export function priorityTodo(nd: string, ref: string, level: string | undefined, who: { by?: unknown; reason?: unknown }, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  const root = dirname(nd);
  const by = resolveActor(root, who.by, { personOnly: true, orLead: true, what: 'decided the priority' });
  return changePriority({ ref: t.ref, dir: join(nd, 'todos', t.batch, t.todo), state: t.state }, level, { by, reason: reasonText(who.reason), as: decidedAs(root, by) }, now);
}

/**
 * The recorded changes of priority since a day or a timestamp, oldest first, each with the todo's title —
 * what the lead's morning digest to the board lists. `byAgent` keeps only the ones an agent made.
 */
export function priorityReport(nd: string, since: string, opts: { byAgent?: boolean } = {}): { since: string; byAgents: number; changes: (PriorityChange & { title: string })[] } {
  const from = parseSince(since);
  const titles = new Map<string, string>();
  const title = (c: PriorityChange): string => {
    if (!titles.has(c.ref)) {
      const open = join(nd, 'todos', c.ref, PROMPT);
      const path = existsSync(open) ? open : (listAllTodos(nd).find((t) => t.ref === c.ref)?.dir ?? '') + `/${PROMPT}`;
      titles.set(c.ref, existsSync(path) ? briefTitle(readFileSync(path, 'utf8')) : '');
    }
    return titles.get(c.ref)!;
  };
  const all = priorityChanges(nd, from);
  const changes = all.filter((c) => opts.byAgent !== true || c.byKind === 'agent').map((c) => ({ ...c, title: title(c) }));
  return { since: nowTimestamp(from), byAgents: all.filter((c) => c.byKind === 'agent').length, changes };
}

/**
 * The todos a todo waits for: add links (`deps`), replace or remove them (`clear`), or — with neither —
 * only say what they are. Who set them is recorded when `by` is given (any actor: the lead, an agent, a person).
 */
export function afterTodo(nd: string, ref: string, deps: readonly string[], opts: { clear?: boolean; by?: unknown } = {}, now: Date = new Date()): Record<string, unknown> {
  const t = resolveTodo(nd, ref);
  if (deps.length === 0 && opts.clear !== true) return { ref: t.ref, after: t.after, waitsFor: t.waitsFor, ready: t.ready };
  const by = opts.by === undefined || opts.by === null ? null : resolveActor(dirname(nd), opts.by, { personOnly: false, what: 'set the links' });
  return changeAfter(nd, { ref: t.ref, batch: t.batch, dir: join(nd, 'todos', t.batch, t.todo), state: t.state }, deps, { clear: opts.clear === true, by }, now);
}

function readPayload(argument: string | undefined): Record<string, unknown> {
  if (argument === undefined) throw new Error(USAGE);
  const path = isAbsolute(argument) ? argument : resolve(process.cwd(), argument);
  if (!existsSync(path)) throw new Error(`No payload file at ${path}.`);
  const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The payload must be a JSON object.');
  return payload as Record<string, unknown>;
}

/** The arguments of a `novadev todo` call: what is positional, and the options that take a value. */
type TodoArgs = { positional: string[]; by?: string; state?: string; changedSince?: string; json: boolean; clear: boolean; byAgent: boolean };
function parseArgs(args: string[]): TodoArgs {
  const out: TodoArgs = { positional: [], json: false, clear: false, byAgent: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--by' || arg === '--state' || arg === '--changed-since') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value.\n${USAGE}`);
      if (arg === '--by') out.by = value;
      else if (arg === '--state') out.state = value;
      else out.changedSince = value;
      i++;
    } else if (arg === '--json') out.json = true;
    else if (arg === '--clear') out.clear = true;
    else if (arg === '--by-agent') out.byAgent = true;
    else out.positional.push(arg);
  }
  return out;
}

export function todoCommand(args: string[]): void {
  const nd = novadevDir(requireProjectRoot());
  try {
    const opts = parseArgs(args);
    const [command, ref, argument, second] = opts.positional;
    if (command === 'list' || command === undefined) {
      const states = (opts.state ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const todos = todosInOrder(nd).filter((t) => states.length === 0 || states.includes(t.state));
      // Who holds each todo (work.ts): its own lock or its batch's, here or in another worktree.
      const holders = todoHolders(nd);
      if (opts.json) {
        console.log(JSON.stringify({ todos: todos.map((t) => ({ ...t, holder: holders.get(t.ref) ?? null })) }, null, 2));
        return;
      }
      if (todos.length === 0) console.log('todos — none open');
      const showReady = usesLinks(todos);
      for (const t of todos) console.log(`${listLine(t, showReady)}${holderNote(holders.get(t.ref))}`);
      return;
    }
    if (command === 'priority' && opts.changedSince !== undefined) {
      if (ref !== undefined) throw new Error(`--changed-since lists the changes of every todo: leave the todo out.\n${USAGE}`);
      const report = priorityReport(nd, opts.changedSince, { byAgent: opts.byAgent });
      if (opts.json) return void console.log(JSON.stringify(report, null, 2));
      const count = report.changes.length;
      console.log(`priority changes since ${report.since} — ${count === 0 ? 'none' : count}${opts.byAgent ? ' by an agent' : count > 0 ? ` (${report.byAgents} by an agent)` : ''}`);
      for (const c of report.changes) console.log(`  ${priorityChangeLine(c)}${c.title ? `  · ${c.title}` : ''}`);
      return;
    }
    if (ref === undefined) throw new Error(USAGE);
    if (command === 'show') return void console.log(JSON.stringify(showTodo(nd, ref), null, 2));
    if (command === 'addendum') return void console.log(JSON.stringify(addAddendum(nd, ref, readPayload(argument)), null, 2));
    if (command === 'edit') return void console.log(JSON.stringify(editTodo(nd, ref, readPayload(argument)), null, 2));
    if (command === 'cancel') return void console.log(JSON.stringify(cancelTodo(nd, ref, readPayload(argument)), null, 2));
    if (command === 'review') return void console.log(JSON.stringify(reviewTodo(nd, ref, readPayload(argument)), null, 2));
    if (command === 'priority') {
      // `--by` names who decided; a payload carries their reason too (their words never go through the shell).
      const payload = second === undefined ? {} : readPayload(second);
      return void console.log(JSON.stringify(priorityTodo(nd, ref, argument, { by: opts.by ?? payload['by'], reason: payload['reason'] }), null, 2));
    }
    if (command === 'after') return void console.log(JSON.stringify(afterTodo(nd, ref, opts.positional.slice(2), { clear: opts.clear, by: opts.by }), null, 2));
    throw new Error(USAGE);
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}
