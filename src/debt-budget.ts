// The debt budget: the most known debt a project accepts, and how a record raises it.
//
// The same idea as a framework baseline, one level up: known debt over `debtBudget.maxKnown`
// fails `novadev sync --check` unless a record of THIS ROUND raises the budget in a `## Debt`
// section, with a reason. Plain `sync` then writes the raise into novadev.json and remembers it in
// `debtBudget.raises`. `sync --check` fails until it has: a raise that is committed before sync
// writes it no longer counts. The rules that keep that safe:
//
//   - a raise counts only in the round it is written in. With git, a raise line the last commit
//     already holds (the same two numbers, in any of the todo's work records) is from an earlier
//     round, and it is not applied — whatever else in the record changed since. Without git, sync
//     cannot tell one round from the next, so a raise that is not needed when sync first judges it
//     is used up (the ledger notes it with "applied" equal to the budget it found);
//   - a raise starts at the CURRENT budget (`**Raise:** 230 → 238`), or it is not applied — a raise
//     written against an older budget never overrides a change made since;
//   - it is applied only when the measured debt is over the budget, and never above that measured
//     debt — one record cannot switch the gate off for later growth;
//   - the ledger remembers each raise by its record and its two numbers, so an unchanged record
//     never applies twice, even after someone lowers the budget again.
//
// The `## Debt` section also explains growth: sync stops listing it once a record says why in this
// round's own words — the lines the last commit does not hold. The metrics that measure the debt
// are metrics.ts.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileAtHead, unchangedSinceHead } from './git.ts';
import {
  RECORD_COMPLETED,
  RECORD_FAILED,
  RECORD_PROGRESS,
  ROOT_DIR_NAME,
  type Parsed,
  byCodePoint,
  isCount,
  isPlainObject,
  listAllTodos,
  proseLines,
  readManifest,
  refuse,
  writeManifest,
} from './lib.ts';

/** The work records a `## Debt` section may sit in — never a brief, never a test gate. */
export const DEBT_RECORDS = [RECORD_COMPLETED, RECORD_PROGRESS, RECORD_FAILED] as const;

/**
 * One raise sync has judged: which record asked, the budget it started from, the value it asked
 * for, and when. `applied` is the budget it set, when that is lower than `to`: a raise stops at the
 * measured debt, and a raise used up while it was not needed (no git) set the budget it found.
 */
export type BudgetRaise = { by: string; from: number; to: number; applied?: number; on: string };
export type DebtBudget = { maxKnown: number; raises: BudgetRaise[] };

/**
 * Which round a raise belongs to. `this`: the last commit does not hold it (or there is no commit
 * yet). `earlier`: the last commit already holds the same raise line. `unknown`: there is no git to
 * ask.
 */
export type RecordRound = 'this' | 'earlier' | 'unknown';
/** A `## Debt` raise found in a record. A raise without a `round` counts as this round's. */
export type RecordRaise = { ref: string; file: string; from: number; to: number; round?: RecordRound };
/** A record whose `**Raise:**` line cannot be read for certain. */
export type BrokenRaise = { ref: string; file: string; error: string; round?: RecordRound };
/** What one record's `## Debt` section holds: a raise, a raise line that cannot be read, or none. */
export type RaiseRead = { from: number; to: number } | { error: string } | null;
/** One work record of a todo still in `todos/`. */
export type WorkRecord = { ref: string; dir: string; file: string; path: string; text: string };

/** `debtBudget` from novadev.json: `{ "maxKnown": N, "raises": [...] }`. */
export function parseBudget(raw: unknown): Parsed<DebtBudget> {
  if (!isPlainObject(raw)) {
    return refuse('"debtBudget" must be an object like { "maxKnown": 230 }, or null to turn it off');
  }
  if (!isCount(raw.maxKnown)) {
    return refuse('"debtBudget.maxKnown" must be a whole number, 0 or more');
  }
  const raises: BudgetRaise[] = [];
  const rawRaises = raw.raises ?? [];
  if (!Array.isArray(rawRaises)) return refuse('"debtBudget.raises" must be a list');
  for (const [i, entry] of rawRaises.entries()) {
    if (
      !isPlainObject(entry) ||
      typeof entry.by !== 'string' ||
      entry.by.trim() === '' ||
      !isCount(entry.from) ||
      !isCount(entry.to) ||
      (entry.applied !== undefined && !isCount(entry.applied)) ||
      typeof entry.on !== 'string'
    ) {
      return refuse(
        `"debtBudget.raises[${i}]" must look like { "by": "<batch>/<todo>", "from": 230, "to": 238, "on": "YYYY-MM-DD" } — novadev sync writes these`,
      );
    }
    raises.push({
      by: entry.by,
      from: entry.from,
      to: entry.to,
      ...(entry.applied === undefined ? {} : { applied: entry.applied }),
      on: entry.on,
    });
  }
  return { ok: true, value: { maxKnown: raw.maxKnown, raises } };
}

