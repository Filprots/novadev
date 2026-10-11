// The 0.11.0 → 0.12.0 migration: `.novadev/wiki/`, `memories/` and `features/` become one Open
// Knowledge Format bundle, `.novadev/knowledge/`.
//
// What it does, folder by folder, before anything moves:
// - every page, memory and feature.md gets OKF frontmatter: a `type`, the `title` and a one-line
//   `description`, a `generated` stamp, and a `stale_after` from the review policy. The old INDEX.md
//   files were the only place a page's or a memory's one-liner was written, so that line becomes its
//   `description` — and the INDEX.md goes: novadev derives `index.md` from the descriptions now;
// - a memory's `kind` becomes its type (gotcha → Gotcha …), and its `verified:` day a `verified`
//   event; a feature's `status` becomes `feature-status` (OKF keeps `status` for the document's own
//   lifecycle) and its comma lists become YAML lists;
// - every relative link keeps pointing where it pointed: the files move one folder deeper.
//
// Who wrote the old content, and who re-checked it, was never recorded. The playbook had agents
// write all of it, so the stamps say `agent/unrecorded` — an agent, identity unknown — rather than
// inventing one. The day is the one the file gave (`updated:`, `verified:`), else the day git last
// changed it, else today.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  FEATURE_DIR_RE,
  FEATURE_STATUS_KEY,
  KNOWLEDGE_DIR,
  NOVADEV_VERSION,
  ROOT_DIR_NAME,
  csvList,
  isDirectory,
  isNovadevManaged,
  knowledgeDir,
  listDirs,
  listFiles,
  readManifest,
  todayStamp,
  writeManifest,
} from './lib.ts';
import {
  LOG_TITLE,
  MEMORY_TYPES,
  REVIEW_DAYS_DEFAULT,
  WIKI_PAGES,
  WIKI_PAGE_TYPE,
  featureLifecycle,
  parseKnowledgeSettings,
} from './knowledge.ts';
import {
  LOG_FILE,
  OKF_VERSION,
  addDaysToTimestamp,
  bundleMarkdownFiles,
  appendLogEntry,
  linkTargets,
  oneLine,
  splitFrontmatter,
  yamlFlowList,
  yamlFlowMap,
  yamlString,
} from './okf.ts';

import type { MigrationContext } from './migrations.ts';

/** Who wrote and checked the knowledge before 0.12.0: an agent, never named. */
export const LEGACY_ACTOR = 'agent/unrecorded';
const FOLDERS = ['wiki', 'memories', 'features'] as const;
type Folder = (typeof FOLDERS)[number];

