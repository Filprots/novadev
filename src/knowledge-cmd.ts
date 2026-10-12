// `novadev knowledge` — the project's knowledge bundle, `.novadev/knowledge/` (Open Knowledge Format).
//
//   novadev knowledge                      what the bundle holds: concepts by type, trust, what is stale
//   novadev knowledge <words…>             search it: path, type, title, description, tags, body
//       --type <type>   --tag <tag>   --stale   --drifted   --tier unverified|machine-confirmed|human-reviewed
//       (--drifted: the concepts whose `repo:` sources changed after they were last checked)
//   novadev knowledge log <payload.json>   record changes — each concept's stamps AND its log.md entry
//
// The payload is a JSON FILE — `{ "events": [ { path, event, by, note, ref? } ] }` — because a note is
// prose an agent writes, and quoting prose through a shell is how it gets mangled (a backtick runs a
// command). `log` answers in JSON on stdout, and errors as `{ "error": … }` with a non-zero exit, so the
// agent reads the outcome instead of guessing from prose.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  KNOWLEDGE_DIR,
  ROOT_DIR_NAME,
  byCodePoint,
  fail,
  isDirectory,
  knowledgeDir,
  novadevDir,
  requireProjectRoot,
} from './lib.ts';
import {
  type Concept,
  FEATURE_TYPE,
  MEMORY_TYPES,
  WIKI_PAGE_TYPE,
  authoredConcepts,
  conceptLine,
  listConcepts,
  readLog,
  searchText,
  sourceDrift,
  wikiState,
} from './knowledge.ts';
import { parseEvents, recordEvents } from './knowledge-log.ts';
import { OKF_VERSION, TRUST_TIERS, type TrustTier, isStale, oneLine, timestampDay } from './okf.ts';

const USAGE =
  'usage: novadev knowledge [words…] [--type <type>] [--tag <tag>] [--stale] [--drifted] [--tier unverified|machine-confirmed|human-reviewed]\n' +
  '       novadev knowledge log <payload.json>';

const TIER_MARK: Record<TrustTier, string> = { 'human-reviewed': '✓✓', 'machine-confirmed': '✓', unverified: '·' };

export function knowledge(args: string[]): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);
  if (args[0] === 'log') {
    logCommand(root, nd, args.slice(1));
    return;
  }
  if (!isDirectory(knowledgeDir(nd))) {
    fail(`${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/ is missing — run \`novadev deploy\` (or \`novadev migrate-repo\` on a repo from before 0.12.0)`);
  }
  const opts = parseArgs(args);
  const now = new Date();
  const all = authoredConcepts(listConcepts(nd));
  const filtered =
    opts.query !== undefined || opts.type !== undefined || opts.tag !== undefined || opts.stale || opts.drifted || opts.tier !== undefined;
  if (!filtered) {
    overview(root, nd, all, now);
    return;
  }
  let hits = all;
  if (opts.type) hits = hits.filter((c) => c.type.toLowerCase() === opts.type!.toLowerCase());
  if (opts.tag) hits = hits.filter((c) => c.tags.some((t) => t.toLowerCase() === opts.tag!.toLowerCase()));
  if (opts.tier) hits = hits.filter((c) => c.tier === opts.tier);
  if (opts.stale) hits = hits.filter((c) => c.status !== 'deprecated' && isStale(c.staleAfter, now));
  const drifts = opts.drifted ? new Map(sourceDrift(root, all).map((drift) => [drift.concept.path, drift])) : null;
  if (drifts !== null) hits = hits.filter((c) => drifts.has(c.path));
  if (opts.query) {
    const words = opts.query.toLowerCase().split(/\s+/).filter(Boolean);
    hits = hits.filter((c) => {
      const text = searchText(c);
      return words.every((word) => text.includes(word));
    });
  }
  const what = [
    opts.query ? `"${opts.query}"` : '',
    opts.type ? `type=${opts.type}` : '',
    opts.tag ? `tag=${opts.tag}` : '',
    opts.tier ? `tier=${opts.tier}` : '',
    opts.stale ? 'stale' : '',
    opts.drifted ? 'drifted' : '',
  ].filter(Boolean);
  console.log(`knowledge — ${hits.length} of ${all.length} match (${what.join(', ')})`);
  if (hits.length === 0) {
    console.log('  (nothing in the bundle matches)');
    return;
  }
  // Drifted concepts in the order sync lists them: the newest change first.
  const order = drifts === null ? [] : [...drifts.keys()];
  const sorted = opts.stale
    ? [...hits].sort((a, b) => byCodePoint(a.staleAfter!, b.staleAfter!))
    : drifts !== null
      ? [...hits].sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path))
      : hits;
  for (const c of sorted) {
    print(c, now);
    const drift = drifts?.get(c.path);
    for (const source of drift?.sources ?? []) {
      console.log(`      source ${source.resource} changed on ${source.day}, after its last check on ${drift!.checked}`);
    }
  }
}

