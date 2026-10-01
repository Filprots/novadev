// The `## Placement` section of a record, and the check `novadev doctor` and `novadev sync` run on it.
//
// Hubs grow when every change lands on them by default. So the loop asks "where does this go?"
// twice: the PLAN phase names the unit that will own a change to a hub before any code is written,
// and every record says where its new units went, in a section of its own:
//
//   ## Placement
//   - the kit registry → src/kits/registry.ts (new, 140 lines); Workbench 11,019 → 10,880 —
//     the Workbench only calls it now
//
// The check: a work record (ai_completed / ai_progress / ai_failed) of a todo still in `todos/`,
// dated on or after "placementSince" in novadev.json, whose `**Commits:**` line names a commit
// that changed a file inside a hub path (hubs.ts), must carry that section, and the section must
// say something. git says which files a commit changed (git.ts); a commit git does not know is
// skipped. Older records and archived ones are history, and are not checked.
//
// The check reads only files and git history, never the working tree's changes, so a hook and CI
// give the same answer for the same commit — given the history of the commits a record names.
import { commitPaths } from './git.ts';
import { type HubPath, hubLabel, hubPaths, inHub, missingHubPaths, parseHubsSetting } from './hubs.ts';
import {
  type Parsed,
  type WorkRecord,
  commitHashesIn,
  hasWords,
  markdownSections,
  novadevDir,
  openWorkRecords,
  proseLines,
  readField,
  readManifest,
  recordDate,
  refuse,
} from './lib.ts';
import type { SnapshotRead } from './metrics.ts';

/** The section's title: `## Placement`. */
export const PLACEMENT_SECTION = 'Placement';

/** What every message about a missing or empty section asks for. */
const PLACEMENT_ASK =
  'each new unit of state or behaviour with its owner, its size before → after, and why it is not on a hub; or "nothing new placed"';

/** "placementSince" in novadev.json: a day (YYYY-MM-DD), or null / absent for every record in todos/. */
export function parsePlacementSince(raw: unknown): Parsed<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && isRealDay(raw)) {
    return { ok: true, value: raw };
  }
  return refuse(
    '"placementSince" must be a day like "2026-10-01" — records dated before it are not checked for a "## Placement" section — or null to check every record in todos/',
  );
}

/** True for a day the calendar has: "2026-02-28", not "2026-02-30" (which Date would roll over). */
function isRealDay(day: string): boolean {
  const time = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === day;
}

/** What a record's `## Placement` section holds: words, nothing, or there is no section. */
export type PlacementState = 'written' | 'empty' | 'missing';

/**
 * Reads the `## Placement` sections of a record (fenced code and comments do not count, see
 * `markdownSections`). A section is empty when it holds no words once comments and unfilled
 * `<placeholders>` are gone — the template copied as it is says nothing.
 */
export function placementState(text: string): PlacementState {
  const sections = markdownSections(text, PLACEMENT_SECTION);
  if (sections.length === 0) return 'missing';
  return hasWords(sections.flat().join('\n')) ? 'written' : 'empty';
}

/**
 * True when the record says `**Placement:**` on a line of its own — outside a section, the form a
 * project may have used before the section existed. It does not count; the message says so.
 */
