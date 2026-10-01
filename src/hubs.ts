// Hub paths: the files and folders a project calls its hubs — the places that collect too much.
//
// They come from the metrics snapshot (`hubs[].path`, metrics.ts) when it names any. When it names
// none — no metrics command, or hubs without a path — they come from a list in novadev.json:
//
//   "hubs": ["src/editor/workbench/", "src/editor/stage3d.ts"]      off when absent, null or []
//
// The placement check (placement.ts) asks which records changed a file inside one, and
// `novadev features --hubs` (feature-hubs.ts) which features name one in their `touches:`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Parsed, pathWithin, readManifest, refuse } from './lib.ts';
import { type SnapshotRead, readSnapshot, repoPath } from './metrics.ts';

/** One hub path, with the hub's name when the metrics snapshot gives one. */
export type HubPath = { path: string; name?: string };
/** Where the hub paths came from: the snapshot, the "hubs" list in novadev.json, or nowhere. */
export type HubSource = 'snapshot' | 'novadev.json' | null;
export type HubPaths = { source: HubSource; hubs: HubPath[] };

const HUBS_FORMAT =
  '"hubs" must be a list of paths inside the project, relative to its root and without "..", like ["src/editor/workbench/"] — or null for none';

/** The "hubs" list of novadev.json, normalized like a snapshot's paths. Absent or null is no list. */
export function parseHubsSetting(raw: unknown): Parsed<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return refuse(HUBS_FORMAT);
  const paths: string[] = [];
  for (const entry of raw) {
    const path = typeof entry === 'string' ? repoPath(entry) : null;
    if (path === null) return refuse(HUBS_FORMAT);
    if (!paths.includes(path)) paths.push(path);
  }
  return { ok: true, value: paths };
}

/**
 * The hub paths novadev works with: the snapshot's, when it names at least one; otherwise the
 * "hubs" list of novadev.json (a broken list counts as none — doctor reports it). `snapshot` is the
 * snapshot as sync is about to store it; without it, the stored one is read.
 */
export function hubPaths(nd: string, snapshot?: SnapshotRead): HubPaths {
  const read = snapshot ?? readSnapshot(nd);
  if (read.state === 'ok') {
    const hubs = read.snapshot.hubs.flatMap((hub) => (hub.path ? [{ path: hub.path, name: hub.name }] : []));
    if (hubs.length > 0) return { source: 'snapshot', hubs };
  }
  const listed = parseHubsSetting(readManifest(nd)?.hubs);
  if (listed.ok && listed.value.length > 0) {
    return { source: 'novadev.json', hubs: listed.value.map((path) => ({ path })) };
  }
  return { source: null, hubs: [] };
}

/**
 * True when `path` — a file path relative to the project root, as git gives it — is the hub path
 * itself or lies inside it. A hub path is read as a file or as a folder, with or without a
 * trailing "/": "src/wb" holds "src/wb/a.ts" but not "src/wb2/a.ts".
 */
export function inHub(path: string, hub: string): boolean {
  return pathWithin(path, hub);
}

/** How a hub is named in a message: its name and its path, or just the path. */
export function hubLabel(hub: HubPath): string {
  return hub.name ? `${hub.name} (${hub.path})` : hub.path;
}

/** Hub paths that name nothing in the project — likely a typo, so the checks never match them. */
export function missingHubPaths(root: string, hubs: readonly HubPath[]): HubPath[] {
  return hubs.filter((hub) => !existsSync(join(root, hub.path)));
}
