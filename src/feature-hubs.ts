// `novadev features --hubs` — which features lean on a hub.
//
// For each hub path (hubs.ts: the stored metrics snapshot's, or else the "hubs" list in
// novadev.json), the features whose `touches:` overlap it: the same matching as
// `novadev features --touching <hub path>`. The hub with the most features comes first.
//
// Each feature line says how many of its touched paths are on a hub: a hub path itself, or a path
// inside one. A feature whose every touched path is on a hub has no folder of its own. A search by
// folder finds it only together with all the other features on that hub, so it is marked. A
// feature that is listed only because one of its paths HOLDS the hub (a folder above it) says so:
// none of its code needs to be in the hub at all.
//
// It reads files only. The metrics command never runs here: the hub paths are the ones in the
// snapshot `novadev sync` stored last.
import { type HubPath, hubPaths, missingHubPaths, parseHubsSetting } from './hubs.ts';
import {
  type Feature,
  byCodePoint,
  comparablePath,
  fail,
  featureStatusMark,
  novadevDir,
  pathWithin,
  pathsOverlap,
  readManifest,
} from './lib.ts';
import { readMetricsConfig, readSnapshot } from './metrics.ts';

/** One feature on one hub. */
export type HubFeature = {
  feature: Feature;
  /** How many paths it touches, each counted once. */
  touched: number;
  /** How many of them are on a hub — on any hub: the hub path itself, or a path inside it. */
  onHubs: number;
  /**
   * Its touched paths that hold THIS hub (a folder above it). Filled only when none of its touched
   * paths is in the hub itself: then they are the reason it is listed.
   */
  holders: string[];
};

/** One hub path and the features whose `touches:` overlap it. */
export type HubGroup = { path: string; names: string[]; features: HubFeature[] };

/** True when every path the feature touches is on a hub: it has no folder of its own. */
export function onlyHubPaths(entry: HubFeature): boolean {
  return entry.touched > 0 && entry.onHubs === entry.touched;
}

/**
 * The features on each hub: the hub with the most features first, ties in path order; the features
 * of one hub in the order they are given. Hubs that share a path (two measures of one folder) are
 * one group, with both names.
 */
export function featuresByHub(features: readonly Feature[], hubs: readonly HubPath[]): HubGroup[] {
  const groups: HubGroup[] = [];
  for (const hub of hubs) {
    const same = groups.find((group) => comparablePath(group.path) === comparablePath(hub.path));
    if (same === undefined) {
      groups.push({ path: hub.path, names: hub.name ? [hub.name] : [], features: [] });
    } else if (hub.name && !same.names.includes(hub.name)) {
      same.names.push(hub.name);
    }
  }
  for (const feature of features) {
    const paths = distinctPaths(feature.touches);
    const onHubs = paths.filter((path) => groups.some((group) => pathWithin(path, group.path))).length;
    for (const group of groups) {
      if (!paths.some((path) => pathsOverlap(path, group.path))) continue;
      const inside = paths.some((path) => pathWithin(path, group.path));
      group.features.push({
        feature,
        touched: paths.length,
        onHubs,
        holders: inside ? [] : paths.filter((path) => pathWithin(group.path, path)),
      });
    }
  }
  return groups.sort((a, b) => b.features.length - a.features.length || byCodePoint(a.path, b.path));
}

/** The paths, each once: "src/a/" and "./src/a" are one path, written the first way it appears. */
function distinctPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = comparablePath(path);
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Print the report. `hits` are the features the other options kept (every feature when there are
 * none), `filters` describes those options (" (status=planned)", or ""), and `touching` keeps only
 * the hubs that overlap that path. With no hub paths at all, it says why and how to set them, and
 * exits with 1.
 */