// ---------------------------------------------------------------------------
// The `## Debt` section of a record
// ---------------------------------------------------------------------------

/**
 * Each `## Debt` section of a record, as lines, up to the next level-1/2 heading. Fenced code and
 * HTML comments are blanked first, so a record QUOTING the format, or keeping an old raise in a
 * comment, is never read as a real section.
 */
export function debtSections(text: string): string[][] {
  const lines = proseLines(text.replace(/\r\n?/g, '\n').split('\n'));
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^ {0,3}##[ \t]+Debt\b/i.test(line)) {
      current = [];
      sections.push(current);
    } else if (/^ {0,3}#{1,2}[ \t]/.test(line)) {
      current = null;
    } else {
      current?.push(line);
    }
  }
  return sections;
}

const EMPHASIS = String.raw`(?:\*\*|__|\*|_)?`;
const QUOTE = String.raw`((?:>[ \t]?)*)`;
/**
 * The label of a raise line: `**Raise:**`, and the near-misses people write — `**Raise**:`, no
 * bold, in a bullet or a numbered item. A `>` before it makes it a quote (groups 1 and 2), which is
 * reported and never read: a quote may hold someone else's raise.
 */
const RAISE_LABEL = new RegExp(
  String.raw`^ {0,3}${QUOTE}(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?${QUOTE}${EMPHASIS}raise${EMPHASIS}[ \t]*:${EMPHASIS}`,
  'i',
);
/** A whole number: 238, 1,238 or 1_238 — never "1 238" or "1.238", which read differently by country. */
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+|\d{1,3}(?:_\d{3})+|\d+`;
/** What may not follow a number: more digits after a dot or comma, or a space-separated group of three. */
const NUMBER_END = String.raw`(?![.,]?\d)(?![ \t\u00a0\u202f]\d{3}(?!\d))`;
/** `<from> <arrow> <to>`, then anything (a reason may follow on the same line). */
const RAISE_VALUE = new RegExp(
  String.raw`^(${NUMBER})${NUMBER_END}[ \t]*(?:→|⟶|⇒|->|=>|–|—|to\b)[ \t]*(${NUMBER})${NUMBER_END}(.*)$`,
  'i',
);
const RAISE_FORMAT =
  'must look like `**Raise:** 230 → 238` — the budget now, an arrow, then the new budget, in whole numbers';

/**
 * The raise in one record's `## Debt` section, if it has one:
 *
 *   ## Debt
 *   **Raise:** 230 → 238
 *   <why the debt grew, why it cannot be avoided now, and what would reduce it again>
 *
 * The reason may also follow the numbers on the raise line itself. Returns null when there is no
 * raise (no section, or a section with no raise line — a record merely talking about debt). Any
 * raise line that cannot be read for certain is an error and is never applied: two raise lines, a
 * raise line in a quote, a value that is not `<from> → <to>`, a "raise" that does not go up, or no
 * reason.
 */
export function debtRaiseIn(text: string): RaiseRead {
  const found: { section: string[]; index: number }[] = [];
  for (const section of debtSections(text)) {
    section.forEach((line, index) => {
      if (RAISE_LABEL.test(line)) found.push({ section, index });
    });
  }
  if (found.length === 0) return null;
  if (found.length > 1) {
    return { error: `"## Debt" has ${found.length} "**Raise:**" lines — keep only one` };
  }
  const { section, index } = found[0]!;
  const label = RAISE_LABEL.exec(section[index]!)!;
  if (label[1] || label[2]) {
    return {
      error: 'the "**Raise:**" line in "## Debt" is inside a quote (">"), so it is not read — write it on a line of its own, without ">"',
    };
  }
  const value = section[index]!.slice(label[0].length).trim();
  const match = RAISE_VALUE.exec(value);
  if (!match) return { error: `the "**Raise:**" line in "## Debt" ${RAISE_FORMAT}` };
  const from = toCount(match[1]!);
  const to = toCount(match[2]!);
  if (to <= from) {
    return {
      error: `"**Raise:** ${from} → ${to}" does not raise the budget — the new budget must be higher than the old one (to lower the budget, edit "maxKnown" in novadev.json)`,
    };
  }
  if (!saysWhy([match[3] ?? '', ...section.filter((_, i) => i !== index)])) {
    return {
      error: `"## Debt" raises the budget to ${to} but gives no reason — write why the debt grew (the raise is not applied until then)`,
    };
  }
  return { from, to };
}