export function migrateToKnowledgeBundle(ctx: MigrationContext): void {
  const { nd, dryRun } = ctx;
  const root = dirname(nd);
  const bundle = knowledgeDir(nd);
  if (existsSync(bundle) && !isDirectory(bundle)) {
    ctx.log(`SKIP — ${ROOT_DIR_NAME}/${KNOWLEDGE_DIR} is a file; from 0.12.0 the knowledge bundle is a folder of that name, so move the file away`);
    return;
  }
  const settings = parseKnowledgeSettings(readManifest(nd)?.knowledge);
  const reviewDays = settings.ok && readManifest(nd)?.knowledge !== undefined ? settings.value.reviewDays : REVIEW_DAYS_DEFAULT;
  const days = lastChangeDays(root, nd);
  const moving = FOLDERS.filter((folder) => {
    if (!isDirectory(join(nd, folder))) return false;
    if (existsSync(join(bundle, folder))) {
      ctx.log(`SKIP ${ROOT_DIR_NAME}/${folder}/ — ${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/${folder}/ already exists; merge the two by hand`);
      return false;
    }
    return true;
  });

  // 1. Convert in place, while every link still resolves from the old place. Every markdown file of
  // the three folders is re-linked — a note in a feature folder, a page in a wiki subfolder — and the
  // pages, memories and feature.md files are converted too.
  let converted = 0;
  const unconverted: string[] = [];
  for (const folder of moving) {
    const dir = join(nd, folder);
    const descriptions = indexDescriptions(dir);
    const summary = folder === 'wiki' ? indexSummary(dir) : '';
    const concepts = new Set(conceptFiles(dir, folder));
    for (const file of bundleMarkdownFiles(dir)) {
      if (file === 'INDEX.md') continue; // it goes, below
      const oldPath = join(dir, file);
      const newPath = join(bundle, folder, file);
      const original = readFileSync(oldPath, 'utf8');
      let text = original;
      if (concepts.has(file)) {
        const day = (key: string | undefined) => (key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : undefined);
        const result = convert(folder, file, text, {
          description: descriptions.get(file.split('/').pop()!),
          day,
          gitDay: days.get(relative(root, oldPath).replace(/\\/g, '/')),
          today: todayStamp(),
          reviewDays: reviewDays[folder] ?? null,
        });
        if (result.missing.length > 0) unconverted.push(`${folder}/${file} (${result.missing.join(', ')})`);
        text = result.text;
        converted++;
        if (folder === 'wiki' && file === 'overview.md' && summary !== '') {
          const carried = withSummary(text, summary);
          if (carried !== text) {
            ctx.log('carry the summary at the top of wiki/INDEX.md into wiki/overview.md, under its title — the load-first map is derived now, and holds no prose');
            text = carried;
          }
        }
      }
      const next = relinked(text, oldPath, newPath, nd);
      if (!dryRun && next !== original) writeFileSync(oldPath, next);
    }
  }
  if (converted > 0) {
    ctx.log(`give ${converted} page(s), memories and features Open Knowledge Format frontmatter (type, title, description, generated, stale_after)`);
  }
  if (unconverted.length > 0) {
    ctx.log(
      `NOTE ${unconverted.length} file(s) still need a line the old files never had — \`novadev sync\` lists each one: ${unconverted.slice(0, 5).join('; ')}${unconverted.length > 5 ? '; …' : ''}`,
    );
  }

  // 2. The old indexes and novadev's own READMEs go: index.md is derived now, and a README is not a concept.
  for (const folder of moving) {
    const dir = join(nd, folder);
    const index = join(dir, 'INDEX.md');
    if (existsSync(index)) {
      ctx.log(`delete ${ROOT_DIR_NAME}/${folder}/INDEX.md — its one-liners are the descriptions now; \`novadev sync\` derives ${folder}/index.md`);
      if (!dryRun) rmSync(index);
    }
    const readme = join(dir, 'README.md');
    if (existsSync(readme)) {
      if (isNovadevManaged(readme)) {
        ctx.log(`delete ${ROOT_DIR_NAME}/${folder}/README.md — novadev's guide moves into ${ROOT_DIR_NAME}/README.md; the bundle holds only knowledge`);
        if (!dryRun) rmSync(readme);
      } else {
        ctx.log(`NOTE ${ROOT_DIR_NAME}/${folder}/README.md is the project's own — inside the bundle it must become a concept (give it frontmatter) or move out`);
      }
    }
  }

  // 3. Move.
  for (const folder of moving) {
    ctx.log(`move ${ROOT_DIR_NAME}/${folder}/ → ${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/${folder}/`);
    if (dryRun) continue;
    mkdirSync(bundle, { recursive: true });
    renameSync(join(nd, folder), join(bundle, folder));
  }

  // 4. The log, and the review policy.
  const logPath = join(bundle, LOG_FILE);
  if (!existsSync(logPath)) {
    ctx.log(`write ${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/${LOG_FILE} — its first entry says the bundle started today`);
    if (!dryRun) {
      mkdirSync(bundle, { recursive: true });
      writeFileSync(
        logPath,
        appendLogEntry(
          '',
          todayStamp(),
          `**Initialization**: novadev ${NOVADEV_VERSION} made this folder the project's knowledge bundle (Open Knowledge Format ${OKF_VERSION}): the wiki, the memories and the features moved in from ${ROOT_DIR_NAME}/, with their frontmatter converted. Who wrote and checked them before was not recorded (${LEGACY_ACTOR}).`,
          LOG_TITLE,
        ),
      );
    }
  }
  const manifest = readManifest(nd);
  if (manifest !== null && !('knowledge' in manifest)) {
    ctx.log(
      `add "knowledge": { "reviewDays": ${JSON.stringify(REVIEW_DAYS_DEFAULT)} } to novadev.json — how many days a concept stays fresh before \`novadev sync\` asks for a re-check`,
    );
    if (!dryRun) writeManifest(nd, { ...manifest, knowledge: { reviewDays: { ...REVIEW_DAYS_DEFAULT } } });
  }
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const outside = readFileSync(path, 'utf8').replace(/<!-- novadev:begin -->[\s\S]*?<!-- novadev:end -->/g, '');
    if (/\.novadev\/(wiki|memories|features)\b/.test(outside)) {
      ctx.log(`NOTE ${file} names .novadev/wiki|memories|features outside novadev's section — those are .novadev/knowledge/… now; update them by hand`);
    }
  }
  if (moving.length > 0) ctx.log('then `novadev sync` writes the bundle\'s index.md files and the features\' derived histories');
}