function print(c: Concept, now: Date): void {
  console.log(`  ${TIER_MARK[c.tier]} ${conceptLine(c)}`);
  if (c.description) console.log(`      ${oneLine(c.description)}`);
  const meta = [
    c.tier,
    c.status !== 'stable' ? c.status : '',
    c.staleAfter ? `${isStale(c.staleAfter, now) ? 'STALE since' : 'fresh until'} ${timestampDay(c.staleAfter)}` : '',
    c.tags.length ? `tags: ${c.tags.join(', ')}` : '',
  ].filter(Boolean);
  console.log(`      ${meta.join(' · ')}`);
}

function overview(root: string, nd: string, all: Concept[], now: Date): void {
  const derived = listConcepts(nd).length - all.length;
  console.log(
    `knowledge — ${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/ is an Open Knowledge Format ${OKF_VERSION} bundle: ${all.length} concept(s)${derived > 0 ? ` (+${derived} derived histories)` : ''}`,
  );
  const byType = new Map<string, number>();
  for (const c of all) byType.set(c.type || '(no type)', (byType.get(c.type || '(no type)') ?? 0) + 1);
  if (byType.size > 0) {
    // novadev's own types in the order the playbook names them, then the project's own, by name.
    const order: string[] = [WIKI_PAGE_TYPE, ...MEMORY_TYPES, FEATURE_TYPE];
    const rank = (type: string) => (order.includes(type) ? order.indexOf(type) : order.length);
    const types = [...byType].sort(([a], [b]) => rank(a) - rank(b) || byCodePoint(a, b));
    console.log(`  by type: ${types.map(([type, n]) => `${type} ${n}`).join(' · ')}`);
  }
  console.log(`  trust:   ${TRUST_TIERS.slice().reverse().map((tier) => `${all.filter((c) => c.tier === tier).length} ${tier}`).join(' · ')}`);
  const stale = all.filter((c) => c.status !== 'deprecated' && isStale(c.staleAfter, now));
  console.log(`  stale:   ${stale.length} past stale_after${stale.length > 0 ? ' — `novadev knowledge --stale`' : ''}`);
  // Only a bundle that cites code can drift; one that cites none asks git nothing.
  if (all.some((c) => c.sources.some((source) => source.resource.startsWith('repo:')))) {
    const drifted = sourceDrift(root, all).length;
    console.log(`  drifted: ${drifted} whose code changed after their last check${drifted > 0 ? ' — `novadev knowledge --drifted`' : ''}`);
  }
  const log = readLog(nd);
  if (log === null) console.log('  log:     MISSING — restore log.md from git');
  else console.log(`  log:     ${log.read.entries.length} entr${log.read.entries.length === 1 ? 'y' : 'ies'}${log.read.sections[0] ? `, the newest on ${log.read.sections[0].date}` : ''}`);
  if (wikiState(nd) === 'missing') console.log('  wiki:    MISSING — an agent builds it first (skills/novadev-work.md, "Building the wiki")');
  console.log(`  load first: ${ROOT_DIR_NAME}/${KNOWLEDGE_DIR}/index.md`);
}

type Options = { query?: string; type?: string; tag?: string; stale?: boolean; drifted?: boolean; tier?: TrustTier };

function parseArgs(args: string[]): Options {
  const opts: Options = {};
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = () => {
      const v = args[++i];
      if (v === undefined) fail(`${a} needs a value\n${USAGE}`);
      return v!;
    };
    switch (a) {
      case '--type':
        opts.type = value();
        break;
      case '--tag':
        opts.tag = value();
        break;
      case '--stale':
        opts.stale = true;
        break;
      case '--drifted':
        opts.drifted = true;
        break;
      case '--tier': {
        const tier = value();
        if (!(TRUST_TIERS as readonly string[]).includes(tier)) fail(`unknown tier "${tier}" — one of: ${TRUST_TIERS.join(', ')}`);
        opts.tier = tier as TrustTier;
        break;
      }
      default:
        if (a.startsWith('--')) fail(`unknown option "${a}"\n${USAGE}`);
        words.push(a);
    }
  }
  if (words.length > 0) opts.query = words.join(' ');
  return opts;
}

function logCommand(root: string, nd: string, args: string[]): void {
  try {
    const [argument, ...rest] = args;
    if (argument === undefined || rest.length > 0) throw new Error(USAGE);
    const path = isAbsolute(argument) ? argument : resolve(process.cwd(), argument);
    if (!existsSync(path)) throw new Error(`No payload file at ${path}.`);
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`The payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const events = parseEvents(root, nd, payload);
    const recorded = recordEvents(root, nd, events);
    console.log(
      JSON.stringify(
        {
          recorded,
          log: join(ROOT_DIR_NAME, KNOWLEDGE_DIR, 'log.md'),
          next: 'run `novadev sync` — it rewrites the indexes and checks the bundle',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}
