// The project's knowledge: one Open Knowledge Format (OKF v0.2) bundle at `.novadev/knowledge/`, and
// the rules novadev adds on top of the format — its profile.
//
//   knowledge/
//     index.md      DERIVED — okf_version, then the load-first map: the wiki pages, the memories,
//                   the features, the log
//     log.md        what changed in the knowledge, newest day first — written by `novadev knowledge log`
//     wiki/         the project pre-context         type: Wiki Page (a strict page set)
//     memories/     what cost time, so it never does again
//                                                   type: Guardrail | Gotcha | Decision | Guide
//     features/     what the software does          FEAT-NNNN-<slug>/feature.md   type: Feature
//                                                   work.md, tests.md beside it — DERIVED histories
//     <any other folder the project adds>           any type; `"knowledge.folders"` in novadev.json
//                                                   says what it holds, for the map
//
// The format (okf.ts) asks only for a `type`. novadev asks more of every hand-written concept: a
// `title`, a one-line `description` (the derived indexes show it), and a `generated: { by, at }` stamp
// — who wrote the current content, and when. Every change to a concept is RECORDED: its stamps in
// the frontmatter, and an entry in log.md, both written by `novadev knowledge log` (knowledge-log.ts).
// `novadev sync` then keeps the indexes, checks that the log knows every change, and lists the
// concepts whose `stale_after` has passed — the review days of their folder, in novadev.json — and
// those whose code (`repo:` sources) changed after they were last checked, so knowledge is re-checked
// before it rots.
//
// Work items are not concepts: todos, records and test rounds move into the archive, so the
// knowledge cites them by stable id in its `sources` — `todo:<batch>/<todo>`, `commit:<hash>` —
// and code by `repo:<path>`. Links between concepts are plain relative markdown links.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lastCommitDate } from './git.ts';
import {
  FEATURE_DIR_RE,
  FEATURE_STATUS_KEY,
  FEATURE_STATUSES,
  KNOWLEDGE_DIR,
  NOVADEV_VERSION,
  ROOT_DIR_NAME,
  type Fix,
  type Parsed,
  addDays,
  byCodePoint,
  featureStatusMark,
  isDirectory,
  isPlainObject,
  knowledgeDir,
  listAllTodos,
  listDirs,
  readManifest,
  refuse,
  textValue,
} from './lib.ts';
import {
  INDEX_FILE,
  LOG_FILE,
  OKF_VERSION,
  type FrontmatterRead,
  type IndexSection,
  type LifecycleStatus,
  type LogRead,
  type Source,
  type StampEvent,
  type TrustTier,
  appendLogEntry,
  bundleMarkdownFiles,
  conformanceProblems,
  isReserved,
  isStale,
  linkTargets,
  oneLine,
  parseLog,
  readFrontmatterText,
  readGenerated,
  readSources,
  readStaleAfter,
  readStatus,
  readTags,
  readUsageWindow,
  readVerified,
  renderIndex,
  resolveBundleLink,
  setFrontmatterKeys,
  splitFrontmatter,
  timestampDay,
  trustTier,
} from './okf.ts';

export const WIKI_DIR = 'wiki';
export const MEMORIES_DIR = 'memories';
export const FEATURES_DIR = 'features';
/** The three folders novadev gives meaning to. A project may add others; they hold concepts of any type. */
export const KNOWLEDGE_FOLDERS = [WIKI_DIR, MEMORIES_DIR, FEATURES_DIR] as const;
export type KnowledgeFolder = (typeof KNOWLEDGE_FOLDERS)[number];

export const WIKI_PAGE_TYPE = 'Wiki Page';
/** A memory's type says what kind of lesson it is. Listed in the order the memories index shows them. */
export const MEMORY_TYPES = ['Guardrail', 'Gotcha', 'Decision', 'Guide'] as const;
export const FEATURE_TYPE = 'Feature';
export const WORK_HISTORY_TYPE = 'Work History';
export const TEST_HISTORY_TYPE = 'Test History';
/** The actor of everything `novadev sync` derives. */
export const DERIVED_ACTOR = 'process:novadev-sync';
export const LOG_TITLE = 'Knowledge log';

/**
 * The strict wiki page set, in the order the indexes list it. Each page is a `Wiki Page` concept;
 * `about` is what it is for — the playbook's table, and the description a new page starts from.
 */
export const WIKI_PAGES = [
  { file: 'overview.md', title: 'Overview', about: 'What the system is: purpose, users, capabilities, top-level layout.' },
  { file: 'stack.md', title: 'Stack', about: 'Languages, frameworks, runtimes, package managers, key dependencies and why, version constraints.' },
  { file: 'architecture.md', title: 'Architecture', about: 'The parts and how they connect: modules, boundaries, data flow, where state lives.' },
  { file: 'conventions.md', title: 'Conventions', about: 'How code is written here: style, naming, patterns required and banned, review gates.' },
  { file: 'workflows.md', title: 'Workflows', about: 'Build, run, test, debug, deploy: exact commands, environments, secrets handling, CI.' },
  { file: 'glossary.md', title: 'Glossary', about: "The project's own terms an outsider would not know." },
] as const;

/** What a concept is to novadev, from where it sits in the bundle. */
export type ConceptRole = 'wiki' | 'memory' | 'feature' | 'work-history' | 'test-history' | 'other';

export type Concept = {
  /** The path inside the bundle — its OKF identity — e.g. `wiki/architecture.md`. */
  path: string;
  /** The absolute path on disk. */
  file: string;
  role: ConceptRole;
  /** Rewritten by `novadev sync`: a feature's work.md and tests.md. */
  derived: boolean;
  read: FrontmatterRead;
  /** The frontmatter — empty when it is missing or broken. */
  data: Record<string, unknown>;
  type: string;
  title: string;
  description: string;
  tags: string[];
  generated: { by: string; at: string | null } | null;
  verified: StampEvent[];
  tier: TrustTier;
  status: LifecycleStatus;
  staleAfter: string | null;
  sources: Source[];
  /** What is wrong with the OKF families (generated, verified, status, …), in words. */
  fieldProblems: string[];
  text: string;
  body: string;
};

/** The day the content last changed: the latest of `generated.at` and every `verified[].at`. */
export function lastChangeDay(concept: Concept): string | null {
  const days = [concept.generated?.at ?? null, ...concept.verified.map((event) => event.at)]
    .filter((at): at is string => at !== null)
    .map(timestampDay);
  return days.length === 0 ? null : [...days].sort().at(-1)!;
}

function roleOf(path: string): { role: ConceptRole; derived: boolean } {
  const parts = path.split('/');
  if (parts.length === 2 && parts[0] === WIKI_DIR) return { role: 'wiki', derived: false };
  if (parts.length === 2 && parts[0] === MEMORIES_DIR) return { role: 'memory', derived: false };
  if (parts.length === 3 && parts[0] === FEATURES_DIR && FEATURE_DIR_RE.test(parts[1]!)) {
    if (parts[2] === 'feature.md') return { role: 'feature', derived: false };
    if (parts[2] === 'work.md') return { role: 'work-history', derived: true };
    if (parts[2] === 'tests.md') return { role: 'test-history', derived: true };
  }
  return { role: 'other', derived: false };
}