/**
 * True when `## Debt` lines say WHY: words beyond a raise line's label and numbers, and more than
 * an answer that there is nothing to say ("None.", "No new debt.", "n/a").
 */
export function saysWhy(lines: readonly string[]): boolean {
  const text = reasonText(lines);
  return hasWords(text) && !emptyAnswer(text);
}

/** The text of `## Debt` lines that can give a reason: of a raise line, only what follows its numbers. */
function reasonText(lines: readonly string[]): string {
  return lines
    .map((line) => {
      const label = RAISE_LABEL.exec(line);
      if (!label) return line;
      const value = line.slice(label[0].length).trim();
      return RAISE_VALUE.exec(value)?.[3] ?? value;
    })
    .join('\n');
}

/** True when the text says something: a letter, once comments and unfilled `<placeholders>` are gone. */
function hasWords(text: string): boolean {
  return /\p{L}/u.test(withoutMarkup(text));
}

function withoutMarkup(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^<>\n]*>/g, ' ');
}

/** The words that answer "no": a `## Debt` text needs one of them to be an empty answer. */
const NO_WORDS = new Set(['no', 'none', 'nothing', 'nil', 'not', 'n/a', 'na', 'zero', '0', 'without', 'nope']);
/** Words that only fill out such an answer: "No new debt was added in this round." */
const FILLER_WORDS = new Set([
  'a', 'add', 'added', 'adds', 'additional', 'all', 'an', 'any', 'applicable', 'are', 'at', 'be',
  'been', 'budget', 'ca', 'change', 'changed', 'changes', 'debt', 'debts', 'did', 'do', 'does',
  'else', 'explain', 'extra', 'far', 'finding', 'findings', 'for', 'grew', 'grow', 'growth', 'had',
  'has', 'have', 'here', 'i', 'in', 'increase', 'increased', 'introduce', 'introduced', 'introduces',
  'is', 'it', 'just', 'known', 'more', 'need', 'needed', 'net', 'new', 'of', 'only', 'raise',
  'raised', 'report', 'round', 'say', 'so', 'task', 'that', 'the', 'there', 'this', 'time', 'to',
  'today', 'todo', 'was', 'we', 'were', 'wo', 'work', 'yet',
]);

/**
 * True when every sentence of the text only says there is nothing to explain — "None.", "No new
 * debt was added.", "n/a" — and so explains nothing.
 */