/** The concept files of a legacy folder, as paths inside it: wiki pages, memories, each feature.md. */
function conceptFiles(dir: string, folder: Folder): string[] {
  if (folder === 'features') {
    return listDirs(dir)
      .filter((f) => FEATURE_DIR_RE.test(f) && existsSync(join(dir, f, 'feature.md')))
      .map((f) => `${f}/feature.md`);
  }
  return listFiles(dir).filter((f) => f.endsWith('.md') && f !== 'INDEX.md' && f !== 'README.md');
}

/**
 * The one-liner an old INDEX.md gave each file, by file name: the text after its link on a list
 * line (`- [title](file.md) — when it applies`), or the next cell of a table row
 * (`| [file.md](file.md) | one-liner |`).
 */
export function indexDescriptions(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const index = join(dir, 'INDEX.md');
  if (!existsSync(index)) return out;
  for (const line of readFileSync(index, 'utf8').split(/\r?\n/)) {
    const target = linkTargets(line).find((t) => /^(?:\.\/)?[^/:#]+\.md$/.test(t.split('#')[0]!));
    if (target === undefined) continue;
    const file = target.split('#')[0]!.replace(/^\.\//, '');
    if (file === 'INDEX.md' || out.has(file)) continue;
    let rest: string;
    if (line.trim().startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim());
      const at = cells.findIndex((c) => c.includes(`](${target})`));
      rest = cells.slice(at + 1).find((c) => c !== '') ?? '';
    } else {
      const end = line.indexOf(`](${target})`);
      rest = line.slice(end + target.length + 3);
    }
    // What follows the link, without the punctuation that joined them: "): …", " — …", " | …".
    const description = oneLine(rest.replace(/^[\s)\]*_—–:|-]+/, '').replace(/[\s|]+$/, ''));
    if (description !== '') out.set(file, description);
  }
  return out;
}

/**
 * The prose an old wiki INDEX.md opened with — its 1–3 sentence summary of the project, between the
 * title and the page list — or ''.
 */