/** Read one concept file of the bundle. */
export function readConcept(bundle: string, path: string): Concept {
  return readConceptText(bundle, path, readFileSync(join(bundle, path), 'utf8'));
}

/** A concept from its text — what a file of the bundle at `path` holds, or is about to hold. */
export function readConceptText(bundle: string, path: string, text: string): Concept {
  const file = join(bundle, path);
  const read = readFrontmatterText(text);
  const data = read.state === 'ok' ? read.data : {};
  const fieldProblems: string[] = [];
  const take = <T>(result: { ok: true; value: T } | { ok: false; error: string }, fallback: T): T => {
    if (result.ok) return result.value;
    fieldProblems.push(result.error);
    return fallback;
  };
  const generated = take(readGenerated(data.generated), null);
  const verified = take(readVerified(data.verified), []);
  const { role, derived } = roleOf(path);
  const concept: Concept = {
    path,
    file,
    role,
    derived,
    read,
    data,
    type: textValue(data.type),
    title: textValue(data.title),
    description: textValue(data.description),
    tags: take(readTags(data.tags), []),
    generated,
    verified,
    tier: trustTier(verified),
    status: take(readStatus(data.status), 'stable'),
    staleAfter: take(readStaleAfter(data.stale_after), null),
    sources: take(readSources(data.sources), []),
    fieldProblems,
    text,
    body: read.state === 'ok' ? read.body : text,
  };
  take(readUsageWindow(data.usage_window), null);
  return concept;
}

/** Every concept of the bundle — every `.md` file but the reserved `index.md` and `log.md` — by path. */
export function listConcepts(nd: string): Concept[] {
  const bundle = knowledgeDir(nd);
  if (!isDirectory(bundle)) return [];
  return bundleMarkdownFiles(bundle)
    .filter((path) => !isReserved(path))
    .map((path) => readConcept(bundle, path));
}

/** The concepts a person or an agent writes — everything but the derived histories. */
export function authoredConcepts(concepts: readonly Concept[]): Concept[] {
  return concepts.filter((concept) => !concept.derived);
}

/** The OKF lifecycle a feature's `feature-status` stands for: planned and in-progress are drafts. */
export function featureLifecycle(featureStatus: string): LifecycleStatus | null {
  if (featureStatus === 'shipped') return 'stable';
  if (featureStatus === 'deprecated') return 'deprecated';
  if (featureStatus === 'planned' || featureStatus === 'in-progress') return 'draft';
  return null;
}

/** The wiki's state: no page at all (it must be built), some of the strict set, or all of it. */
export function wikiState(nd: string): 'missing' | 'partial' | 'complete' {
  const dir = join(knowledgeDir(nd), WIKI_DIR);
  const present = WIKI_PAGES.filter((page) => existsSync(join(dir, page.file))).length;
  if (present === 0) return 'missing';
  return present === WIKI_PAGES.length ? 'complete' : 'partial';
}

// ---------------------------------------------------------------------------
// Settings: the review policy, and what the project's own folders hold
// ---------------------------------------------------------------------------

/**
 * How many days a concept stays fresh after it is written or verified, by the top-level folder it
 * sits in — one of novadev's three or one the project adds — and under OTHER_FOLDERS for every
 * concept no entry names. null: never due.
 */
export type ReviewDays = ReadonlyMap<string, number | null>;
export const REVIEW_DAYS_DEFAULT: Readonly<Record<KnowledgeFolder, number>> = { wiki: 90, memories: 180, features: 365 };
/** The `reviewDays` key for every concept no other key names: the folders not named, and the bundle root. */
export const OTHER_FOLDERS = '*';
/** The longest review a folder may ask for: a hundred years. */
export const MAX_REVIEW_DAYS = 36500;

/** One line saying what a folder of the bundle holds, for the map, by its path — in the order novadev.json declares them. */
export type FolderLines = ReadonlyMap<string, string>;

export type KnowledgeSettings = { reviewDays: ReviewDays; folders: FolderLines };

/**
 * "knowledge" in novadev.json, read part by part, so that a mistake in one part never drops the
 * other: `shape` says what is wrong with it as a whole (not an object, an unknown key), and each part
 * is read on its own.
 */
export type KnowledgeSettingsRead = { shape: string | null; reviewDays: Parsed<ReviewDays>; folders: Parsed<FolderLines> };

const KNOWLEDGE_FORMAT =
  '"knowledge" is { "reviewDays": { … }, "folders": { … } } — each optional — or null for no review dates';
const REVIEW_FORMAT =
  '"knowledge.reviewDays" gives a top-level folder of the bundle its review days, and "*" the days of every concept it names no folder for: { "wiki": 90, "memories": 180, "features": 365, "*": 180 } — whole days, or null for one that is never due';
const FOLDERS_FORMAT =
  '"knowledge.folders" gives a folder of the bundle one line saying what it holds, for the map in index.md: { "planner": "What a planner user can do, stage by stage." }';

/**
 * What is wrong with a folder named in "knowledge", in words — null when it can be a folder of the
 * bundle. `nested`: a path to a folder inside another one is allowed.
 */
function folderNameProblem(name: string, nested: boolean): string | null {
  if (name.trim() === '') return 'a folder needs a name';
  if (name.trim() !== name) return 'it has spaces around it, so it names no folder';
  if (name.includes('\\')) return 'write a path with "/"';
  const parts = name.split('/');
  if (parts.includes('')) return 'it has an empty part — write the path from the root of the bundle, like "references/tutorials"';
  if (!nested && parts.length > 1) return 'review days are set per top-level folder, and a folder inside one takes its days';
  if (parts.some((part) => part.startsWith('.'))) return 'a name starting with "." is hidden, and not part of the bundle';
  if (parts.some((part) => isReserved(part.toLowerCase()))) return `${INDEX_FILE} and ${LOG_FILE} are the files a bundle reserves, never folders`;
  if (parts.includes(OTHER_FOLDERS)) return `"${OTHER_FOLDERS}" stands for every folder not named, never for one`;
  return null;
}

/**
 * "knowledge" in novadev.json, part by part (see KnowledgeSettingsRead). Absent or null: no review
 * dates — `novadev knowledge log` then writes no `stale_after` — and no folder described.
 */
export function readKnowledgeSettings(raw: unknown): KnowledgeSettingsRead {
  if (raw === undefined || raw === null) return { shape: null, reviewDays: parseReviewDays(null), folders: parseFolderLines(null) };
  if (!isPlainObject(raw)) return { shape: KNOWLEDGE_FORMAT, reviewDays: parseReviewDays(null), folders: parseFolderLines(null) };
  const unknown = Object.keys(raw).find((key) => key !== 'reviewDays' && key !== 'folders');
  return {
    shape: unknown === undefined ? null : `"knowledge" has an unknown key "${unknown}" — ${KNOWLEDGE_FORMAT}`,
    reviewDays: parseReviewDays(raw.reviewDays),
    folders: parseFolderLines(raw.folders),
  };
}

