// The MECHANICS of recording a change to the knowledge bundle: the stamps in the concept's
// frontmatter and the entry in log.md, written TOGETHER by `novadev knowledge log`.
//
// It lives in the CLI rather than in the playbook's prose because every part of it is easy to get
// wrong by hand — an OKF timestamp with its offset, a YAML flow mapping, one verification per actor,
// the review date the project's policy asks for, a log section per day, newest first — and because
// a stamp written without its log entry (or the other way round) is exactly the gap `novadev sync`
// reports. One call does both, for every event in the payload, or nothing at all.
//
//   create     a new concept: stamps `generated`, sets `stale_after`, logs a **Creation**
//   update     its content changed: stamps `generated`, moves `stale_after`, logs an **Update**
//   verify     someone re-checked it against the code or its sources: adds a `verified` event (one per
//              actor — the newest), moves `stale_after`, logs a **Verification**
//   deprecate  kept for links and history, no longer current: `status: deprecated` (a feature's
//              `feature-status` too), stamps `generated`, drops `stale_after`, logs a **Deprecation**
//   remove     gone: deletes the file, logs a **Removal** — never a feature (deprecate it) and never a
//              page of the wiki's strict set
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  FEATURE_STATUS_KEY,
  KNOWLEDGE_DIR,
  ROOT_DIR_NAME,
  knowledgeDir,
  listAllTodos,
  manifestPath,
  readManifest,
  textValue,
} from './lib.ts';
import {
  FEATURES_DIR,
  LOG_TITLE,
  WIKI_DIR,
  WIKI_PAGES,
  newestMentions,
  readConcept,
  readConceptText,
  readKnowledgeSettings,
  readLog,
  recordable,
  reviewDaysFor,
  roleOfPath,
} from './knowledge.ts';
import {
  ACTOR_FORMAT,
  LOG_FILE,
  actorKind,
  addDaysToTimestamp,
  appendLogEntry,
  linkHref,
  nowTimestamp,
  oneLine,
  readVerified,
  setFrontmatterKeys,
  timestampDay,
  yamlFlowMap,
} from './okf.ts';

export const EVENT_KINDS = ['create', 'update', 'verify', 'deprecate', 'remove'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
/** The leading bold word of each event's log entry. */
const LOG_WORD: Record<EventKind, string> = {
  create: 'Creation',
  update: 'Update',
  verify: 'Verification',
  deprecate: 'Deprecation',
  remove: 'Removal',
};
export const MAX_EVENTS = 50;

export type KnowledgeEvent = {
  /** The concept's path inside the bundle, e.g. `wiki/architecture.md`. */
  readonly path: string;
  readonly event: EventKind;
  readonly by: string;
  readonly note: string;
  /** The todo this change belongs to, `<batch>/<todo>`. */
  readonly ref?: string;
};

export type Recorded = { path: string; event: EventKind; by: string; at: string };

/**
 * A person's actor id from git — `human:filipp-protsenko` for user.name "Filipp Protsenko" — so an
 * agent recording what the human did writes `"by": "human"` and never guesses the id.
 */
export function humanActor(root: string): string | null {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const id = name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return id === '' ? null : `human:${id}`;
  } catch {
    return null;
  }
}

/** A path as the caller wrote it → its path inside the bundle, or an error in words. */
export function bundlePath(root: string, nd: string, raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/');
  const bundle = knowledgeDir(nd);
  const absolute = isAbsolute(trimmed) ? trimmed : trimmed.startsWith(`${ROOT_DIR_NAME}/`) ? resolve(root, trimmed) : resolve(bundle, trimmed);
  const inside = relative(bundle, absolute).replace(/\\/g, '/');
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`'${raw}' is not inside ${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/ — name a concept of the knowledge bundle, like wiki/architecture.md`);
  }
  if (inside.split('/').some((part) => part.startsWith('.'))) {
    throw new Error(`'${raw}' is hidden — a file or folder whose name starts with "." is not part of the bundle`);
  }
  return inside;
}

/** Validate the caller's raw payload (the JSON file the agent writes). */
export function parseEvents(root: string, nd: string, raw: unknown): KnowledgeEvent[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('The payload is { "events": [ { "path", "event", "by", "note", "ref"? } ] }.');
  }
  const list = (raw as Record<string, unknown>).events;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('"events" must be a list of at least one event: { "path", "event", "by", "note", "ref"? }.');
  }
  if (list.length > MAX_EVENTS) throw new Error(`At most ${MAX_EVENTS} events in one call.`);
  const human = humanActor(root);
  return list.map((entry, i) => {
    const at = `event ${i + 1}`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${at} must be an object.`);
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== 'string' || e.path.trim() === '') throw new Error(`${at} needs a "path" — the concept, like wiki/architecture.md.`);
    const path = bundlePath(root, nd, e.path);
    const event = e.event === undefined ? 'update' : e.event;
    if (typeof event !== 'string' || !(EVENT_KINDS as readonly string[]).includes(event)) {
      throw new Error(`${at} (${path}): "event" is one of ${EVENT_KINDS.join(', ')}.`);
    }
    let by = typeof e.by === 'string' ? e.by.trim() : '';
    if (by === 'human') {
      if (human === null) throw new Error(`${at} (${path}): "by": "human" needs git's user.name — set it, or write "human:<id>".`);
      by = human;
    }
    if (actorKind(by) === null) throw new Error(`${at} (${path}): "by" must be an actor — ${ACTOR_FORMAT}.`);
    const note = typeof e.note === 'string' ? oneLine(e.note) : '';
    if (note === '') throw new Error(`${at} (${path}): "note" says what changed, or what was checked — one line for the log.`);
    let ref: string | undefined;
    if (e.ref !== undefined && e.ref !== null && e.ref !== '') {
      if (typeof e.ref !== 'string' || !/^\d{4}-\d{2}-\d{2}_\d+\/[^/\s]+$/.test(e.ref.trim())) {
        throw new Error(`${at} (${path}): "ref" is the todo this change belongs to, like 2026-10-11_1/01-kits.`);
      }
      ref = e.ref.trim();
    }
    return { path, event: event as EventKind, by, note, ...(ref !== undefined ? { ref } : {}) };
  });
}

