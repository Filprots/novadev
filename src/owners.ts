// Area owners: who normally builds in an area of the product, and who must review a change to it —
// the CODEOWNERS idea, by feature area and by path.
//
//   "owners": {                                           in .novadev/novadev.json
//     "areas": {                                          by a feature's `area:`
//       "auth":     { "owner": "paperclip/dev", "reviewers": ["paperclip/reviewer", "human:anna"] }
//     },
//     "paths": {                                          by path, relative to the project root …
//       "src/billing/**":  { "owner": "paperclip/dev-2", "reviewers": ["human:filipp"] },
//       "irrippr:ps/**":   { "reviewers": ["paperclip/reviewer"] }      … or "<sub-repo>:<glob>"
//     },
//     "override": ["human:filipp"]                        who may approve without a required review,
//   }                                                     besides a person and the lead (lead.ts)
//
// `owner` is the developer who normally takes work there; `reviewers` are the actors of whom ONE
// must approve a change there. A project without the setting has no owners: nothing below changes
// anything, no answer carries a key more, no review is held.
//
// - A todo's SUGGESTED OWNER (`novadev file-todo`, `todo show`, `todo list --json`, `status
//   --json`): from the features it names (a `**Feature:**` line, or a FEAT id anywhere in its
//   brief) — their area, and their `touches` against the path rules — and from the paths its
//   brief names in backticks. The owner most matching rules name; the first one on a tie.
// - The REQUIRED REVIEWERS of a merge request (`novadev worktree mr`): the path rules that match
//   the files the branch changed, and the area rules of the features whose `touches` hold them.
// - The REQUIRED REVIEWS of a finished todo (`novadev todo review`): the area rules of the
//   features its records name, and the path rules that match the files its commits changed (its
//   features' `touches`, when its record names no commit git knows). An APPROVE counts as the
//   approval only when, for EACH matching rule, one of that rule's reviewers has approved; until
//   then every approval is kept as a sign-off and the review reads PARTIAL. A person, the lead
//   or an actor of `override` may approve without them — with a reason, which is recorded.
// - `novadev owners <path|area>` answers who owns something; `novadev owners` lists the rules.
//
// A path rule is a glob: `*` inside one folder, `**` across folders, `?` one character. A rule
// without any of them is a file or a folder with all that is in it (`src/auth` holds
// `src/auth/a.ts`); a rule without a "/" (`*.sql`) matches that name in any folder.
//
// This module must not import todo.ts (todo.ts, todo-filing.ts, worktree.ts, sync.ts and
// doctor.ts import it).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isLead, readLeads } from './lead.ts';
import {
  type Feature,
  RECORD_COMPLETED,
  ROOT_DIR_NAME,
  comparablePath,
  featureIdsIn,
  isPlainObject,
  listFeatures,
  novadevDir,
  pathWithin,
  readField,
  readManifest,
  requireProjectRoot,
} from './lib.ts';
import { ACTOR_FORMAT, actorKind, isTimestamp } from './okf.ts';
import { commitChanges, commitRefsIn, listSubrepos, parseSubreposSetting } from './subrepos.ts';

export const OWNERS_SETTING = 'owners';
const KNOWN_KEYS = ['areas', 'paths', 'override'];
const RULE_KEYS = ['owner', 'reviewers'];
const BRIEF = 'prompt.md';
const SETTING_FILE = `${ROOT_DIR_NAME}/novadev.json`;

/** One rule: an area or a path, its owner and its reviewers. */
export type OwnerRule = {
  kind: 'area' | 'path';
  /** The key as it is written in the setting: `auth`, `src/billing/**`, `irrippr:ps/**`. */
  key: string;
  /** How a message names it: `area auth`, `path src/billing/**`. */
  name: string;
  owner: string | null;
  reviewers: string[];
  /** A path rule's sub-repo (`irrippr`), or null for a path of the project. */
  repo: string | null;
  /** A path rule's glob, without the sub-repo. */
  glob: string;
};

export type Owners = {
  /** False when novadev.json has no `"owners"`: nothing is suggested, listed or required. */
  configured: boolean;
  rules: OwnerRule[];
  /** Who may approve without a required review, besides a person and the lead. */
  override: string[];
  /** What novadev could not read in the setting; an unreadable rule is left out. */
  errors: string[];
};

/** A rule that matched, and what made it match (`FEAT-0003`, `src/auth/login.ts`). */
export type RuleMatch = { rule: OwnerRule; because: string[] };