/** "knowledge" in novadev.json as a whole: every part, or the first thing wrong with it. */
export function parseKnowledgeSettings(raw: unknown): Parsed<KnowledgeSettings> {
  const read = readKnowledgeSettings(raw);
  if (read.shape !== null) return refuse(read.shape);
  if (!read.reviewDays.ok) return refuse(read.reviewDays.error);
  if (!read.folders.ok) return refuse(read.folders.error);
  return { ok: true, value: { reviewDays: read.reviewDays.value, folders: read.folders.value } };
}

/** "knowledge.reviewDays". A folder may be written with a "/" at its end. */
function parseReviewDays(days: unknown): Parsed<ReviewDays> {
  const reviewDays = new Map<string, number | null>();
  if (days === undefined || days === null) return { ok: true, value: reviewDays };
  if (!isPlainObject(days)) return refuse(REVIEW_FORMAT);
  for (const [key, value] of Object.entries(days)) {
    const folder = key === OTHER_FOLDERS ? key : key.replace(/\/+$/, '');
    const problem = key === OTHER_FOLDERS ? null : folderNameProblem(folder, false);
    if (problem !== null) return refuse(`"knowledge.reviewDays" names "${key}" — ${problem}`);
    if (reviewDays.has(folder)) return refuse(`"knowledge.reviewDays" names ${folder}/ twice`);
    if (value !== null && !(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_REVIEW_DAYS)) {
      return refuse(
        `"knowledge.reviewDays" gives "${key}" ${JSON.stringify(value)} — whole days, 1 to ${MAX_REVIEW_DAYS}, or null for a folder that is never due`,
      );
    }
    reviewDays.set(folder, value);
  }
  return { ok: true, value: reviewDays };
}

/** "knowledge.folders". A folder may be written with a "/" at its end. */
function parseFolderLines(described: unknown): Parsed<FolderLines> {
  const folders = new Map<string, string>();
  if (described === undefined || described === null) return { ok: true, value: folders };
  if (!isPlainObject(described)) return refuse(FOLDERS_FORMAT);
  for (const [key, about] of Object.entries(described)) {
    const folder = key.replace(/\/+$/, '');
    const top = folder.split('/')[0]!;
    const problem =
      key === OTHER_FOLDERS
        ? `"${OTHER_FOLDERS}" belongs to reviewDays; a description is for one folder`
        : (KNOWLEDGE_FOLDERS as readonly string[]).includes(top)
          ? `novadev writes the map's line for ${top}/ itself`
          : folderNameProblem(folder, true);
    if (problem !== null) return refuse(`"knowledge.folders" names "${key}" — ${problem}`);
    if (folders.has(folder)) return refuse(`"knowledge.folders" names ${folder}/ twice`);
    if (typeof about !== 'string' || about.trim() === '' || /^<[^>]*>$/.test(about.trim())) {
      return refuse(`"knowledge.folders" gives "${key}" no line of its own — write what the folder holds, as text`);
    }
    if (/[\r\n]/.test(about)) return refuse(`"knowledge.folders" gives "${key}" more than one line — the map shows one`);
    folders.set(folder, about.trim());
  }
  return { ok: true, value: folders };
}

/**
 * The review days of the concept at `path` (a path inside the bundle): those of its top-level folder
 * when the policy names it — null: never due — else those of "*", else none.
 */
export function reviewDaysFor(reviewDays: ReviewDays, path: string): number | null {
  const slash = path.indexOf('/');
  const folder = slash === -1 ? null : path.slice(0, slash);
  if (folder !== null && reviewDays.has(folder)) return reviewDays.get(folder) ?? null;
  return reviewDays.get(OTHER_FOLDERS) ?? null;
}

// ---------------------------------------------------------------------------
// The derived index files
// ---------------------------------------------------------------------------

const INDEX_NOTE =
  'DERIVED by `novadev sync` from the frontmatter of the concepts listed here. Do not edit: it is rewritten. Change a concept, then run `novadev sync`.';

