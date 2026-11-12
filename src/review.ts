// The review record, `ai_review.md`, and team mode.
//
// A reviewer — another agent, the lead, a person — re-runs the checks of a finished todo and
// writes a verdict beside its record:
//
//   # ai_review — 02-dark-mode
//
//   **Date:** 2026-11-10
//   **Verdict:** APPROVE            (or CHANGES)
//   **Reviewer:** claude-code/claude-opus-5-5
//
//   ## Checks
//   - `bun test` — 547 pass, 0 fail
//
//   ## Findings
//   …
//
// `novadev todo review <ref> <payload.json>` writes it (the one before goes to the todo's
// `.review-history/`). A CHANGES verdict reopens a completed todo — state `changes`: the builder's
// turn — in every project. In TEAM MODE (`"team": true` in novadev.json) a completed todo counts as
// completed only once it is APPROVED and MERGED: every commit its record's `**Commits:**` line names
// is in the history of the default branch (a sub-repo's `repo@hash` in its own default branch's),
// and a record that names none is itself committed on the default branch. Until then it is `review`
// (no APPROVE yet) or `unmerged` (approved, not on the default branch yet).
//
// In a project with area owners (`"owners"` in novadev.json, owners.ts) an APPROVE that still lacks
// a required reviewer is written as `**Verdict:** PARTIAL`, with the sign-offs given so far. A
// PARTIAL review holds the todo in `review` in every project, team mode or not — as a CHANGES
// reopens it in every project: the rule would mean nothing where no review is otherwise needed.
//
// lib.ts asks `reviewGate` from `todoState`; nothing here may run at load time (the two modules
// import each other).
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { defaultBranch, fileOnBranch, headSummary, isAncestor } from './git.ts';
import { RECORD_COMPLETED, ROOT_DIR_NAME, readField, readManifest } from './lib.ts';
import { commitRefsIn, listSubrepos } from './subrepos.ts';