/**
 * Record the events: check them all first, then write each concept's stamps and its log entry. One
 * moment (`now`) stamps the whole call. Returns what was recorded; throws, having written nothing,
 * when any event is refused.
 */
export function recordEvents(root: string, nd: string, events: readonly KnowledgeEvent[], now: Date = new Date()): Recorded[] {
  const bundle = knowledgeDir(nd);
  const log = readLog(nd);
  if (log === null) {
    throw new Error(`${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/${LOG_FILE} is missing — restore it from git (a new project gets one from \`novadev deploy\`).`);
  }
  if (log.read.problems.length > 0) {
    throw new Error(`${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/${LOG_FILE} needs repair first: ${log.read.problems[0]}`);
  }
  // Every concept recorded takes its review date from the project's policy. Read wrong, it would date
  // nothing — and drop the dates already written — so a policy that cannot be read stops the call.
  // A mistake in "knowledge.folders" does not: the map's lines have nothing to do with the dates.
  const manifest = readManifest(nd);
  if (manifest === null && existsSync(manifestPath(nd))) {
    throw new Error(`${ROOT_DIR_NAME}/novadev.json is not a valid JSON object (a merge conflict?) — fix it first: the review dates come from it. Nothing was recorded.`);
  }
  const settings = readKnowledgeSettings(manifest?.knowledge);
  if (settings.shape !== null) {
    throw new Error(`${ROOT_DIR_NAME}/novadev.json: ${settings.shape}. Fix it first: the review dates come from "knowledge". Nothing was recorded.`);
  }
  if (!settings.reviewDays.ok) {
    throw new Error(`${ROOT_DIR_NAME}/novadev.json: ${settings.reviewDays.error}. Fix it first: the review dates come from it. Nothing was recorded.`);
  }
  const reviewDays = settings.reviewDays.value;
  const todos = new Set(listAllTodos(nd).map((t) => t.ref));
  const lastKind = new Map<string, string | null>(
    [...newestMentions(log.read)].map(([path, mention]) => [path, mention.kind?.toLowerCase() ?? null]),
  );
  const gone = new Set<string>();

  // 1. Check every event before anything is written.
  for (const e of events) {
    const label = `${e.event} ${e.path}`;
    if (!recordable(e.path)) {
      throw new Error(`${label}: not a concept you record — index.md and log.md are reserved, and a feature's work.md and tests.md are derived.`);
    }
    if (e.ref !== undefined && !todos.has(e.ref)) throw new Error(`${label}: "ref" ${e.ref} is no todo in todos/ or the archive.`);
    const file = join(bundle, e.path);
    const removed = lastKind.get(e.path) === 'removal';
    if (e.event === 'remove') {
      if (roleOfPath(e.path) === 'feature') {
        throw new Error(`${label}: a feature is never removed — record "deprecate", so its id and history stay resolvable.`);
      }
      if (e.path.startsWith(`${WIKI_DIR}/`) && WIKI_PAGES.some((page) => `${WIKI_DIR}/${page.file}` === e.path)) {
        throw new Error(`${label}: a page of the wiki's strict set is never removed — rewrite it instead.`);
      }
      if (removed) throw new Error(`${label}: the log already says it was removed.`);
      if (!existsSync(file) && !lastKind.has(e.path) && !gone.has(e.path)) {
        // Nothing on disk and nothing in the log: there is nothing to record.
        throw new Error(`${label}: no such concept, and the log never named it.`);
      }
      gone.add(e.path);
      lastKind.set(e.path, 'removal');
      continue;
    }
    if (gone.has(e.path) || !existsSync(file)) throw new Error(`${label}: no such concept in the bundle.`);
    const concept = readConcept(bundle, e.path);
    if (concept.read.state !== 'ok') {
      throw new Error(`${label}: its frontmatter must be valid first — ${concept.read.state === 'none' ? 'it has none' : concept.read.error}.`);
    }
    for (const [key, what] of [
      ['type', 'its type'],
      ['title', 'its name'],
      ['description', 'one line saying what it is (for a memory: when it applies)'],
    ] as const) {
      const value = textValue(concept.data[key]);
      if (value === '' || /^<[^>]*>$/.test(value)) throw new Error(`${label}: write its "${key}" first — ${what}.`);
    }
    if (e.event === 'create' && lastKind.has(e.path) && !removed) {
      throw new Error(`${label}: the log already has it — record "update" for a change.`);
    }
    if (e.event !== 'create' && removed) throw new Error(`${label}: the log says it was removed — record "create" to bring it back.`);
    if (e.event === 'verify' && concept.status === 'deprecated') {
      throw new Error(`${label}: it is deprecated — a deprecated concept is kept for history, not re-checked.`);
    }
    const verified = readVerified(concept.data.verified);
    if (e.event === 'verify' && !verified.ok) {
      // Rewriting the list would drop the checks it records; repair it by hand first.
      throw new Error(`${label}: its "verified" list must be repaired first — ${verified.error}.`);
    }
    lastKind.set(e.path, LOG_WORD[e.event].toLowerCase());
  }

  // 2. Work out every file's new content — nothing is written yet.
  const at = nowTimestamp(now);
  const day = timestampDay(at);
  let logText = log.text;
  const recorded: Recorded[] = [];
  /** The new text of each file the call changes, by absolute path; null deletes the file. */
  const outputs = new Map<string, string | null>();
  const current = (file: string): string | null =>
    outputs.has(file) ? outputs.get(file)! : existsSync(file) ? readFileSync(file, 'utf8') : null;
  for (const e of events) {
    const file = join(bundle, e.path);
    const text = current(file);
    let title = e.path;
    if (e.event === 'remove') {
      if (text !== null) title = readConceptText(bundle, e.path, text).title || e.path;
      outputs.set(file, null);
    } else {
      if (text === null) throw new Error(`${e.event} ${e.path}: no such concept in the bundle.`);
      const concept = readConceptText(bundle, e.path, text);
      title = concept.title || e.path;
      const days = reviewDaysFor(reviewDays, e.path);
      const updates: Record<string, string | null> = {};
      if (e.event === 'create' || e.event === 'update' || e.event === 'deprecate') {
        updates.generated = yamlFlowMap([
          ['by', e.by],
          ['at', at],
        ]);
      }
      if (e.event === 'verify') {
        const previous = readVerified(concept.data.verified);
        const kept = (previous.ok ? previous.value : []).filter((event) => event.by !== e.by);
        const events = [...kept, { by: e.by, at }];
        updates.verified = ['', ...events.map((event) => `  - ${yamlFlowMap([['by', event.by], ['at', event.at]])}`)].join('\n');
      }
      if (e.event === 'deprecate') {
        updates.status = 'deprecated';
        if (roleOfPath(e.path) === 'feature') updates[FEATURE_STATUS_KEY] = 'deprecated';
      }
      // A review date follows the policy for the concept's top-level folder (or "*"): none for a
      // folder that is never due, and none for a deprecated concept — it is kept for history, not
      // re-checked.
      const deprecated = e.event === 'deprecate' || concept.status === 'deprecated';
      updates.stale_after = days === null || deprecated ? null : addDaysToTimestamp(at, days);
      const next = setFrontmatterKeys(text, updates);
      if (next === null) throw new Error(`${e.event} ${e.path}: its frontmatter vanished while recording.`);
      outputs.set(file, next);
    }
    const tail = [e.by, e.ref].filter(Boolean).join(' · ');
    logText = appendLogEntry(logText, day, `**${LOG_WORD[e.event]}**: [${linkLabel(title)}](${linkHref(e.path)}) — ${e.note} (${tail})`, LOG_TITLE);
    recorded.push({ path: e.path, event: e.event, by: e.by, at });
  }
  outputs.set(join(bundle, LOG_FILE), logText);

  // 3. Write them all, or none: each new text goes to a hidden temporary file beside its target
  // first; only when every one is on disk do they replace their targets, and the removals go last.
  // A refusal or a failed write leaves the bundle exactly as it was.
  for (const file of outputs.keys()) {
    const target = existsSync(file) ? file : dirname(file);
    try {
      accessSync(target, constants.W_OK);
    } catch {
      throw new Error(`${relative(bundle, file) || LOG_FILE}: cannot be written — check its permissions. Nothing was recorded.`);
    }
  }
  const staged: Array<{ file: string; temp: string }> = [];
  try {
    for (const [file, next] of outputs) {
      if (next === null) continue;
      const temp = join(dirname(file), `.${basename(file)}.novadev-${process.pid}.tmp`);
      writeFileSync(temp, next);
      staged.push({ file, temp });
    }
  } catch (error) {
    for (const { temp } of staged) rmSync(temp, { force: true });
    throw new Error(`could not write the changes, so nothing was recorded: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const { file, temp } of staged) renameSync(temp, file);
  for (const [file, next] of outputs) if (next === null) rmSync(file, { force: true });
  return recorded;
}

function linkLabel(title: string): string {
  return oneLine(title).replace(/[\\[\]]/g, (c) => `\\${c}`);
}