function sortByTitle(concepts: readonly Concept[]): Concept[] {
  return [...concepts].sort(
    (a, b) => byCodePoint((a.title || a.path).toLowerCase(), (b.title || b.path).toLowerCase()) || byCodePoint(a.path, b.path),
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The wiki pages in index order: the strict set as the playbook orders it, then any others by title. */
function wikiInOrder(pages: readonly Concept[]): Concept[] {
  const order = WIKI_PAGES.map((page) => `${WIKI_DIR}/${page.file}`);
  const known = order.flatMap((path) => pages.filter((page) => page.path === path));
  return [...known, ...sortByTitle(pages.filter((page) => !order.includes(page.path)))];
}

function relativeTo(dir: string, path: string): string {
  return dir === '' ? path : path.slice(dir.length + 1);
}

function featureDescription(feature: Concept): string {
  const status = textValue(feature.data[FEATURE_STATUS_KEY]);
  return [status, feature.description].filter(Boolean).join(' · ');
}

function featureTitle(feature: Concept): string {
  const id = textValue(feature.data.id);
  return id ? `${id} — ${feature.title}` : feature.title;
}

/** Every directory of the bundle (as a bundle path, '' for the root) that holds concepts, at any depth. */
function directoriesWithConcepts(concepts: readonly Concept[]): string[] {
  const dirs = new Set<string>(['']);
  for (const concept of concepts) {
    const parts = concept.path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return [...dirs].sort(byCodePoint);
}

/**
 * What each `index.md` of the bundle must say, by its bundle path. The root always has one; the
 * wiki, memories and features folders once they hold a concept; any other folder holding concepts,
 * at any depth — except a feature's own folder, whose three files its feature.md links. A folder
 * whose index is not derived keeps whatever it has (an empty registry's hand-made index included).
 *
 * A folder the project adds is one entry in the index above it: the line `"knowledge.folders"` in
 * novadev.json gives it, then how many concepts it holds. The folders novadev.json describes come
 * first, in the order it declares them; the others follow by name.
 */
export function derivedIndexes(nd: string, concepts: readonly Concept[]): Map<string, string> {
  const out = new Map<string, string>();
  const authored = authoredConcepts(concepts);
  const inDir = (dir: string) =>
    authored.filter((c) => c.path.split('/').slice(0, -1).join('/') === dir);
  const wiki = authored.filter((c) => c.role === 'wiki');
  const memories = authored.filter((c) => c.role === 'memory');
  const features = authored.filter((c) => c.role === 'feature');
  // Lines that cannot be read are a problem of their own (auditKnowledge): the map then describes nothing.
  const lines = readKnowledgeSettings(readManifest(nd)?.knowledge).folders;
  const described: FolderLines = lines.ok ? lines.value : new Map();
  const declared = [...described.keys()];
  const inMapOrder = (dirs: readonly string[]) => [
    ...declared.filter((dir) => dirs.includes(dir)),
    ...dirs.filter((dir) => !described.has(dir)),
  ];
  /** A folder's entry, linked from the index of the folder above it (`from`, '' for the root). */
  const folderEntry = (dir: string, from: string) => {
    const count = plural(authored.filter((c) => c.path.startsWith(`${dir}/`)).length, 'concept', 'concepts');
    const about = described.get(dir);
    return {
      title: dir.split('/').pop()!,
      href: `${relativeTo(from, dir)}/${INDEX_FILE}`,
      description: about === undefined ? count : `${about} (${count})`,
    };
  };

  // The root: the load-first map.
  const root: IndexSection[] = [];
  if (wiki.length > 0) {
    root.push({
      heading: 'Wiki',
      entries: wikiInOrder(wiki).map((page) => ({ title: page.title || page.path, href: page.path, description: page.description })),
    });
  }
  if (memories.length > 0) {
    const counts = MEMORY_TYPES.map((type) => [type, memories.filter((m) => m.type === type).length] as const)
      .filter(([, n]) => n > 0)
      .map(([type, n]) => `${n} ${type.toLowerCase()}${n === 1 ? '' : 's'}`);
    root.push({
      heading: 'Memories',
      entries: [
        {
          title: 'Memories',
          href: `${MEMORIES_DIR}/${INDEX_FILE}`,
          description: `${plural(memories.length, 'lesson', 'lessons')} (${counts.join(', ') || 'none typed yet'}) — open the ones whose line touches your task`,
        },
      ],
    });
  }
  if (features.length > 0) {
    const counts = FEATURE_STATUSES.map((s) => [s, features.filter((f) => textValue(f.data[FEATURE_STATUS_KEY]) === s).length] as const)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${n} ${s}`);
    root.push({
      heading: 'Features',
      entries: [
        {
          title: 'Features',
          href: `${FEATURES_DIR}/${INDEX_FILE}`,
          description: `${plural(features.length, 'capability', 'capabilities')} (${counts.join(', ')}) — what the software does; search it before building anything new`,
        },
      ],
    });
  }
  const others = directoriesWithConcepts(authored).filter(
    (dir) => dir !== '' && !dir.includes('/') && !(KNOWLEDGE_FOLDERS as readonly string[]).includes(dir),
  );
  const rootConcepts = sortByTitle(inDir(''));
  if (others.length > 0 || rootConcepts.length > 0) {
    root.push({
      heading: 'More knowledge',
      entries: [
        ...rootConcepts.map((c) => ({ title: c.title || c.path, href: c.path, description: c.description })),
        ...inMapOrder(others).map((dir) => folderEntry(dir, '')),
      ],
    });
  }
  root.push({
    heading: 'History',
    entries: [{ title: LOG_TITLE, href: LOG_FILE, description: 'what changed in this knowledge, newest day first' }],
  });
  out.set(INDEX_FILE, renderIndex(root, { okfVersion: OKF_VERSION, comment: INDEX_NOTE }));

  if (wiki.length > 0) {
    out.set(
      `${WIKI_DIR}/${INDEX_FILE}`,
      renderIndex(
        [
          {
            heading: 'Wiki',
            entries: wikiInOrder(wiki).map((p) => ({ title: p.title || p.path, href: relativeTo(WIKI_DIR, p.path), description: p.description })),
          },
        ],
        { comment: INDEX_NOTE },
      ),
    );
  }

  if (memories.length > 0) {
    const current = memories.filter((m) => m.status !== 'deprecated');
    const sections: IndexSection[] = MEMORY_TYPES.map((type) => ({
      heading: `${type}s`,
      entries: sortByTitle(current.filter((m) => m.type === type)).map((m) => ({
        title: m.title || m.path,
        href: relativeTo(MEMORIES_DIR, m.path),
        description: m.description,
      })),
    }));
    const untyped = current.filter((m) => !(MEMORY_TYPES as readonly string[]).includes(m.type));
    sections.push({
      heading: 'Not yet typed',
      entries: sortByTitle(untyped).map((m) => ({ title: m.title || m.path, href: relativeTo(MEMORIES_DIR, m.path), description: m.description })),
    });
    sections.push({
      heading: 'Deprecated',
      entries: sortByTitle(memories.filter((m) => m.status === 'deprecated')).map((m) => ({
        title: m.title || m.path,
        href: relativeTo(MEMORIES_DIR, m.path),
        description: m.description,
      })),
    });
    out.set(`${MEMORIES_DIR}/${INDEX_FILE}`, renderIndex(sections.filter((s) => s.entries.length > 0), { comment: INDEX_NOTE }));
  }

  if (features.length > 0) {
    const areas = [...new Set(features.map((f) => textValue(f.data.area)))].sort(byCodePoint);
    const sections = areas.map((area) => ({
      heading: area || '(no area)',
      entries: features
        .filter((f) => textValue(f.data.area) === area)
        .sort((a, b) => byCodePoint(a.path, b.path))
        .map((f) => ({
          title: `${featureStatusMark(textValue(f.data[FEATURE_STATUS_KEY]))} ${featureTitle(f)}`,
          href: relativeTo(FEATURES_DIR, f.path),
          description: featureDescription(f),
        })),
    }));
    out.set(`${FEATURES_DIR}/${INDEX_FILE}`, renderIndex(sections, { comment: INDEX_NOTE }));
  }

  for (const dir of directoriesWithConcepts(authored)) {
    if (dir === '' || (KNOWLEDGE_FOLDERS as readonly string[]).includes(dir)) continue;
    if (dir.startsWith(`${FEATURES_DIR}/`) && FEATURE_DIR_RE.test(dir.split('/')[1]!)) continue;
    const here = sortByTitle(inDir(dir));
    const subdirs = directoriesWithConcepts(authored).filter(
      (sub) => sub.startsWith(`${dir}/`) && !sub.slice(dir.length + 1).includes('/'),
    );
    out.set(
      `${dir}/${INDEX_FILE}`,
      renderIndex(
        [
          {
            heading: dir.split('/').pop()!,
            entries: [
              ...here.map((c) => ({ title: c.title || c.path, href: relativeTo(dir, c.path), description: c.description })),
              ...inMapOrder(subdirs).map((sub) => folderEntry(sub, dir)),
            ],
          },
        ],
        { comment: INDEX_NOTE },
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// The log: does it know every change?
// ---------------------------------------------------------------------------

/** The bundle paths a log entry links to (log.md sits at the bundle root), hidden ones left out. */
export function entryPaths(links: readonly string[]): string[] {
  return links.flatMap((target) => {
    const path = resolveBundleLink(target, LOG_FILE);
    if (path === null || !path.toLowerCase().endsWith('.md')) return [];
    return path.split('/').some((part) => part.startsWith('.')) ? [] : [path];
  });
}

/**
 * The concept a log entry is ABOUT: its first link to a concept of the bundle — the one
 * `novadev knowledge log` writes right after the bold word. Links later in the note ("merged into
 * [the guide](memories/guide.md)") are prose, not events of the concepts they name.
 */
export function entrySubject(links: readonly string[]): string | null {
  return entryPaths(links)[0] ?? null;
}

/** How many log entries are about each concept. */
export function entryCounts(log: LogRead): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of log.entries) {
    const path = entrySubject(entry.links);
    if (path !== null) out.set(path, (out.get(path) ?? 0) + 1);
  }
  return out;
}

/** The day of the oldest `**Initialization**` entry: changes up to that day need no entry of their own. */
export function initializationDay(log: LogRead): string | null {
  const days = log.entries.filter((e) => e.kind?.toLowerCase() === 'initialization').map((e) => e.date);
  return days.length === 0 ? null : [...days].sort()[0]!;
}

/** For every concept the log has an entry about, its newest one: the latest day, and within it the last line. */
export function newestMentions(log: LogRead): Map<string, { date: string; kind: string | null }> {
  const out = new Map<string, { date: string; kind: string | null }>();
  for (const section of log.sections) {
    for (const entry of [...section.entries].reverse()) {
      const path = entrySubject(entry.links);
      if (path !== null && !out.has(path)) out.set(path, { date: entry.date, kind: entry.kind });
    }
  }
  return out;
}

/** The newest log entry that links to `path`, or null. */
export function newestMention(log: LogRead, path: string): { date: string; kind: string | null } | null {
  return newestMentions(log).get(path) ?? null;
}

/** A new bundle's log: one entry, saying the bundle started today. */
export function initialLog(day: string): string {
  return appendLogEntry(
    '',
    day,
    `**Initialization**: novadev ${NOVADEV_VERSION} started this knowledge bundle — an Open Knowledge Format (OKF ${OKF_VERSION}) bundle for the project's wiki, memories and features.`,
    LOG_TITLE,
  );
}

export function readLog(nd: string): { text: string; read: LogRead } | null {
  const path = join(knowledgeDir(nd), LOG_FILE);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  return { text, read: parseLog(text) };
}

// ---------------------------------------------------------------------------
// The audit — what doctor and sync report, and what sync rewrites
// ---------------------------------------------------------------------------

export type KnowledgeAudit = {
  /** Broken knowledge: `novadev sync` exits 1, and `--check` fails. */
  problems: string[];
  /** Worth knowing, nothing to do now. */
  notes: string[];
  /** Derived files out of date: the indexes, a feature's derived `status`. */
  fixes: Fix[];
  /**
   * The agent's NEXT ACTIONS: build the wiki, re-check stale concepts and those whose code changed
   * since, record unrecorded changes.
   */
  actions: string[];
  concepts: Concept[];
};

const LEGACY_FOLDERS = ['wiki', 'memories', 'features'];
const AT = `${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}`;
/** How a message names a file of the bundle. */
const where = (path: string) => `${KNOWLEDGE_DIR}/${path}`;
const LOG_HOW = 'record it with `novadev knowledge log` (skills/novadev-work.md, "Recording a change")';
const STALE_SHOWN = 5;
const DRIFT_SHOWN = 5;

/**
 * Judge the bundle. `now` decides what is stale; git (when the project is a repository) says which
 * concepts changed since the last commit, and which `repo:` sources changed since their concept was
 * last checked. `sourceDays` keeps git's answers about those sources: the audits of one run may share it.
 */
export function auditKnowledge(
  root: string,
  nd: string,
  opts: { now?: Date; sourceDays?: Map<string, string | null> } = {},
): KnowledgeAudit {
  const now = opts.now ?? new Date();
  const problems: string[] = [];
  const notes: string[] = [];
  const fixes: Fix[] = [];
  const actions: string[] = [];
  const bundle = knowledgeDir(nd);

  for (const folder of LEGACY_FOLDERS) {
    if (existsSync(join(nd, folder))) {
      problems.push(
        `${folder}/: knowledge lives in ${AT}/${folder}/ since novadev 0.12.0 — run \`novadev migrate-repo\`, or move what is left there by hand`,
      );
    }
  }
  if (!isDirectory(bundle)) {
    problems.push(`${KNOWLEDGE_DIR}/: missing — the project's knowledge bundle; run \`novadev deploy\``);
    return { problems, notes, fixes, actions, concepts: [] };
  }

  // Each part of the settings on its own: a mistake in one is reported, and the other still counts.
  const raw = readManifest(nd)?.knowledge;
  const settings = readKnowledgeSettings(raw);
  if (settings.shape !== null) problems.push(`novadev.json: ${settings.shape}`);
  if (!settings.reviewDays.ok) problems.push(`novadev.json: ${settings.reviewDays.error}`);
  if (!settings.folders.ok) problems.push(`novadev.json: ${settings.folders.error}`);
  // A "knowledge" without "reviewDays" — "folders" pasted over the whole object, say — dates nothing.
  if (isPlainObject(raw) && !Object.hasOwn(raw, 'reviewDays')) {
    notes.push(
      `novadev.json: "knowledge" has no "reviewDays", so no concept gets a review date — write them back (the default is ${JSON.stringify(REVIEW_DAYS_DEFAULT)}), or "reviewDays": null to mean it`,
    );
  }

  const concepts = listConcepts(nd);
  const authored = authoredConcepts(concepts);
  const todoRefs = new Set(listAllTodos(nd).map((t) => t.ref));
  const bundlePaths = new Set(bundleMarkdownFiles(bundle));

  // A folder the settings name that holds nothing yet: one still to come, or a typo that would
  // silently date or describe nothing. novadev's own three may wait for their first concept.
  const held = new Set(directoriesWithConcepts(authored));
  for (const folder of settings.reviewDays.ok ? settings.reviewDays.value.keys() : []) {
    if (folder === OTHER_FOLDERS || (KNOWLEDGE_FOLDERS as readonly string[]).includes(folder) || held.has(folder)) continue;
    notes.push(`novadev.json: "knowledge.reviewDays" names ${folder}/, which holds no concept — a folder still to come, or a typo`);
  }
  for (const folder of settings.folders.ok ? settings.folders.value.keys() : []) {
    if (!held.has(folder)) notes.push(`novadev.json: "knowledge.folders" describes ${folder}/, which holds no concept — a folder still to come, or a typo`);
  }

  // --- every file: the format's own conformance rules ---
  for (const path of bundlePaths) {
    const name = path.split('/').pop()!;
    const lower = name.toLowerCase();
    if (lower !== name && (lower === INDEX_FILE || lower === LOG_FILE)) {
      problems.push(
        `${where(path)}: OKF reserves "${lower}" in lower case — ${lower === INDEX_FILE ? 'novadev derives index.md since 0.12.0, so delete this file and run `novadev sync`' : 'rename it to log.md'}`,
      );
      continue;
    }
    if (isReserved(path)) continue; // index and log files are judged below
    const concept = concepts.find((c) => c.path === path);
    if (concept === undefined || concept.derived) continue; // derived files are checked by being derived
    const oldKind = concept.role === 'memory' && concept.read.state === 'ok' && !concept.type ? textValue(concept.data.kind) : '';
    if (oldKind !== '') {
      problems.push(
        `${where(path)}: no \`type\` — its old kind "${oldKind}" is none of ${MEMORY_TYPES.join(', ')}; read it, write the type that fits as "type:", and delete "kind:"`,
      );
      continue;
    }
    for (const problem of conformanceProblems(path, concept.text)) {
      const hint = name === 'README.md' ? ' (novadev keeps no README inside the bundle — delete it, or make it a concept)' : '';
      problems.push(`${where(path)}: ${problem}${hint}`);
    }
  }

  // --- every hand-written concept: novadev's profile ---
  for (const c of authored) {
    if (c.read.state !== 'ok' || !c.type) continue; // conformance said so already
    const at = where(c.path);
    for (const problem of c.fieldProblems) problems.push(`${at}: ${problem}`);
    const parts = c.path.split('/');
    if (c.role === 'other') {
      if (parts[0] === WIKI_DIR || parts[0] === MEMORIES_DIR) {
        problems.push(`${at}: ${parts[0]}/ is flat — move this page up into ${parts[0]}/, or into a folder of its own`);
      } else if (parts[0] === FEATURES_DIR && parts.length === 2) {
        problems.push(`${at}: features/ holds one folder per feature, FEAT-NNNN-<slug>/feature.md — move it into one`);
      } else if (parts[0] === FEATURES_DIR && !FEATURE_DIR_RE.test(parts[1]!)) {
        problems.push(`${at}: a feature folder is named FEAT-NNNN-<kebab-slug>`);
      }
    }
    if (c.role === 'wiki' && c.type !== WIKI_PAGE_TYPE) {
      problems.push(`${at}: type "${c.type}" — a wiki page is type: ${WIKI_PAGE_TYPE}`);
    }
    if (c.role === 'memory' && !(MEMORY_TYPES as readonly string[]).includes(c.type)) {
      problems.push(`${at}: type "${c.type}" — a memory is one of: ${MEMORY_TYPES.join(', ')}`);
    }
    if (c.role === 'feature' && c.type !== FEATURE_TYPE) {
      problems.push(`${at}: type "${c.type}" — a feature is type: ${FEATURE_TYPE}`);
    }
    if (typeof c.data.title !== 'string' || c.title === '') problems.push(`${at}: needs a "title" — its name, as text`);
    if (typeof c.data.description !== 'string' || c.description === '') {
      problems.push(`${at}: needs a "description" — one line saying ${c.role === 'memory' ? 'when it applies' : 'what it is'}; the indexes show it`);
    } else if (/[\r\n]/.test(c.description)) {
      problems.push(`${at}: "description" is one line`);
    } else if (/^<[^>]*>$/.test(c.description)) {
      problems.push(`${at}: "description" is still the placeholder — write the line`);
    }
    if (c.generated === null && !c.fieldProblems.some((p) => p.includes('"generated'))) {
      problems.push(`${at}: no "generated" stamp — who wrote it, and when; ${LOG_HOW}`);
    } else if (c.generated !== null && c.generated.at === null) {
      problems.push(`${at}: "generated" has no "at" — ${LOG_HOW}`);
    }
    if (c.role === 'memory' && c.data.created !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(textValue(c.data.created))) {
      problems.push(`${at}: "created" is a day, like 2026-10-11`);
    }
    if (c.role === 'feature') {
      const lifecycle = featureLifecycle(textValue(c.data[FEATURE_STATUS_KEY]));
      if (lifecycle !== null && c.data.status !== lifecycle) {
        const next = setFrontmatterKeys(c.text, { status: lifecycle });
        if (next !== null && next !== c.text) {
          fixes.push({ path: c.file, label: `${at}: "status" must be ${lifecycle}, as "${FEATURE_STATUS_KEY}" says`, next });
        }
      }
    }
    // A relative link that reaches nothing. Inside the bundle OKF reads it as knowledge not written
    // yet; out of it, the code or document it named moved. A note either way — never a failure.
    for (const target of linkTargets(c.body)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
      const inside = resolveBundleLink(target, c.path);
      if (inside !== null) {
        if (!bundlePaths.has(inside) && !existsSync(join(bundle, inside))) {
          // A missing concept may be knowledge not written yet; anything else is a path that is wrong.
          notes.push(`${at}: links ${target}, which ${inside.toLowerCase().endsWith('.md') ? 'is not in the bundle' : 'does not exist'}`);
        }
        continue;
      }
      if (target.startsWith('/')) continue;
      if (!existsSync(join(dirname(c.file), decodeTarget(target)))) notes.push(`${at}: links ${target}, which does not exist`);
    }
    for (const source of c.sources) {
      const resource = source.resource;
      if (resource.startsWith('todo:')) {
        if (!todoRefs.has(resource.slice(5))) problems.push(`${at}: source ${resource} — no such todo in todos/ or the archive`);
      } else if (resource.startsWith('repo:')) {
        const rel = repoPath(resource);
        if (rel === null || !existsSync(join(root, rel))) {
          actions.push(`${at}: its source ${resource} is gone — the code it describes moved or went; re-check the concept and its sources (loop phase 9)`);
        } else if (novadevOwn(rel)) {
          notes.push(
            `${at}: source ${resource} is novadev's own bookkeeping, which every round commits — cite a todo as todo:<batch>/<todo> and a concept by its relative path; sync never asks git whether it changed`,
          );
        }
      } else if (!/^[a-z][a-z0-9+.-]*:/i.test(resource)) {
        const target = resolveBundleLink(resource, c.path);
        if (target !== null && !bundlePaths.has(target)) notes.push(`${at}: source ${resource} is not in the bundle`);
      }
    }
  }

  // --- the wiki's strict page set ---
  const wiki = wikiState(nd);
  if (wiki === 'partial') {
    for (const page of WIKI_PAGES) {
      if (!existsSync(join(bundle, WIKI_DIR, page.file))) {
        problems.push(`${where(`${WIKI_DIR}/${page.file}`)}: missing — the wiki is a strict page set (${WIKI_PAGES.map((p) => p.file).join(', ')})`);
      }
    }
  }

  // --- the derived indexes ---
  const indexes = derivedIndexes(nd, concepts);
  for (const [path, content] of indexes) {
    const file = join(bundle, path);
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
    // A CRLF checkout (core.autocrlf) keeps its line endings: an up-to-date index is not "out of date".
    const next = current?.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content;
    if (current !== next) fixes.push({ path: file, label: `${where(path)}: ${current === null ? 'missing' : 'out of date'}`, next });
  }
  for (const path of bundlePaths) {
    if (path.split('/').pop() === INDEX_FILE && !indexes.has(path)) {
      const text = readFileSync(join(bundle, path), 'utf8');
      if (text.includes(INDEX_NOTE)) {
        // novadev wrote it, and nothing is left for it to list: it goes.
        fixes.push({ path: join(bundle, path), label: `${where(path)}: lists concepts that are gone — sync removes it`, next: null });
        continue;
      }
      if (path === `${FEATURES_DIR}/${INDEX_FILE}` && linkTargets(text).length > 0) {
        problems.push(
          `${where(path)}: lists features, but the registry has none — delete it (the registry is missing) or leave only a "# Features" heading (the project has none yet)`,
        );
        continue;
      }
    }
    if (path.includes('/') && path.split('/').pop() === LOG_FILE) {
      for (const problem of conformanceProblems(path, readFileSync(join(bundle, path), 'utf8'))) problems.push(`${where(path)}: ${problem}`);
    }
    if (path.split('/').pop() !== INDEX_FILE || indexes.has(path)) continue;
    for (const problem of conformanceProblems(path, readFileSync(join(bundle, path), 'utf8'))) {
      problems.push(`${where(path)}: ${problem}`);
    }
  }

  // --- the log ---
  const log = readLog(nd);
  if (log === null) {
    problems.push(`${where(LOG_FILE)}: missing — the history of this knowledge; restore it from git (a new project gets one from \`novadev deploy\`)`);
  } else {
    if (splitFrontmatter(log.text) !== null) problems.push(`${where(LOG_FILE)}: a log file carries no frontmatter`);
    for (const problem of log.read.problems) problems.push(`${where(LOG_FILE)}: ${problem}`);
    const init = initializationDay(log.read);
    const mentions = newestMentions(log.read);
    for (const c of authored) {
      const changed = lastChangeDay(c);
      if (changed === null) continue;
      const mention = mentions.get(c.path) ?? null;
      const covered = mention !== null ? mention.date >= changed && mention.kind?.toLowerCase() !== 'removal' : init !== null && changed <= init;
      if (!covered) {
        problems.push(
          mention?.kind?.toLowerCase() === 'removal'
            ? `${where(c.path)}: the log says it was removed (${mention.date}) — record it again, event "create"`
            : `${where(c.path)}: changed on ${changed}, but ${LOG_FILE} has no entry for it since — ${LOG_HOW}`,
        );
      }
    }
    for (const [path, mention] of mentions) {
      if (isReserved(path) || bundlePaths.has(path)) continue;
      if (mention.kind?.toLowerCase() !== 'removal') {
        problems.push(
          `${where(path)}: gone, but the newest ${LOG_FILE} entry for it (${mention.date}, ${mention.kind ?? 'no kind'}) does not say so — ${removalAdvice(path)}`,
        );
      }
    }
  }

  // --- what is due: the wiki to build, stale concepts, code that moved on, changes nobody recorded ---
  if (wiki === 'missing') {
    actions.unshift('wiki is MISSING — build it before any todo work (loop phase 9, "Building the wiki")');
  }
  const stale = authored
    .filter((c) => c.status !== 'deprecated' && isStale(c.staleAfter, now))
    .sort((a, b) => byCodePoint(a.staleAfter!, b.staleAfter!) || byCodePoint(a.path, b.path));
  for (const c of stale.slice(0, STALE_SHOWN)) {
    actions.push(
      `${where(c.path)} is past its stale_after (${timestampDay(c.staleAfter!)}) — re-check it against the code, fix what moved, then record a "verify" event (\`novadev knowledge log\`)`,
    );
  }
  if (stale.length > STALE_SHOWN) {
    actions.push(`… and ${stale.length - STALE_SHOWN} more stale concept(s) — \`novadev knowledge --stale\` lists them all`);
  }
  const drifted = sourceDrift(root, authored, opts.sourceDays);
  for (const drift of drifted.slice(0, DRIFT_SHOWN)) {
    const [newest, ...more] = drift.sources;
    actions.push(
      `${where(drift.concept.path)}: its source ${newest!.resource} changed on ${newest!.day}${more.length > 0 ? ` (and ${plural(more.length, 'other source', 'other sources')} too)` : ''}, after the concept was last checked (${drift.checked}) — re-check it against the code, then record a "verify" if it still holds, or an "update" if it moved (\`novadev knowledge log\`)`,
    );
  }
  if (drifted.length > DRIFT_SHOWN) {
    actions.push(
      `… and ${drifted.length - DRIFT_SHOWN} more concept(s) whose sources changed after their last check — \`novadev knowledge --drifted\` lists them all`,
    );
  }
  actions.push(...unrecordedChanges(root, nd, log?.read ?? null));

  return { problems, notes, fixes, actions, concepts };
}

// ---------------------------------------------------------------------------
// Code that moved on after the concept describing it was last checked
// ---------------------------------------------------------------------------

/** A concept one of whose `repo:` sources has a commit dated after the concept was last checked. */
export type Drift = {
  concept: Concept;
  /** The day the concept was last written or verified (`lastChangeDay`). */
  checked: string;
  /** Each source that changed since, with the day of its newest commit — the newest first. */
  sources: Array<{ resource: string; day: string }>;
};

/** A `repo:` source as a path from the project root, or null when it names none (empty, or leaving the project with ".."). */
function repoPath(resource: string): string | null {
  const rel = resource.slice(5).replace(/^\.?\//, '');
  return rel === '' || rel.split('/').includes('..') ? null : rel;
}

/** True for a path inside `.novadev/`: novadev's own bookkeeping, which every round commits. */
function novadevOwn(rel: string): boolean {
  return rel.split('/')[0] === ROOT_DIR_NAME;
}

/**
 * The concepts whose code moved on: a `repo:` source with a commit on a day after the concept was
 * last written or verified. Whole days are compared, never moments: a round commits its code after it
 * records its knowledge, on the same day. The commit is asked of the git repository that holds the
 * path (`lastCommitDate`), once per path — `sourceDays` keeps the answers, so the audits of one run
 * can share them. A path that is gone is skipped (the audit says it is gone), and so is a path inside
 * `.novadev/` (the audit notes it: every round commits there, so it would never settle) and a
 * deprecated concept: it is kept for history, never re-checked. The newest change first.
 */
export function sourceDrift(root: string, concepts: readonly Concept[], sourceDays: Map<string, string | null> = new Map()): Drift[] {
  const cited = authoredConcepts(concepts).flatMap((concept) => {
    const checked = lastChangeDay(concept);
    if (checked === null || concept.status === 'deprecated') return [];
    const paths = concept.sources.flatMap((source) => {
      const rel = source.resource.startsWith('repo:') ? repoPath(source.resource) : null;
      return rel !== null && !novadevOwn(rel) && existsSync(join(root, rel)) ? [{ resource: source.resource, rel }] : [];
    });
    return paths.length > 0 ? [{ concept, checked, paths }] : [];
  });

  // Each path is asked about once, back to the earliest day any concept citing it was checked: an
  // older commit can make no concept drift. The search reaches back to midnight UTC of the day
  // before, so no offset can hide a commit of a later day, and a clock a little off costs nothing.
  const earliest = new Map<string, string>();
  for (const { checked, paths } of cited) {
    for (const { rel } of paths) {
      const day = earliest.get(rel);
      if (day === undefined || checked < day) earliest.set(rel, checked);
    }
  }
  const newestDay = new Map<string, string | null>();
  for (const [rel, day] of earliest) {
    const key = `${rel}\0${day}`;
    if (!sourceDays.has(key)) {
      const date = lastCommitDate(join(root, rel), `${addDays(day, -1)}T00:00:00Z`);
      sourceDays.set(key, date === null ? null : timestampDay(date));
    }
    newestDay.set(rel, sourceDays.get(key) ?? null);
  }

  const out: Drift[] = [];
  for (const { concept, checked, paths } of cited) {
    const sources = new Map<string, string>();
    for (const { resource, rel } of paths) {
      const day = newestDay.get(rel) ?? null;
      if (day !== null && day > checked && !sources.has(resource)) sources.set(resource, day);
    }
    if (sources.size === 0) continue;
    out.push({
      concept,
      checked,
      sources: [...sources]
        .map(([resource, day]) => ({ resource, day }))
        .sort((a, b) => byCodePoint(b.day, a.day) || byCodePoint(a.resource, b.resource)),
    });
  }
  return out.sort((a, b) => byCodePoint(b.sources[0]!.day, a.sources[0]!.day) || byCodePoint(a.concept.path, b.concept.path));
}

// ---------------------------------------------------------------------------
// Changes since the last commit that nobody recorded
// ---------------------------------------------------------------------------

/**
 * A concept's authored content: the frontmatter without the stamps `novadev knowledge log` writes
 * and without what sync derives, plus the body without its derived blocks. A change to anything
 * else is a change to the knowledge.
 */
export function authoredContent(text: string): string {
  // A CRLF checkout (core.autocrlf) is the same content as the LF blob git keeps.
  const read = readFrontmatterText(text.replace(/\r\n/g, '\n'));
  if (read.state !== 'ok') return text.replace(/\r\n/g, '\n');
  const data = { ...read.data };
  for (const key of STAMP_KEYS) delete data[key];
  if (Object.hasOwn(data, FEATURE_STATUS_KEY)) delete data.status;
  const body = read.body
    // The "## Budgets" heading sync adds with its block is sync's too.
    .replace(/^## Budgets[ \t]*\n+(?=<!-- novadev:budgets:begin -->)/m, '')
    .replace(/<!-- novadev:([a-z-]+):begin -->[\s\S]*?<!-- novadev:\1:end -->/g, '');
  return `${JSON.stringify(data, Object.keys(data).sort())}\n${body.trim()}`;
}

/** The keys `novadev knowledge log` writes: changed by hand, they would claim a check nobody made. */
const STAMP_KEYS = ['generated', 'verified', 'stale_after'] as const;

/** A concept's stamps as one comparable string. */
function stamps(data: Record<string, unknown>): string {
  return JSON.stringify(STAMP_KEYS.map((key) => (Object.hasOwn(data, key) ? data[key] : null)));
}

/** What to do about a concept that is gone without a log entry saying so. */
function removalAdvice(path: string): string {
  const role = roleOf(path).role;
  if (role === 'feature') {
    return `restore it from git — a feature is never removed: record a "deprecate" instead (\`novadev knowledge log\`)`;
  }
  if (role === 'wiki' && WIKI_PAGES.some((page) => `${WIKI_DIR}/${page.file}` === path)) {
    return "restore it from git — a page of the wiki's strict set is rewritten, never removed";
  }
  return 'record its removal (`novadev knowledge log`, event "remove")';
}

/** A link target as a path on disk: the fragment and the query dropped, each segment decoded. */
function decodeTarget(target: string): string {
  return target
    .split('#')[0]!
    .split('?')[0]!
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * The working tree against the last commit: a concept whose authored content changed while its
 * `generated` stamp did not, and a concept deleted without a "Removal" entry. NEXT ACTIONS only —
 * a hook or CI runs on a committed tree, where there is nothing to compare.
 */
function unrecordedChanges(root: string, nd: string, log: LogRead | null): string[] {
  if (git(root, ['rev-parse', '--verify', '-q', 'HEAD']) === null) return [];
  const prefix = `${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/`;
  // Paths relative to the project root, even when .novadev/ is not at the top of the repository.
  const diff = git(root, ['diff', 'HEAD', '--name-status', '-z', '--no-renames', '--relative', '--', prefix]);
  if (diff === null) return [];
  const mentions = log === null ? new Map<string, { date: string; kind: string | null }>() : newestMentions(log);
  // How many entries the log has about each concept now, and had at the last commit.
  const entriesNow = log === null ? new Map<string, number>() : entryCounts(log);
  const committedLog = git(root, ['show', `HEAD:./${prefix}${LOG_FILE}`]);
  const entriesThen = committedLog === null ? new Map<string, number>() : entryCounts(parseLog(committedLog));
  const out: string[] = [];
  const fields = diff.split('\0').filter((field) => field !== '');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const code = fields[i]!;
    const full = fields[i + 1]!;
    if (!full.startsWith(prefix)) continue;
    const path = full.slice(prefix.length);
    if (isReserved(path) || !path.toLowerCase().endsWith('.md') || roleOf(path).derived) continue;
    const file = join(knowledgeDir(nd), path);
    if (code.startsWith('D')) {
      if (!existsSync(file) && mentions.get(path)?.kind?.toLowerCase() !== 'removal') {
        out.push(`${where(path)} was deleted since the last commit — ${removalAdvice(path)}`);
      }
      continue;
    }
    if (!code.startsWith('M') || !existsSync(file) || !statSync(file).isFile()) continue;
    const before = git(root, ['show', `HEAD:./${full}`]);
    if (before === null) continue;
    const after = readFileSync(file, 'utf8');
    const stampBefore = readFrontmatterText(before);
    const stampAfter = readFrontmatterText(after);
    if (stampBefore.state !== 'ok' || stampAfter.state !== 'ok') continue;
    const sameStamp = JSON.stringify(stampBefore.data.generated ?? null) === JSON.stringify(stampAfter.data.generated ?? null);
    if (sameStamp && authoredContent(before) !== authoredContent(after)) {
      out.push(
        `${where(path)} changed since the last commit, but its "generated" stamp did not — record the change (\`novadev knowledge log\`, event "update"; by human:<id> when a person made it)`,
      );
    } else if (stamps(stampBefore.data) !== stamps(stampAfter.data) && (entriesNow.get(path) ?? 0) <= (entriesThen.get(path) ?? 0)) {
      // A stamp says who wrote or checked a concept; one written by hand claims a check nobody recorded.
      out.push(
        `${where(path)}: its stamps (generated, verified, stale_after) changed since the last commit with no new ${LOG_FILE} entry — only \`novadev knowledge log\` writes them: restore them from git, or record what really happened`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small reads other commands share
// ---------------------------------------------------------------------------

/** A one-line summary of the bundle for `novadev status`. */
export function knowledgeStatusLine(nd: string, now: Date = new Date()): string {
  if (!isDirectory(knowledgeDir(nd))) return `knowledge — MISSING (${AT}/ — run \`novadev deploy\`)`;
  const authored = authoredConcepts(listConcepts(nd));
  const count = (role: ConceptRole) => authored.filter((c) => c.role === role).length;
  const tiers = (['human-reviewed', 'machine-confirmed', 'unverified'] as const).map(
    (tier) => `${authored.filter((c) => c.tier === tier).length} ${tier}`,
  );
  const stale = authored.filter((c) => c.status !== 'deprecated' && isStale(c.staleAfter, now)).length;
  const wiki = wikiState(nd);
  return [
    `knowledge — ${plural(authored.length, 'concept', 'concepts')} (OKF ${OKF_VERSION}): ${count('wiki')} wiki page(s)${wiki === 'missing' ? ' — the wiki is MISSING' : ''}, ${count('memory')} memories, ${count('feature')} features`,
    `  trust: ${tiers.join(', ')} · ${stale} stale`,
  ].join('\n');
}

/** Whether a concept file is one `novadev knowledge log` may record events on: authored, not reserved. */
export function recordable(path: string): boolean {
  return !isReserved(path) && path.toLowerCase().endsWith('.md') && !roleOf(path).derived;
}

/** The role a bundle path would have — for commands that check a path before reading it. */
export function roleOfPath(path: string): ConceptRole {
  return roleOf(path).role;
}

/** The text of a concept's frontmatter body, for search. */
export function searchText(concept: Concept): string {
  return [concept.path, concept.type, concept.title, concept.description, concept.tags.join(' '), concept.body].join('\n').toLowerCase();
}

/** The concept's headline as commands print it. */
export function conceptLine(concept: Concept): string {
  return `[${concept.type || 'no type'}] ${concept.path} — ${oneLine(concept.title || '(no title)')}`;
}