export function indexSummary(dir: string): string {
  const index = join(dir, 'INDEX.md');
  if (!existsSync(index)) return '';
  const text = readFileSync(index, 'utf8');
  const body = splitFrontmatter(text)?.body ?? text;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#\s/.test(line));
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:[|*#>-]|\d+\.\s)/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/** A page with `summary` under its title — unless the page already says it. */
function withSummary(text: string, summary: string): string {
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim();
  if (flat(text).includes(flat(summary))) return text;
  const split = splitFrontmatter(text);
  const head = split === null ? '' : text.slice(0, text.length - split.body.length);
  const body = split === null ? text : split.body;
  const lines = body.split('\n');
  const title = lines.findIndex((line) => /^#\s/.test(line));
  if (title === -1) return `${head}\n${summary}\n${body}`;
  lines.splice(title + 1, 0, '', summary);
  return head + lines.join('\n');
}

/**
 * An old novadev header: flat `key: value` lines, read the way 0.11.0 read them — and, kept as they
 * were written, the indented lines under a key (a nested value 0.11.0 never read, like a memory in
 * another tool's format carrying `metadata:` with `type: reference` under it). Nothing is lost.
 */
function legacyHeader(text: string): { keys: [string, string][]; nested: Map<string, string[]>; body: string } {
  const split = splitFrontmatter(text);
  const nested = new Map<string, string[]>();
  if (split === null) return { keys: [], nested, body: text };
  const keys: [string, string][] = [];
  let last: string | null = null;
  for (const line of split.header.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      keys.push([m[1]!, m[2]!.trim()]);
      last = m[1]!;
    } else if (last !== null && /^(?:[ \t]+\S|- )/.test(line)) {
      nested.set(last, [...(nested.get(last) ?? []), line]);
    }
  }
  return { keys, nested, body: split.body };
}

const midnight = (day: string) => `${day}T00:00:00Z`;

/** The first sentence of a markdown section's first paragraph, as plain text — or ''. */
function firstSentence(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\b`, 'i').test(l));
  if (start === -1) return '';
  const paragraph: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim() === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  const text = oneLine(paragraph.join(' '))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
  if (text === '' || /^<[^>]*>$/.test(text)) return '';
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text;
  return sentence.length > 240 ? `${sentence.slice(0, 237).trimEnd()}…` : sentence;
}

function titleFromBody(body: string): string {
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return heading ? heading.replace(/\s+—.*$/, '').trim() : '';
}

function titleFromFile(file: string): string {
  const base = file.split('/').pop()!.replace(/\.md$/, '').replace(/[-_]+/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * One file's new text: OKF frontmatter in a fixed order, then the body as it was (a feature's old
 * pointer comment becomes links to its histories). `missing` names what could not be filled in.
 */
export function convert(
  folder: Folder,
  file: string,
  text: string,
  o: {
    description?: string;
    day: (value: string | undefined) => string | undefined;
    /** The day git last changed the file — undefined outside git. */
    gitDay: string | undefined;
    today: string;
    reviewDays: number | null;
  },
): { text: string; missing: string[] } {
  const { keys, nested, body } = legacyHeader(text);
  const old = new Map(keys);
  const missing: string[] = [];
  const lines: string[] = [];
  const put = (key: string, value: string) => lines.push(value === '' ? `${key}:` : `${key}: ${value}`);
  const consumed = new Set<string>();
  const take = (key: string) => {
    consumed.add(key);
    return old.get(key);
  };
  const stale = (at: string) => (o.reviewDays === null ? null : addDaysToTimestamp(at, o.reviewDays));

  if (folder === 'wiki') {
    const page = WIKI_PAGES.find((p) => p.file === file);
    const title = take('title') || titleFromBody(body) || page?.title || titleFromFile(file);
    const description = take('description') || o.description || page?.about || '';
    const at = midnight(o.day(take('updated')) ?? o.gitDay ?? o.today);
    put('type', yamlString(take('type') || WIKI_PAGE_TYPE));
    put('title', yamlString(title));
    if (description) put('description', yamlString(oneLine(description)));
    else missing.push('description');
    put('generated', yamlFlowMap([['by', LEGACY_ACTOR], ['at', at]]));
    const until = stale(at);
    if (until) put('stale_after', until);
  } else if (folder === 'memories') {
    const kind = (take('kind') ?? '').toLowerCase();
    // "trap" is the playbook's own word for a gotcha ("a trap in the stack"); every other kind outside
    // the four is a judgement, so it is left for an agent who reads the memory.
    const type = MEMORY_TYPES.find((t) => t.toLowerCase() === (kind === 'trap' ? 'gotcha' : kind));
    const created = o.day(take('created'));
    const verifiedDay = o.day(take('verified'));
    const title = take('title') || titleFromBody(body) || titleFromFile(file);
    const description = take('description') || o.description || '';
    if (type) put('type', type);
    else {
      missing.push(`type (its kind was "${kind || 'none'}")`);
      if (kind) put('kind', yamlString(kind));
    }
    put('title', yamlString(title));
    if (description) put('description', yamlString(oneLine(description)));
    else missing.push('description');
    if (created) put('created', created);
    // The content last changed when git last changed the file (outside git: the latest day the
    // memory names) — never before it was created.
    const named = [created, verifiedDay].filter((d): d is string => d !== undefined).sort().at(-1);
    const last = o.gitDay ?? named ?? o.today;
    const at = midnight(created !== undefined && created > last ? created : last);
    put('generated', yamlFlowMap([['by', LEGACY_ACTOR], ['at', at]]));
    if (verifiedDay) put('verified', yamlFlowMap([['by', LEGACY_ACTOR], ['at', midnight(verifiedDay)]]));
    const freshFrom = [at, verifiedDay ? midnight(verifiedDay) : at].sort().at(-1)!;
    const until = stale(freshFrom);
    if (until) put('stale_after', until);
  } else {
    const status = take('status') ?? '';
    const description = take('description') || firstSentence(body, 'What it does');
    const text = (key: string) => {
      const value = take(key) ?? '';
      return value === '' ? '' : yamlString(value);
    };
    put('type', 'Feature');
    put('id', text('id'));
    put('title', text('title'));
    if (description) put('description', yamlString(description));
    else missing.push('description');
    put(FEATURE_STATUS_KEY, status);
    const lifecycle = featureLifecycle(status);
    if (lifecycle) put('status', lifecycle);
    put('area', text('area'));
    put('created', text('created'));
    for (const key of ['tags', 'touches', 'depends-on', 'supersedes', 'superseded-by', 'conflicts-with']) {
      put(key, yamlFlowList(csvList(take(key))));
    }
    const at = midnight(o.day(take('updated')) ?? o.gitDay ?? o.today);
    put('generated', yamlFlowMap([['by', LEGACY_ACTOR], ['at', at]]));
    const until = stale(at);
    if (until) put('stale_after', until);
  }
  for (const [key, value] of keys) {
    if (consumed.has(key) || ['updated', 'kind', 'verified'].includes(key)) continue;
    const under = nested.get(key) ?? [];
    // OKF's `tags` is a YAML list; a page or a memory that kept its own comma list gets one.
    if (key === 'tags' && under.length === 0) lines.push(`tags: ${yamlFlowList(csvList(value.replace(/^\[|\]$/g, '')))}`);
    // A nested value is YAML already: it is carried exactly as it was written.
    else if (under.length > 0) lines.push(value === '' ? `${key}:` : `${key}: ${value}`, ...under);
    else lines.push(`${key}: ${value === '' ? '' : yamlString(value)}`.trimEnd());
  }
  let nextBody = body;
  if (folder === 'features') {
    nextBody = body.replace(
      /<!--\s*The work that built this feature and the human test rounds that verified it are\s+DERIVED, in work\.md and tests\.md beside this file\.\s+Regenerate them with `novadev links --fix`\.\s*-->\s*$/,
      'The work that built it and the human test rounds that checked it: [work.md](work.md) ·\n[tests.md](tests.md) — both derived by `novadev sync`.\n',
    );
  }
  return { text: `---\n${lines.join('\n')}\n---\n${nextBody.replace(/^(\r?\n)*/, '\n')}`, missing };
}

/**
 * The text with every relative link re-aimed from the file's new place, so it still reaches what it
 * reached before — and old INDEX.md links aimed at the derived index.md. Links inside the three
 * folders move with them and stay as they are; links leaving them (a todo, the project's code) get
 * one more `../`. A link that reached nothing before is left alone. Text mentions of the old folders
 * (`.novadev/wiki/…`) are renamed too.
 */
export function relinked(text: string, oldPath: string, newPath: string, nd: string): string {
  const legacy = (abs: string) => FOLDERS.some((f) => abs === join(nd, f) || abs.startsWith(join(nd, f) + '/'));
  /** One link target, aimed from the new place; unchanged when it is no relative path or reached nothing. */
  const reaim = (raw: string): string => {
    const target = raw.replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return raw;
    const [pathPart, ...hash] = target.split('#');
    if (!pathPart) return raw;
    const oldAbs = resolve(dirname(oldPath), pathPart);
    let aimed = oldAbs;
    if (oldAbs.endsWith('/INDEX.md') && legacy(oldAbs)) {
      aimed = oldAbs.slice(0, -'INDEX.md'.length) + 'index.md';
    } else if (!existsSync(oldAbs)) {
      return raw;
    }
    const newAbs = legacy(aimed) ? join(knowledgeDir(nd), relative(nd, aimed)) : aimed;
    let next = relative(dirname(newPath), newAbs).replace(/\\/g, '/');
    if (aimed === join(nd, 'wiki', 'index.md')) next = relative(dirname(newPath), join(knowledgeDir(nd), 'index.md')).replace(/\\/g, '/');
    if (next === '') next = '.';
    const rebuilt = [next, ...hash].join('#');
    return raw.startsWith('<') ? `<${rebuilt}>` : rebuilt;
  };
  let out = text
    // Inline links and images: [text](target), ![alt](target).
    .replace(/(\[(?:[^\]\\\n]|\\.)*\]\(\s*)(<[^>\n]*>|[^)\s]+)/g, (_match, head: string, raw: string) => `${head}${reaim(raw)}`)
    // Reference-style definitions: [label]: target.
    .replace(/^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm, (_match, head: string, raw: string) => `${head}${reaim(raw)}`);
  out = out
    .replaceAll(`${ROOT_DIR_NAME}/wiki/INDEX.md`, `${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/index.md`)
    .replaceAll(`${ROOT_DIR_NAME}/memories/INDEX.md`, `${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/memories/index.md`)
    .replaceAll(`${ROOT_DIR_NAME}/features/INDEX.md`, `${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/features/index.md`);
  for (const folder of FOLDERS) out = out.replaceAll(`${ROOT_DIR_NAME}/${folder}/`, `${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/${folder}/`);
  return out;
}

/** The day git last changed each file under the three folders, by path from the project root. */
function lastChangeDays(root: string, nd: string): Map<string, string> {
  const out = new Map<string, string>();
  let log: string;
  try {
    // Paths come back relative to the project root (`--relative`), unquoted even when they hold
    // accents (`core.quotePath=false`) — the keys the caller looks them up by.
    log = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'log', '--format=%x00%cs', '--name-only', '--relative', '--', ...FOLDERS.map((f) => relative(root, join(nd, f)))],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 },
    );
  } catch {
    return out;
  }
  for (const block of log.split('\0')) {
    const [day, ...files] = block.split('\n');
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.trim())) continue;
    for (const file of files) {
      const path = file.trim();
      if (path !== '' && !out.has(path)) out.set(path, day.trim());
    }
  }
  return out;
}