function hasPlacementLine(text: string): boolean {
  return proseLines(text.replace(/\r\n?/g, '\n').split('\n')).some((line) =>
    /^ {0,3}(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(?:\*\*|__)placement:?(?:\*\*|__)/i.test(line),
  );
}

/**
 * `problems` fail doctor and sync (and so `sync --check`). `actions` are work for the agent: sync
 * lists them as NEXT ACTIONS, doctor as notes. `notes` are for doctor only.
 */
export type PlacementAudit = { problems: string[]; actions: string[]; notes: string[] };

/**
 * The settings ("hubs", "placementSince") and every record the check applies to. No hub path, no
 * check — and then git is never asked. `snapshot` is the metrics snapshot as sync is about to store
 * it; without it (doctor), the stored one gives the hub paths.
 */
export function auditPlacement(root: string, snapshot?: SnapshotRead): PlacementAudit {
  const nd = novadevDir(root);
  const problems: string[] = [];
  const actions: string[] = [];
  const notes: string[] = [];
  const manifest = readManifest(nd);

  const listed = parseHubsSetting(manifest?.hubs);
  if (!listed.ok) problems.push(`novadev.json: ${listed.error}`);
  const since = parsePlacementSince(manifest?.placementSince);
  if (!since.ok) problems.push(`novadev.json: ${since.error}`);

  const { source, hubs } = hubPaths(nd, snapshot);
  if (hubs.length === 0) return { problems, actions, notes };
  if (source === 'snapshot' && listed.ok && listed.value.length > 0) {
    notes.push('novadev.json: "hubs" is not used — the metrics snapshot names hub paths, and those come first');
  }
  const from = source === 'snapshot' ? 'from the metrics snapshot' : 'from "hubs" in novadev.json';
  for (const hub of missingHubPaths(root, hubs)) {
    actions.push(
      `hub path ${hub.path} (${from}) is not in the project, so no change can match it — correct the path, or remove it ${source === 'snapshot' ? 'from what the metrics command prints' : 'from "hubs"'}`,
    );
  }
  // Which records are old enough to be history is a setting: until it reads, judge none of them.
  if (!since.ok) return { problems, actions, notes };

  const records = openWorkRecords(nd)
    .filter((record) => {
      const date = recordDate(record.text);
      return since.value === null || date === null || date >= since.value;
    })
    .map((record) => ({ record, commits: commitHashesIn(readField(record.text, 'Commits') ?? '') }))
    .filter(({ commits }) => commits.length > 0);
  if (records.length === 0) return { problems, actions, notes };

  const changed = commitPaths(root, records.flatMap(({ commits }) => commits));
  if (changed === null) {
    notes.push(
      `placement: ${records.length} record(s) name commits, but there is no git repository here to say which files they changed — the "## ${PLACEMENT_SECTION}" check cannot run`,
    );
    return { problems, actions, notes };
  }

  for (const { record, commits } of records) {
    const touched = hubsTouched(commits, changed, hubs);
    if (touched.hubs.length === 0) continue;
    const state = placementState(record.text);
    if (state === 'written') continue;
    problems.push(placementProblem(record, touched, state));
  }
  return { problems, actions, notes };
}

/** The hubs a record's commits changed, and the commits that changed one. */
function hubsTouched(
  commits: readonly string[],
  changed: ReadonlyMap<string, string[]>,
  hubs: readonly HubPath[],
): { commits: string[]; hubs: HubPath[] } {
  const by: string[] = [];
  const hit = new Set<HubPath>();
  for (const commit of commits) {
    const inside = hubs.filter((hub) => (changed.get(commit) ?? []).some((path) => inHub(path, hub.path)));
    if (inside.length === 0) continue;
    by.push(commit);
    for (const hub of inside) hit.add(hub);
  }
  return { commits: by, hubs: hubs.filter((hub) => hit.has(hub)) };
}

function placementProblem(
  record: WorkRecord,
  touched: { commits: string[]; hubs: HubPath[] },
  state: Exclude<PlacementState, 'written'>,
): string {
  const commits = `${touched.commits.length === 1 ? 'commit' : 'commits'} ${touched.commits.join(', ')}`;
  const hubs = `${touched.hubs.length === 1 ? 'the hub' : 'the hubs'} ${words(touched.hubs.map(hubLabel))}`;
  const where = `${record.ref}/${record.file}: ${commits} changed ${hubs}`;
  if (state === 'empty') {
    return `${where}, but its "## ${PLACEMENT_SECTION}" section is empty — fill it in (loop phase 4): ${PLACEMENT_ASK}`;
  }
  const fix = hasPlacementLine(record.text)
    ? `its "**${PLACEMENT_SECTION}:**" line does not count: move it under a "## ${PLACEMENT_SECTION}" heading`
    : `add one (loop phase 4): ${PLACEMENT_ASK}`;
  return `${where}, but the record has no "## ${PLACEMENT_SECTION}" section — ${fix}`;
}

/** "a", "a and b", "a, b and c". */
function words(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