function emptyAnswer(text: string): boolean {
  const sentences = withoutMarkup(text)
    .toLowerCase()
    .replace(/n['’]t\b/g, ' not')
    .split(/[\n.;!?]+/)
    .map((sentence) => sentence.match(/[\p{L}\p{N}]+(?:\/[\p{L}\p{N}]+)*/gu) ?? [])
    .filter((words) => words.length > 0);
  return (
    sentences.length > 0 &&
    sentences.every(
      (words) => words.some((w) => NO_WORDS.has(w)) && words.every((w) => NO_WORDS.has(w) || FILLER_WORDS.has(w)),
    )
  );
}

// ---------------------------------------------------------------------------
// Records, and what the last commit holds of them
// ---------------------------------------------------------------------------

/**
 * Every `## Debt` raise in the work records of todos still in `todos/`. The archive is not read:
 * a batch moves there days after its raises were applied, and reading it would let a budget that
 * was switched off (and its `raises` list lost) come back on with every old raise applied at once.
 *
 * With `history` (see `recordHistory`), each raise says which round it belongs to.
 */
export function collectRaises(
  nd: string,
  history?: RecordHistory,
): { raises: RecordRaise[]; problems: string[]; broken: BrokenRaise[] } {
  const raises: RecordRaise[] = [];
  const problems: string[] = [];
  const broken: BrokenRaise[] = [];
  for (const record of openRecords(nd)) {
    const found = debtRaiseIn(record.text);
    if (found === null) continue;
    const round = history ? { round: history.roundOf(record, found) } : {};
    if ('error' in found) {
      problems.push(`${record.ref}/${record.file}: ${found.error}`);
      broken.push({ ref: record.ref, file: record.file, error: found.error, ...round });
    } else {
      raises.push({ ref: record.ref, file: record.file, ...found, ...round });
    }
  }
  return { raises, problems, broken };
}

/**
 * What the last commit holds of the open work records, so this round's words can be told from an
 * earlier round's. A record is judged by its `## Debt` lines, not by its file: the playbook's own
 * close-out adds a **Commits:** line after the commit, records flip from ai_progress.md to
 * ai_completed.md, and old records get review notes — none of that makes an old raise or an old
 * explanation count again.
 */
export type RecordHistory = {
  /** `earlier` when the last commit holds the same raise line (the same numbers, or the same error). */
  roundOf(record: WorkRecord, raise: NonNullable<RaiseRead>): RecordRound;
  /** The `## Debt` lines this round wrote in a record — those the last commit does not hold. Null when git cannot tell. */
  freshDebtLines(record: WorkRecord): string[] | null;
};

/**
 * git is asked lazily: which record files are unchanged since the last commit (one call, for every
 * record), and — only for a record that changed — what the last commit holds of its todo's work
 * records, any of the three files. Without git every raise is `unknown`, and no line is known to be
 * old.
 */
export function recordHistory(root: string): RecordHistory {
  let unchanged: Set<string> | null | undefined;
  const committed = new Map<string, string[]>();
  const unchangedFiles = (): Set<string> | null => {
    if (unchanged === undefined) unchanged = unchangedSinceHead(root, `${ROOT_DIR_NAME}/todos`);
    return unchanged;
  };
  const committedTexts = (dir: string): string[] => {
    let texts = committed.get(dir);
    if (texts === undefined) {
      texts = [];
      for (const file of DEBT_RECORDS) {
        const text = fileAtHead(root, relative(root, join(dir, file)));
        if (text !== null) texts.push(text);
      }
      committed.set(dir, texts);
    }
    return texts;
  };
  return {
    roundOf(record, raise) {
      const same = unchangedFiles();
      if (same === null) return 'unknown';
      if (same.has(resolve(record.path))) return 'earlier';
      return committedTexts(record.dir).some((text) => sameRaise(debtRaiseIn(text), raise)) ? 'earlier' : 'this';
    },
    freshDebtLines(record) {
      const lines = debtSections(record.text).flat();
      if (lines.every((line) => line.trim() === '')) return [];
      const same = unchangedFiles();
      if (same === null) return null;
      if (same.has(resolve(record.path))) return [];
      return withoutLines(lines, committedTexts(record.dir).flatMap((text) => debtSections(text).flat()));
    },
  };
}

/** The same raise line: the same two numbers, or the same reason it cannot be read. */
function sameRaise(a: RaiseRead, b: RaiseRead): boolean {
  if (a === null || b === null) return false;
  if ('error' in a || 'error' in b) return 'error' in a && 'error' in b && a.error === b.error;
  return a.from === b.from && a.to === b.to;
}

/** The lines of `lines` that `old` does not hold, line for line, spaces around them ignored. */
function withoutLines(lines: readonly string[], old: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const line of old) {
    const key = line.trim();
    if (key !== '') left.set(key, (left.get(key) ?? 0) + 1);
  }
  return lines.filter((line) => {
    const key = line.trim();
    if (key === '') return false;
    const count = left.get(key) ?? 0;
    if (count === 0) return true;
    left.set(key, count - 1);
    return false;
  });
}

/**
 * What the `## Debt` sections of open work records say, one entry per record that says why (see
 * `saysWhy`). With `history`, only this round's lines count — the lines the last commit does not
 * hold — so an old record edited for another reason never explains new growth.
 */
export function debtNotes(nd: string, history?: RecordHistory): { ref: string; text: string }[] {
  const out: { ref: string; text: string }[] = [];
  for (const record of openRecords(nd)) {
    const lines = history?.freshDebtLines(record) ?? debtSections(record.text).flat();
    if (saysWhy(lines)) out.push({ ref: record.ref, text: reasonText(lines) });
  }
  return out;
}

/** The work records of the todos still in `todos/`. */
function openRecords(nd: string): WorkRecord[] {
  const out: WorkRecord[] = [];
  for (const todo of listAllTodos(nd)) {
    if (todo.archived) continue;
    for (const file of DEBT_RECORDS) {
      const path = join(todo.dir, file);
      if (existsSync(path)) {
        out.push({ ref: todo.ref, dir: todo.dir, file, path, text: readFileSync(path, 'utf8') });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The ledger and the plan
// ---------------------------------------------------------------------------

/** A raise is identified by its record and the two numbers it states. */
function raiseKey(by: string, from: number, to: number): string {
  return `${by}\u0000${from}\u0000${to}`;
}

/** The ledger entry for this record's raise with these numbers, if the ledger holds one. */
export function ledgerEntryFor(budget: DebtBudget, raise: RecordRaise): BudgetRaise | undefined {
  return budget.raises.find((r) => raiseKey(r.by, r.from, r.to) === raiseKey(raise.ref, raise.from, raise.to));
}

/**
 * Raises the ledger has not seen yet — one per record and numbers, lowest value first, so several
 * raises in one round apply in a readable order. A record whose raise is edited to new numbers
 * counts again: the edit is a new, visible request.
 */
export function pendingRaises(budget: DebtBudget, raises: readonly RecordRaise[]): RecordRaise[] {
  const pending = new Map<string, RecordRaise>();
  for (const raise of raises) {
    const key = raiseKey(raise.ref, raise.from, raise.to);
    if (!ledgerEntryFor(budget, raise) && !pending.has(key)) pending.set(key, raise);
  }
  return [...pending.values()].sort((a, b) => a.to - b.to || byCodePoint(a.ref, b.ref));
}

/** What happens to one pending raise in this sync. */
export type RaiseOutcome =
  /** It raises the budget to `applied`: its value, or the measured debt when that is lower. */
  | { status: 'applied'; raise: RecordRaise; applied: number }
  /** Its `from` is not the current budget — written against an older budget, so not applied. */
  | { status: 'stale'; raise: RecordRaise }
  /**
   * Known debt is within the budget: nothing to raise. With git it waits for the rest of this
   * round. Without git it is `spent`: used up now, so it can never lift a later round's growth.
   */
  | { status: 'not-needed'; raise: RecordRaise; spent: boolean }
  /** There is no debt count to check it against. It stays pending. */
  | { status: 'unmeasured'; raise: RecordRaise }
  /** The last commit already holds it: a raise counts only in the round it is written in. */
  | { status: 'earlier'; raise: RecordRaise };

export type RaisePlan = { budget: DebtBudget; outcomes: RaiseOutcome[]; changed: boolean };

/**
 * The budget after the raises found in records, given the measured known debt (null when nothing
 * measures it). Every raise is judged against the budget as it stood BEFORE this sync, so two
 * raises written in the same round both count. The new budget is the highest applied value, and
 * never above the measured debt.
 */
export function planRaises(
  budget: DebtBudget,
  found: readonly RecordRaise[],
  known: number | null,
  today: string,
): RaisePlan {
  const outcomes: RaiseOutcome[] = [];
  const raises = [...budget.raises];
  let maxKnown = budget.maxKnown;
  for (const raise of pendingRaises(budget, found)) {
    const round = raise.round ?? 'this';
    if (round === 'earlier') {
      outcomes.push({ status: 'earlier', raise });
    } else if (raise.from !== budget.maxKnown) {
      outcomes.push({ status: 'stale', raise });
    } else if (known === null) {
      outcomes.push({ status: 'unmeasured', raise });
    } else if (known <= budget.maxKnown) {
      const spent = round === 'unknown';
      outcomes.push({ status: 'not-needed', raise, spent });
      if (spent) raises.push({ by: raise.ref, from: raise.from, to: raise.to, applied: raise.from, on: today });
    } else {
      const applied = Math.min(raise.to, known);
      outcomes.push({ status: 'applied', raise, applied });
      raises.push({
        by: raise.ref,
        from: raise.from,
        to: raise.to,
        ...(applied < raise.to ? { applied } : {}),
        on: today,
      });
      maxKnown = Math.max(maxKnown, applied);
    }
  }
  return { budget: { maxKnown, raises }, outcomes, changed: raises.length > budget.raises.length };
}

/** Write the budget into novadev.json, keeping every other setting (and any extra budget keys). */
export function writeBudget(nd: string, budget: DebtBudget): void {
  const manifest = readManifest(nd);
  // Never write over a manifest that cannot be read: it would drop every other setting.
  if (manifest === null) return;
  const previous = isPlainObject(manifest.debtBudget) ? manifest.debtBudget : {};
  manifest.debtBudget = { ...previous, maxKnown: budget.maxKnown, raises: budget.raises };
  writeManifest(nd, manifest);
}

function toCount(text: string): number {
  return Number(text.replace(/[,_]/g, ''));
}