export function printHubReport(root: string, hits: readonly Feature[], filters: string, touching?: string): void {
  const nd = novadevDir(root);
  const { source, hubs } = hubPaths(nd);
  if (source === null) fail(noHubPathsMessage(nd));
  const from = source === 'snapshot' ? 'from the metrics snapshot' : 'from "hubs" in novadev.json';

  const every = featuresByHub(hits, hubs);
  const groups = every.filter((group) => touching === undefined || pathsOverlap(group.path, touching));
  if (groups.length === 0) {
    console.log(
      every.length === 1
        ? `features --hubs — the hub path (${from}) does not overlap ${touching}`
        : `features --hubs — none of the ${every.length} hub paths (${from}) overlaps ${touching}`,
    );
    return;
  }
  const on = new Set(groups.flatMap((group) => group.features.map((entry) => entry.feature)));
  const them = groups.length === 1 ? 'it' : 'them';
  console.log(
    hits.length === 0
      ? `features --hubs — ${count(groups.length, 'hub path')} (${from}); no feature matches${filters}`
      : `features --hubs — ${count(groups.length, 'hub path')} (${from}); features that touch ${them}: ${on.size} of ${hits.length}${filters}`,
  );
  for (const note of sourceNotes(nd, source)) console.log(`  · ${note}`);
  if (hits.length === 0) return;

  const missing = new Set(missingHubPaths(root, hubs).map((hub) => comparablePath(hub.path)));
  let marked = false;
  for (const group of groups) {
    const label = group.names.length > 0 ? `${group.names.join(', ')} (${group.path})` : group.path;
    const size =
      group.features.length > 0
        ? count(group.features.length, 'feature')
        : `no ${filters ? 'matching ' : ''}feature touches it`;
    const gone = missing.has(comparablePath(group.path)) ? ' — this path is not in the project' : '';
    console.log(`\n${label} — ${size}${gone}`);
    for (const entry of group.features) {
      const only = onlyHubPaths(entry);
      marked ||= only;
      console.log(featureLine(entry, only));
    }
  }
  if (marked) {
    console.log(
      "\n← only hub paths: every path in the feature's `touches:` is on a hub. A search by folder\n" +
        '  finds it only together with all the other features on that hub. When its code moves off\n' +
        '  the hub, add the new path to its `touches:`, and remove the hub path once none of its\n' +
        '  code is left there.',
    );
  }
}

/** "  ● FEAT-0007  [shipped]  Selection filter  (hub paths: 1 of 1)  ← only hub paths". */
function featureLine(entry: HubFeature, only: boolean): string {
  const { feature, holders } = entry;
  const why =
    holders.length === 0
      ? ''
      : holders.length === 1
        ? `; its path ${holders[0]} holds this hub`
        : `; its paths ${holders.join(', ')} hold this hub`;
  return (
    `  ${featureStatusMark(feature.status)} ${feature.id}  [${feature.status || 'no-status'}]  ${feature.title}` +
    `  (hub paths: ${entry.onHubs} of ${entry.touched}${why})${only ? '  ← only hub paths' : ''}`
  );
}

/** Notes on where the hub paths came from: snapshot hubs left out, a novadev.json list not used. */
function sourceNotes(nd: string, source: 'snapshot' | 'novadev.json'): string[] {
  if (source !== 'snapshot') return [];
  const notes: string[] = [];
  const read = readSnapshot(nd);
  const pathless = read.state === 'ok' ? read.snapshot.hubs.filter((hub) => !hub.path).map((hub) => hub.name) : [];
  if (pathless.length > 0) {
    notes.push(
      `${count(pathless.length, 'hub')} in the metrics snapshot ${pathless.length === 1 ? 'has' : 'have'} no "path", so ${pathless.length === 1 ? 'it is' : 'they are'} not listed: ${pathless.join(', ')}`,
    );
  }
  const listed = parseHubsSetting(readManifest(nd)?.hubs);
  if (listed.ok && listed.value.length > 0) {
    notes.push('"hubs" in novadev.json is not used: the metrics snapshot names hub paths, and those come first');
  }
  return notes;
}

/** Why there are no hub paths, and how to set them. */
export function noHubPathsMessage(nd: string): string {
  const reasons: string[] = [];
  const listed = parseHubsSetting(readManifest(nd)?.hubs);
  if (!listed.ok) reasons.push(`novadev.json: ${listed.error}`);
  const read = readSnapshot(nd);
  if (read.state === 'invalid' || read.state === 'blocked') {
    reasons.push(`the metrics snapshot (.novadev/metrics/latest.json) cannot be read: ${read.error} — \`novadev sync\` writes it again`);
  } else if (read.state === 'ok' && read.snapshot.hubs.length > 0) {
    reasons.push(`the metrics snapshot names ${count(read.snapshot.hubs.length, 'hub')}, but none with a "path"`);
  } else if (read.state === 'absent' && readMetricsConfig(nd).command !== null) {
    reasons.push('a "metrics" command is set, but no snapshot is stored yet — run `novadev sync`');
  }
  return [
    'no hub paths are set, so `novadev features --hubs` has nothing to list.',
    ...reasons.map((reason) => `  ${reason}`),
    '  Set them in one of two ways:',
    '  - a "metrics" command in .novadev/novadev.json that prints a "path" for each hub',
    '    (.novadev/metrics/README.md), then `novadev sync`',
    '  - or a "hubs" list in .novadev/novadev.json: "hubs": ["src/editor/workbench/", "src/editor/stage3d.ts"]',
  ].join('\n');
}

/** "1 feature", "5 features". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