export const RECORD_REVIEW = 'ai_review.md';
export const REVIEW_HISTORY_DIR = '.review-history';
export const VERDICTS = ['APPROVE', 'CHANGES'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The verdict a `**Verdict:**` value states: APPROVE / approved / CHANGES / changes requested. Null when neither. */
export function parseVerdict(value: string | null): Verdict | null {
  const text = (value ?? '').trim().toUpperCase();
  if (/^APPROVE(D)?\b/.test(text)) return 'APPROVE';
  if (/^CHANGES?\b/.test(text) || /^REQUEST(ED)? CHANGES\b/.test(text)) return 'CHANGES';
  return null;
}

/** The verdict of a todo's review, or null when it has none (or none novadev can read). */
export function reviewVerdict(todoDir: string): Verdict | null {
  const path = join(todoDir, RECORD_REVIEW);
  if (!existsSync(path)) return null;
  return parseVerdict(readField(readFileSync(path, 'utf8'), 'Verdict'));
}

/** Is the todo's review an approval by some, not yet by every reviewer its area owners ask for (owners.ts)? */
export function reviewIsPartial(todoDir: string): boolean {
  const path = join(todoDir, RECORD_REVIEW);
  if (!existsSync(path)) return false;
  return /^PARTIAL\b/i.test((readField(readFileSync(path, 'utf8'), 'Verdict') ?? '').trim());
}

/** `"team"` in novadev.json: true turns team mode on; anything else is off. */
export function teamMode(nd: string): boolean {
  const cached = teamCache.get(nd);
  if (cached !== undefined) return cached;
  const on = readManifest(nd)?.team === true;
  teamCache.set(nd, on);
  return on;
}
const teamCache = new Map<string, boolean>();

/** Forget cached answers (a test that changes the manifest or the history in one process). */
export function forgetReviewCache(): void {
  teamCache.clear();
  mergedCache.clear();
  todoMergedCache.clear();
  repositoryCache.clear();
}

/**
 * The `.novadev/` folder of a todo still in `todos/` — `<nd>/todos/<batch>/<todo>` — or null for an
 * archived todo, or a folder of another shape: the team gate judges open work only.
 */
function openTodoNd(todoDir: string): string | null {
  const todos = dirname(dirname(todoDir));
  if (basename(todos) !== 'todos') return null;
  const nd = dirname(todos);
  return basename(nd) === ROOT_DIR_NAME ? nd : null;
}

/**
 * What a completed todo still waits for, or null when nothing: `changes` (a review asked for
 * changes), and in team mode `review` (no APPROVE yet) and `unmerged` (approved, not on the default
 * branch yet). `todoState` calls this for a todo with ai_completed.md.
 */
export function reviewGate(todoDir: string, checkMerge = true): 'changes' | 'review' | 'unmerged' | null {
  const verdict = reviewVerdict(todoDir);
  if (verdict === 'CHANGES') return 'changes';
  const nd = openTodoNd(todoDir);
  if (nd === null) return null;
  if (verdict === null && reviewIsPartial(todoDir)) return 'review';
  if (!teamMode(nd)) return null;
  if (verdict !== 'APPROVE') return 'review';
  if (!checkMerge) return null;
  // One run asks this many times per todo (status, links, the sweep, the lists); the history does
  // not move under it, so the answer is kept for the run.
  let answer = todoMergedCache.get(todoDir);
  if (answer === undefined) {
    answer = merged(dirname(nd), todoDir).merged;
    todoMergedCache.set(todoDir, answer);
  }
  return answer ? null : 'unmerged';
}

const mergedCache = new Map<string, boolean | null>();
const todoMergedCache = new Map<string, boolean>();
const repositoryCache = new Map<string, { inGit: boolean; branch: string | null; configured: string | null }>();

/** Whether the project is in git, its default branch, and the setting that named it — asked once per run. */
function repository(root: string): { inGit: boolean; branch: string | null; configured: string | null } {
  const known = repositoryCache.get(root);
  if (known) return known;
  const setting = readManifest(join(root, ROOT_DIR_NAME))?.defaultBranch;
  const configured = typeof setting === 'string' && setting.trim() !== '' ? setting.trim() : null;
  const inGit = headSummary(root) !== null;
  const answer = { inGit, branch: inGit ? defaultBranch(root, configured) : null, configured };
  repositoryCache.set(root, answer);
  return answer;
}

/** Is `hash` in the history of the default branch of the repository at `path`? Null: git cannot tell. */
function onDefault(path: string, hash: string, nested: boolean, configured: string | null): boolean | null {
  const key = `${path}\0${hash}`;
  if (mergedCache.has(key)) return mergedCache.get(key)!;
  const branch = defaultBranch(path, configured, nested);
  const answer = branch === null ? null : isAncestor(path, hash, branch, nested);
  mergedCache.set(key, answer);
  return answer;
}

export type MergeCheck = { merged: boolean; missing: string[]; why: string | null };

/**
 * Whether a todo's work is on the default branch (decision of 2026-11-10, batch 2026-11-10_1): every
 * commit its record names is in the history of its repository's default branch; a record that
 * names none is itself committed there. Outside git there is nothing to check: merged.
 */
export function merged(root: string, todoDir: string): MergeCheck {
  const record = join(todoDir, RECORD_COMPLETED);
  const text = existsSync(record) ? readFileSync(record, 'utf8') : '';
  const refs = commitRefsIn(readField(text, 'Commits') ?? '');
  const { inGit, branch, configured } = repository(root);
  if (!inGit) return { merged: true, missing: [], why: null };
  if (branch === null) return { merged: false, missing: [], why: 'git cannot name the default branch — set "defaultBranch" in novadev.json' };
  if (refs.length === 0) {
    const on = fileOnBranch(root, branch, relative(root, record));
    return on === true ? { merged: true, missing: [], why: null } : { merged: false, missing: [], why: 'the record names no commit, and it is not committed on the default branch yet' };
  }
  const repos = listSubrepos(root).repos;
  const missing: string[] = [];
  for (const ref of refs) {
    if (ref.repo === null) {
      if (onDefault(root, ref.hash, false, configured) !== true) missing.push(ref.text);
      continue;
    }
    const repo = repos.find((r) => r.name === ref.repo);
    if (repo === undefined || onDefault(repo.path, ref.hash, true, null) !== true) missing.push(ref.text);
  }
  return missing.length === 0
    ? { merged: true, missing, why: null }
    : { merged: false, missing, why: `not on the default branch yet: ${missing.join(', ')}` };
}

/** What a review says, as `novadev todo review` takes it. */
export type ReviewInput = { verdict: Verdict; by: string; checks: string[]; findings: string | null; notes: string | null };

/** Read a review payload: { verdict, by, checks: [ "…" | { check, result } ], findings?, notes? }. */
export function parseReviewPayload(payload: Record<string, unknown>): ReviewInput {
  const verdict = parseVerdict(typeof payload.verdict === 'string' ? payload.verdict : null);
  if (verdict === null) throw new Error(`'verdict' must be ${VERDICTS.join(' or ')}.`);
  const by = typeof payload.by === 'string' ? payload.by.trim() : '';
  if (by === '') throw new Error("'by' must name the reviewer: an actor (claude-code/<model>, human:<id>) or \"human\".");
  const raw = payload.checks;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw.trim() !== '' ? [raw] : [];
  const checks = list.map((item) => {
    if (typeof item === 'string' && item.trim() !== '') return item.trim();
    if (item !== null && typeof item === 'object' && typeof (item as Record<string, unknown>).check === 'string') {
      const { check, result } = item as { check: string; result?: unknown };
      return `\`${check.trim()}\` — ${typeof result === 'string' && result.trim() !== '' ? result.trim() : 'no result given'}`;
    }
    throw new Error("Each of 'checks' is a line, or { \"check\": the command or what was looked at, \"result\": what it gave }.");
  });
  if (checks.length === 0) throw new Error("'checks' must list what the reviewer ran or looked at, with the results — a verdict without them is not a review.");
  const text = (key: string) => (typeof payload[key] === 'string' && (payload[key] as string).trim() !== '' ? (payload[key] as string).trim() : null);
  if (verdict === 'CHANGES' && text('findings') === null) throw new Error("A CHANGES verdict needs 'findings': what has to change.");
  return { verdict, by, checks, findings: text('findings'), notes: text('notes') };
}

/**
 * The ai_review.md a review writes. `more` is what a project with area owners adds (owners.ts): the
 * verdict as it is written when the approval is not complete, and the lines after the reviewer.
 */
export function renderReview(todo: string, date: string, review: ReviewInput, more: { verdict?: string; fields?: readonly string[] } = {}): string {
  return [
    `# ai_review — ${todo}`,
    '',
    `**Date:** ${date}`,
    `**Verdict:** ${more.verdict ?? review.verdict}`,
    `**Reviewer:** ${review.by}`,
    ...(more.fields ?? []),
    '',
    '## Checks',
    '',
    ...review.checks.map((check) => `- ${check.replace(/\n/g, '\n  ')}`),
    '',
    '## Findings',
    '',
    review.findings ?? 'None.',
    ...(review.notes === null ? [] : ['', '## Notes', '', review.notes]),
    '',
  ].join('\n');
}