function actors(value: unknown, where: string, errors: string[]): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of list) {
    const actor = typeof item === 'string' ? item.trim() : '';
    if (actorKind(actor) === null) errors.push(`${where}: ${JSON.stringify(item)} is not an actor — ${ACTOR_FORMAT}`);
    else if (!out.includes(actor)) out.push(actor);
  }
  return out;
}

/** The project's owners setting. Never throws: what cannot be read is in `errors`, and left out. */
export function readOwners(nd: string): Owners {
  const raw = readManifest(nd)?.[OWNERS_SETTING];
  const out: Owners = { configured: false, rules: [], override: [], errors: [] };
  if (raw === undefined || raw === null) return out;
  out.configured = true;
  if (!isPlainObject(raw)) {
    out.errors.push('it must be an object: { "areas": {…}, "paths": {…}, "override": […] }');
    return out;
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.includes(key)) out.errors.push(`unknown key "${key}" (known: ${KNOWN_KEYS.join(', ')})`);
  }
  for (const kind of ['areas', 'paths'] as const) {
    const group = raw[kind];
    if (group === undefined || group === null) continue;
    if (!isPlainObject(group)) {
      out.errors.push(`"${kind}" must be an object: { "<${kind === 'areas' ? 'area' : 'glob'}>": { "owner"?, "reviewers"? } }`);
      continue;
    }
    for (const [written, value] of Object.entries(group)) {
      const key = written.trim();
      const where = `"${kind}" → "${written}"`;
      if (key === '') {
        out.errors.push(`${where}: an empty ${kind === 'areas' ? 'area' : 'path'}`);
        continue;
      }
      if (!isPlainObject(value)) {
        out.errors.push(`${where} must be { "owner"?: actor, "reviewers"?: [actors] }`);
        continue;
      }
      for (const k of Object.keys(value)) {
        if (!RULE_KEYS.includes(k)) out.errors.push(`${where}: unknown key "${k}" (known: ${RULE_KEYS.join(', ')})`);
      }
      const owner = actors(value.owner, `${where} "owner"`, out.errors);
      if (owner.length > 1) out.errors.push(`${where}: "owner" is one actor — the others belong in "reviewers"`);
      const reviewers = actors(value.reviewers, `${where} "reviewers"`, out.errors);
      if (owner.length === 0 && reviewers.length === 0) {
        out.errors.push(`${where} names neither an "owner" nor "reviewers" novadev can read — the rule does nothing`);
        continue;
      }
      let repo: string | null = null;
      let glob = key;
      if (kind === 'paths') {
        const colon = key.indexOf(':');
        if (colon > 0 && !/[/*?]/.test(key.slice(0, colon))) {
          repo = key.slice(0, colon);
          glob = key.slice(colon + 1);
        }
        glob = glob.replace(/\\/g, '/').replace(/^\.?\//, '');
        if (repo === '.') repo = null;
        if (glob === '' || glob.split('/').includes('..')) {
          out.errors.push(`${where}: a path inside ${repo === null ? 'the project' : `the sub-repo ${repo}`} is needed, like "src/billing/**"`);
          continue;
        }
      }
      out.rules.push({ kind: kind === 'areas' ? 'area' : 'path', key, name: `${kind === 'areas' ? 'area' : 'path'} ${key}`, owner: owner[0] ?? null, reviewers, repo, glob });
    }
  }
  out.override = actors(raw.override, '"override"', out.errors);
  return out;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const hasGlob = (pattern: string) => /[*?]/.test(pattern);

function globRegex(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}(?:/.*)?$`);
}

/**
 * Does a path match a rule's glob? Without `*` or `?` the glob is a file, or a folder with all
 * that is in it; without a "/" it is a name looked for in every folder; `**` crosses folders.
 */
export function globMatch(glob: string, path: string): boolean {
  // `src/billing/**` is the folder with all that is in it — the folder itself included.
  const pattern = comparablePath(glob).replace(/(\/\*\*)+$/, '');
  const file = comparablePath(path);
  if (pattern === '' || file === '') return false;
  if (!hasGlob(pattern)) return pathWithin(file, pattern);
  if (!pattern.includes('/')) return file.split('/').some((segment) => globRegex(pattern).test(segment));
  return globRegex(pattern).test(file);
}

/** The folder of a sub-repo, relative to the project root: as found on disk, or as the setting names it. */
function repoFolder(root: string, name: string): string | null {
  const found = listSubrepos(root).repos.find((repo) => repo.name === name);
  if (found) return found.rel;
  const setting = parseSubreposSetting(readManifest(novadevDir(root))?.subrepos);
  if (!setting.ok) return null;
  for (const entry of setting.value) {
    if (entry.endsWith('/*')) return `${entry.slice(0, -2)}/${name}`;
    if (entry.split('/').at(-1) === name) return entry;
  }
  return null;
}

/** Does a path rule hold this file (a path relative to the project root)? */
function ruleHoldsFile(root: string, rule: OwnerRule, file: string): boolean {
  if (rule.repo === null) return globMatch(rule.glob, file);
  const folder = repoFolder(root, rule.repo);
  if (folder === null || !pathWithin(file, folder) || comparablePath(file) === folder) return false;
  return globMatch(rule.glob, comparablePath(file).slice(folder.length + 1));
}

/** Does a path rule cover ground a feature's `touches` entry names (a file or a folder)? */
function ruleMeetsTouch(root: string, rule: OwnerRule, touch: string): boolean {
  if (ruleHoldsFile(root, rule, touch)) return true;
  // The other way round: the feature touches `src/`, the rule is about `src/auth/**`.
  const cut = rule.glob.search(/[*?]/);
  const literal = comparablePath(cut === -1 ? rule.glob : rule.glob.slice(0, rule.glob.lastIndexOf('/', cut) + 1));
  if (literal === '') return false;
  const folder = rule.repo === null ? '' : repoFolder(root, rule.repo);
  if (folder === null) return false;
  return pathWithin(folder === '' ? literal : `${folder}/${literal}`, touch);
}

function add(matches: Map<string, RuleMatch>, rule: OwnerRule, because: string): void {
  const known = matches.get(rule.name);
  if (known === undefined) matches.set(rule.name, { rule, because: [because] });
  else if (!known.because.includes(because)) known.because.push(because);
}

const sameArea = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The rules that match: the area rules of `features`, the path rules that hold one of `files`
 * (paths relative to the project root), and — with `touches` — the path rules that meet what the
 * features touch. In the order of the setting.
 */
export function matchRules(root: string, owners: Owners, what: { features?: readonly Feature[]; files?: readonly string[]; touches?: boolean }): RuleMatch[] {
  const matches = new Map<string, RuleMatch>();
  for (const rule of owners.rules) {
    if (rule.kind === 'area') {
      for (const feature of what.features ?? []) if (feature.area !== '' && sameArea(feature.area, rule.key)) add(matches, rule, feature.id);
      continue;
    }
    for (const file of what.files ?? []) if (ruleHoldsFile(root, rule, file)) add(matches, rule, file);
    if (what.touches === true) {
      for (const feature of what.features ?? []) {
        for (const touch of feature.touches) if (ruleMeetsTouch(root, rule, touch)) add(matches, rule, `${feature.id} touches ${touch}`);
      }
    }
  }
  return [...matches.values()];
}

/** How a match is said in one line: `area auth (FEAT-0003)`. */
export function matchText(match: RuleMatch): string {
  const shown = match.because.slice(0, 3).join(', ');
  return `${match.rule.name} (${shown}${match.because.length > 3 ? `, +${match.because.length - 3}` : ''})`;
}

export type SuggestedOwner = { owner: string; because: string[]; others?: { owner: string; because: string[] }[] };

/** The owner most matching rules name — the first named on a tie — or null when no matching rule names one. */
export function suggestOwner(matches: readonly RuleMatch[]): SuggestedOwner | null {
  const byOwner = new Map<string, string[]>();
  for (const match of matches) {
    if (match.rule.owner === null) continue;
    byOwner.set(match.rule.owner, [...(byOwner.get(match.rule.owner) ?? []), matchText(match)]);
  }
  const ranked = [...byOwner.entries()].map(([owner, because], index) => ({ owner, because, index })).sort((a, b) => b.because.length - a.because.length || a.index - b.index);
  const [first, ...rest] = ranked;
  if (first === undefined) return null;
  return { owner: first.owner, because: first.because, ...(rest.length > 0 ? { others: rest.map(({ owner, because }) => ({ owner, because })) } : {}) };
}

export type RequiredReview = { rule: string; reviewers: string[]; because: string[] };

/** The reviews the matching rules ask for: one per rule that names reviewers. */
export function requiredReviews(matches: readonly RuleMatch[]): RequiredReview[] {
  return matches.filter((m) => m.rule.reviewers.length > 0).map((m) => ({ rule: m.rule.name, reviewers: m.rule.reviewers, because: m.because }));
}

// ---------------------------------------------------------------------------
// A todo
// ---------------------------------------------------------------------------

function markdownOf(todoDir: string): { file: string; text: string }[] {
  if (!existsSync(todoDir)) return [];
  return readdirSync(todoDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(todoDir, file), 'utf8') }));
}

/** The features a todo's files link with a `**Feature:**` line. */
function linkedFeatureIds(files: readonly { text: string }[]): string[] {
  return [...new Set(files.flatMap(({ text }) => featureIdsIn(readField(text, 'Feature') ?? '')))];
}

/** Paths a brief names in backticks: `src/auth/login.ts`, `repos/irrippr/ps/` — a token with a "/" or a file extension. */
function briefPaths(brief: string): string[] {
  const out: string[] = [];
  for (const m of brief.matchAll(/`([^`\s]+)`/g)) {
    const token = m[1]!.replace(/[:,;.]+$/, '');
    if (/^[a-z]+:\/\//i.test(token) || token.startsWith('-') || token.startsWith('/') || token.split('/').includes('..')) continue;
    if ((token.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(token)) && !/^FEAT-\d{4}/.test(token) && !out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * Reads the suggested owner of todos, with the setting and the features read once: null for every
 * todo in a project without owners.
 */
export function ownerSuggester(nd: string): (todoDir: string) => SuggestedOwner | null {
  const owners = readOwners(nd);
  if (!owners.configured || owners.rules.length === 0) return () => null;
  const root = dirname(nd);
  const features = listFeatures(nd);
  return (todoDir) => {
    const files = markdownOf(todoDir);
    const brief = files.find((f) => f.file === BRIEF)?.text ?? '';
    const ids = new Set([...linkedFeatureIds(files), ...featureIdsIn(brief)]);
    return suggestOwner(matchRules(root, owners, { features: features.filter((f) => ids.has(f.id)), files: briefPaths(brief), touches: true }));
  };
}

/** The suggested owner of one todo, or null (no owners, or no rule that names one matches). */
export function suggestedOwner(nd: string, todoDir: string): SuggestedOwner | null {
  return ownerSuggester(nd)(todoDir);
}

/** The commits a finished todo's record names, as one comparable line (`none` when it names none). */
export function recordCommits(todoDir: string): string {
  const record = join(todoDir, RECORD_COMPLETED);
  const refs = commitRefsIn(existsSync(record) ? (readField(readFileSync(record, 'utf8'), 'Commits') ?? '') : '');
  return refs.length === 0 ? 'none' : refs.map((ref) => ref.text).join(', ');
}

/**
 * The rules a finished todo's work falls under: the areas of the features its files link, and the
 * path rules that hold the files its record's commits changed (novadev's own folder aside). When
 * the record names no commit git knows, the features' `touches` stand in for the files.
 */
export function todoReviewRules(nd: string, todoDir: string, owners: Owners = readOwners(nd)): RuleMatch[] {
  if (!owners.configured || owners.rules.length === 0) return [];
  const root = dirname(nd);
  const files = markdownOf(todoDir);
  const ids = new Set(linkedFeatureIds(files));
  const features = listFeatures(nd).filter((f) => ids.has(f.id));
  const record = files.find((f) => f.file === RECORD_COMPLETED)?.text ?? '';
  const changes = commitChanges(root, commitRefsIn(readField(record, 'Commits') ?? ''));
  const changed = [...new Set([...(changes?.values() ?? [])].flat())].filter((file) => !pathWithin(file, ROOT_DIR_NAME));
  return matchRules(root, owners, { features, files: changed, touches: changed.length === 0 });
}

// ---------------------------------------------------------------------------
// Sign-offs: the approvals a review keeps until every matching rule has one
// ---------------------------------------------------------------------------

export type SignOff = { by: string; at: string };
/** The verdict of a review that is an approval by some, not yet by all the rules ask for. */
export const VERDICT_PARTIAL = 'PARTIAL';

/** The sign-offs an ai_review.md carries, and the commits they were given for. */
export function readSignOffs(reviewText: string): { signoffs: SignOff[]; commits: string | null } {
  const signoffs: SignOff[] = [];
  for (const part of (readField(reviewText, 'Sign-offs') ?? '').split(',')) {
    const [by, at] = part.split('@').map((s) => s.trim());
    if (by !== undefined && at !== undefined && actorKind(by) !== null && isTimestamp(at) && !signoffs.some((s) => s.by === by)) signoffs.push({ by, at });
  }
  return { signoffs, commits: readField(reviewText, 'Reviewed commits') };
}

export type ReviewJudgement = {
  /** Every required review, and who of its reviewers approved (null: nobody yet). */
  required: (RequiredReview & { approvedBy: string | null })[];
  /** The ones still without an approval. */
  missing: RequiredReview[];
};

/** Which required reviews the sign-offs satisfy: one reviewer of a rule is enough for that rule. */
export function judgeReviews(required: readonly RequiredReview[], signoffs: readonly SignOff[]): ReviewJudgement {
  const judged = required.map((r) => ({ ...r, approvedBy: signoffs.find((s) => r.reviewers.includes(s.by))?.by ?? null }));
  return { required: judged, missing: judged.filter((r) => r.approvedBy === null).map(({ approvedBy: _a, ...r }) => r) };
}

/** The required reviews a todo's PARTIAL review still waits for (none when its review is none, or complete). */
export function waitingReviews(nd: string, todoDir: string): RequiredReview[] {
  const path = join(todoDir, 'ai_review.md');
  if (!existsSync(path)) return [];
  const kept = readSignOffs(readFileSync(path, 'utf8'));
  return judgeReviews(requiredReviews(todoReviewRules(nd, todoDir)), kept.commits === recordCommits(todoDir) ? kept.signoffs : []).missing;
}

/** May this actor approve without a required review? A person, the lead, or an actor the setting's `override` names. */
export function mayOverride(nd: string, owners: Owners, actor: string): boolean {
  return actorKind(actor) === 'human' || isLead(nd, actor) || owners.override.includes(actor);
}

/** Who may override, for a message. */
export function overrideText(nd: string, owners: Owners): string {
  const named = [...new Set([...readLeads(nd).leads, ...owners.override])];
  return `a person${named.length > 0 ? `, or ${named.join(', ')}` : ` (no lead is named: "lead" or "owners.override" in ${SETTING_FILE})`}`;
}

/** The header lines a review carries in a project with owners: who signed off, for which commits, and what is required. */
export function reviewFields(judgement: ReviewJudgement, signoffs: readonly SignOff[], commits: string, override: { by: string; at: string; reason: string } | null): string[] {
  return [
    `**Sign-offs:** ${signoffs.map((s) => `${s.by} @ ${s.at}`).join(', ')}`,
    `**Reviewed commits:** ${commits}`,
    `**Required reviewers:** ${judgement.required.map((r) => `${r.rule} — ${r.approvedBy !== null ? `${r.approvedBy} ✓` : `one of ${r.reviewers.join(', ')} (${override !== null ? 'overridden' : 'waiting'})`}`).join('; ')}`,
    ...(override !== null ? [`**Override:** ${override.by} @ ${override.at} — ${override.reason}`] : []),
  ];
}

// ---------------------------------------------------------------------------
// The merge request, the audit, the command
// ---------------------------------------------------------------------------

/**
 * The "Required reviewers" section of a merge request, for the files a branch changed (paths
 * relative to the project root): the path rules that hold them, and the area rules of the features
 * whose `touches` hold them. No lines in a project without owners, or when no rule matches.
 */
export function requiredReviewerLines(root: string, files: readonly string[]): string[] {
  const nd = novadevDir(root);
  const owners = readOwners(nd);
  if (!owners.configured || owners.rules.length === 0) return [];
  const changed = files.filter((file) => !pathWithin(file, ROOT_DIR_NAME));
  const features = listFeatures(nd).filter((f) => f.touches.some((touch) => changed.some((file) => pathWithin(file, touch))));
  const required = requiredReviews(matchRules(root, owners, { features, files: changed }));
  if (required.length === 0) return [];
  return [
    'Required reviewers (one of each line must approve — `novadev todo review`):',
    ...required.map((r) => `- ${r.rule}: ${r.reviewers.join(' or ')} — ${r.because.slice(0, 3).join(', ')}${r.because.length > 3 ? `, +${r.because.length - 3}` : ''}`),
  ];
}

/**
 * What is wrong with the setting (problems), and what a person may want to look at (notes): an
 * area no feature has, a sub-repo the project does not name.
 */
export function auditOwners(nd: string): { problems: string[]; notes: string[] } {
  const owners = readOwners(nd);
  if (!owners.configured) return { problems: [], notes: [] };
  const problems = owners.errors.map((error) => `${SETTING_FILE}: "${OWNERS_SETTING}" — ${error}`);
  const notes: string[] = [];
  const root = dirname(nd);
  const areas = new Set(listFeatures(nd).map((f) => f.area.trim().toLowerCase()).filter(Boolean));
  for (const rule of owners.rules) {
    if (rule.kind === 'area' && !areas.has(rule.key.toLowerCase())) notes.push(`${SETTING_FILE}: "${OWNERS_SETTING}" names the area "${rule.key}", which no feature has (a feature's \`area:\`) — the rule matches nothing yet`);
    if (rule.kind === 'path' && rule.repo !== null && repoFolder(root, rule.repo) === null) {
      problems.push(`${SETTING_FILE}: "${OWNERS_SETTING}" → "paths" → "${rule.key}": the project names no sub-repo "${rule.repo}" ("subrepos") — the rule can match nothing`);
    }
  }
  return { problems, notes };
}

/** `novadev owners <path|area>`: the rules that hold a path or name an area, and so who owns it and who must review it. */
export function whoOwns(nd: string, query: string): Record<string, unknown> {
  const owners = readOwners(nd);
  const root = dirname(nd);
  const asked = query.trim();
  const colon = asked.indexOf(':');
  // `irrippr:ps/a.js` names a file of a sub-repo, as a path rule does.
  const folder = colon > 0 && !asked.slice(0, colon).includes('/') ? repoFolder(root, asked.slice(0, colon)) : null;
  const path = folder !== null ? `${folder}/${asked.slice(colon + 1).replace(/^\/+/, '')}` : asked;
  const features = listFeatures(nd);
  const asArea = owners.rules.filter((rule) => rule.kind === 'area' && sameArea(rule.key, asked)).map((rule) => ({ rule, because: [`area ${asked}`] }));
  const byPath = matchRules(root, owners, { features: features.filter((f) => f.touches.some((touch) => pathWithin(path, touch))), files: [path] });
  const matches = [...asArea, ...byPath.filter((m) => !asArea.some((a) => a.rule.name === m.rule.name))];
  const suggested = suggestOwner(matches);
  return {
    query: asked,
    configured: owners.configured,
    owner: suggested?.owner ?? null,
    reviewers: [...new Set(matches.flatMap((m) => m.rule.reviewers))],
    rules: matches.map((m) => ({ rule: m.rule.name, owner: m.rule.owner, reviewers: m.rule.reviewers, because: m.because })),
  };
}

const USAGE = 'usage: novadev owners [<path|area>] [--json]   (who owns a path or an area, and who must review it; no argument: the rules)';

export function ownersCommand(args: string[]): void {
  const nd = novadevDir(requireProjectRoot());
  const json = args.includes('--json');
  const [query, extra] = args.filter((a) => a !== '--json');
  if (extra !== undefined || query?.startsWith('--')) {
    console.error(USAGE);
    process.exit(1);
  }
  const owners = readOwners(nd);
  if (query === undefined) {
    if (json) {
      console.log(JSON.stringify({ configured: owners.configured, rules: owners.rules.map(({ name, owner, reviewers }) => ({ rule: name, owner, reviewers })), override: owners.override, lead: readLeads(nd).leads, errors: owners.errors }, null, 2));
      return;
    }
    if (!owners.configured) return void console.log(`owners — none set ("${OWNERS_SETTING}" in ${SETTING_FILE})`);
    console.log(`owners — ${owners.rules.length} rule(s)`);
    for (const rule of owners.rules) console.log(`  ${rule.name}  owner: ${rule.owner ?? '—'}  reviewers: ${rule.reviewers.join(', ') || '—'}`);
    console.log(`  may approve without a required review (with a reason): ${overrideText(nd, owners)}`);
    for (const error of owners.errors) console.log(`  ✗ ${error}`);
    return;
  }
  const answer = whoOwns(nd, query);
  if (json) return void console.log(JSON.stringify(answer, null, 2));
  if (!owners.configured) return void console.log(`owners — none set ("${OWNERS_SETTING}" in ${SETTING_FILE})`);
  const rules = answer.rules as { rule: string; owner: string | null; reviewers: string[]; because: string[] }[];
  if (rules.length === 0) return void console.log(`${query} — no rule matches: nobody owns it, no review is required`);
  console.log(`${query} — owner: ${(answer.owner as string | null) ?? '—'}; reviewers: ${(answer.reviewers as string[]).join(', ') || '—'}`);
  for (const r of rules) console.log(`  ${r.rule}  owner: ${r.owner ?? '—'}  reviewers: ${r.reviewers.join(', ') || '—'}  (${r.because.join(', ')})`);
}
