// `novadev features` — search the feature registry; `--new` scaffolds an entry.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FEATURE_DOC,
  FEATURE_STATUSES,
  FEATURE_TESTS,
  FEATURE_WORK,
  type Feature,
  fail,
  featuresDir,
  listFeatures,
  nextFeatureId,
  novadevDir,
  pathsOverlap,
  requireProjectRoot,
  todayStamp,
} from './lib.ts';

const STATUS_MARK: Record<string, string> = {
  planned: '○',
  'in-progress': '◐',
  shipped: '●',
  deprecated: '⊘',
};

export function features(args: string[]): void {
  const root = requireProjectRoot();
  const nd = novadevDir(root);

  const opts = parseArgs(args);
  if (opts.new) {
    scaffold(nd, opts);
    return;
  }

  const all = listFeatures(nd);
  if (all.length === 0) {
    console.log(
      existsSync(join(featuresDir(nd), 'INDEX.md'))
        ? 'features — registry is empty.'
        : 'features — registry MISSING. An agent must create it: skills/novadev.md (phase 9)',
    );
    return;
  }

  let hits = all;
  if (opts.status) {
    hits = hits.filter((f) => f.status === opts.status);
  }
  if (opts.area) {
    hits = hits.filter((f) => f.area.toLowerCase() === opts.area!.toLowerCase());
  }
  if (opts.touching) {
    hits = hits.filter((f) => f.touches.some((t) => pathsOverlap(t, opts.touching!)));
  }
  if (opts.query) {
    const q = opts.query.toLowerCase();
    hits = hits.filter((f) => haystack(f).includes(q));
  }

  const filtered = opts.status || opts.area || opts.touching || opts.query;
  console.log(
    filtered
      ? `features — ${hits.length} of ${all.length} match${describe(opts)}`
      : `features — ${all.length} entr${all.length === 1 ? 'y' : 'ies'}`,
  );
  if (hits.length === 0) {
    console.log('  (no match — nothing in the registry covers this yet)');
    return;
  }

  for (const f of hits) print(f, opts);

  if (opts.touching) {
    console.log(
      `\nThese features already claim code overlapping "${opts.touching}" — read them before` +
        '\nchanging that surface (skills/feature-check.md).',
    );
  }
}

function haystack(f: Feature): string {
  return [f.id, f.title, f.area, f.tags.join(' '), f.touches.join(' '), f.text]
    .join('\n')
    .toLowerCase();
}

function describe(opts: Options): string {
  const parts = [
    opts.query ? `"${opts.query}"` : '',
    opts.status ? `status=${opts.status}` : '',
    opts.area ? `area=${opts.area}` : '',
    opts.touching ? `touching=${opts.touching}` : '',
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function print(f: Feature, opts: Options): void {
  const mark = STATUS_MARK[f.status] ?? '?';
  console.log(`  ${mark} ${f.id}  [${f.status || 'no-status'}]  ${f.area || '—'}  ${f.title}`);
  if (f.tags.length) console.log(`      tags: ${f.tags.join(', ')}`);
  if (f.touches.length) {
    const marked = f.touches.map((t) =>
      opts.touching && pathsOverlap(t, opts.touching) ? `${t}  ← overlap` : t,
    );
    console.log(`      touches: ${marked.join(', ')}`);
  }
  for (const [key, ids] of Object.entries(f.refs)) {
    if (ids.length) console.log(`      ${key}: ${ids.join(', ')}`);
  }
  console.log(`      folder: ${f.file}/`);
}

type Options = {
  query?: string;
  status?: string;
  area?: string;
  touching?: string;
  new?: string;
  title?: string;
  tags?: string;
  touches?: string;
};

function parseArgs(args: string[]): Options {
  const opts: Options = {};
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => {
      const v = args[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--status':
        opts.status = value();
        if (!(FEATURE_STATUSES as readonly string[]).includes(opts.status)) {
          fail(`unknown status "${opts.status}" — one of: ${FEATURE_STATUSES.join(', ')}`);
        }
        break;
      case '--area':
        opts.area = value();
        break;
      case '--touching':
        opts.touching = value();
        break;
      case '--new':
        opts.new = value();
        break;
      case '--title':
        opts.title = value();
        break;
      case '--tags':
        opts.tags = value();
        break;
      case '--touches':
        opts.touches = value();
        break;
      default:
        if (a.startsWith('--')) fail(`unknown option "${a}"`);
        words.push(a);
    }
  }
  if (words.length) opts.query = words.join(' ');
  return opts;
}

function scaffold(nd: string, opts: Options): void {
  const slug = opts.new!.replace(/^FEAT-\d{4}-/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    fail(`feature slug "${slug}" must be lowercase kebab-case`);
  }
  const dir = featuresDir(nd);
  mkdirSync(dir, { recursive: true });

  const id = nextFeatureId(nd);
  const title = opts.title ?? slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const today = todayStamp();
  const folder = `${id}-${slug}`;
  const featureDir = join(dir, folder);
  if (existsSync(featureDir)) fail(`features/${folder}/ already exists`);

  mkdirSync(featureDir, { recursive: true });
  writeFileSync(
    join(featureDir, FEATURE_DOC),
    featureSkeleton({ id, title, today, tags: opts.tags, touches: opts.touches }),
  );
  console.log(`created features/${folder}/${FEATURE_DOC}`);
  console.log(
    `  fill in area/tags/touches + the body, then \`novadev links --fix\` generates\n` +
      `  features/${folder}/{${FEATURE_WORK},${FEATURE_TESTS}} and the index.`,
  );
}

/** The canonical feature file. Kept here so the CLI and the playbooks cannot drift. */
export function featureSkeleton(o: {
  id: string;
  title: string;
  today: string;
  area?: string;
  tags?: string;
  touches?: string;
}): string {
  return `---
id: ${o.id}
title: ${o.title}
status: planned
area: ${o.area ?? ''}
created: ${o.today}
updated: ${o.today}
tags: ${o.tags ?? ''}
touches: ${o.touches ?? ''}
depends-on:
supersedes:
superseded-by:
conflicts-with:
---

# ${o.id} — ${o.title}

## What it does

<the user-visible behaviour: what someone can do now that they could not before>

## How it works

<design, key modules/files, data flow, integration points>

## Progress

- ${o.today} — planned

## Open questions

<what is undecided or unverified — delete the section when empty>

<!-- The work that built this feature and the human test rounds that verified it are
     DERIVED, in ${FEATURE_WORK} and ${FEATURE_TESTS} beside this file.
     Regenerate them with \`novadev links --fix\`. -->
`;
}
