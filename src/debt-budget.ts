// The debt budget: the most known debt a project accepts, and how a record raises it.
//
// The same idea as a framework baseline, one level up: known debt over `debtBudget.maxKnown`
// fails `novadev sync --check` unless a record raises the budget in a `## Debt` section, with a
// reason. Plain `sync` then writes the raise into novadev.json and remembers it in
// `debtBudget.raises`. The rules that keep that safe:
//
//   - a raise starts at the CURRENT budget (`**Raise:** 230 → 238`), or it is not applied — a raise
//     written against an older budget never overrides a change made since;
//   - it is applied only when the measured debt is over the budget, and never above that measured
//     debt — one record cannot switch the gate off for later growth;
//   - the ledger remembers each raise by its record and its two numbers, so an unchanged record
//     never applies twice, even after someone lowers the budget again.
//
// The `## Debt` section also explains growth: sync stops listing a hub that grew once a record of
// this round names it there. The metrics that measure the debt are metrics.ts.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  RECORD_COMPLETED,
  RECORD_FAILED,
  RECORD_PROGRESS,
  type Parsed,
  byCodePoint,
  fencedLines,
  isCount,
  isPlainObject,
  listAllTodos,
  readManifest,
  refuse,
  writeManifest,
} from './lib.ts';

/** The work records a `## Debt` section may sit in — never a brief, never a test gate. */
export const DEBT_RECORDS = [RECORD_COMPLETED, RECORD_PROGRESS, RECORD_FAILED] as const;

/**
 * One applied raise: which record asked, the budget it started from, the value it asked for, and
 * when. `applied` is the budget it set, when that is lower than `to` (a raise stops at the measured
 * debt).
 */
export type BudgetRaise = { by: string; from: number; to: number; applied?: number; on: string };
export type DebtBudget = { maxKnown: number; raises: BudgetRaise[] };
/** A `## Debt` raise found in a record. */
export type RecordRaise = { ref: string; file: string; from: number; to: number };

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
 * Each `## Debt` section of a record, as lines, up to the next level-1/2 heading. Fenced code is
 * blanked first, so a record QUOTING the format is never read as a real section.
 */
export function debtSections(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const fenced = fencedLines(lines);
  const sections: string[][] = [];
  let current: string[] | null = null;
  lines.forEach((line, i) => {
    if (fenced[i]) {
      current?.push('');
    } else if (/^ {0,3}##[ \t]+Debt\b/i.test(line)) {
      current = [];
      sections.push(current);
    } else if (/^ {0,3}#{1,2}[ \t]/.test(line)) {
      current = null;
    } else {
      current?.push(line);
    }
  });
  return sections;
}

/** The label of a raise line: `**Raise:**`, and the near-misses people write (`**Raise**:`, a bullet). */
const RAISE_LABEL = /^ {0,3}(?:[-*+][ \t]+)?(?:\*\*|__|\*|_)?raise(?:\*\*|__|\*|_)?[ \t]*:(?:\*\*|__|\*|_)?/i;
/** A whole number: 238, 1,238 or 1_238 — never "1 238" or "1.238", which read differently by country. */
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+|\d{1,3}(?:_\d{3})+|\d+`;
/** What may not follow a number: more digits after a dot or comma, or a space-separated group of three. */
const NUMBER_END = String.raw`(?![.,]?\d)(?![ \t  ]\d{3}(?!\d))`;
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
 * value that is not `<from> → <to>`, a "raise" that does not go up, or no reason.
 */
export function debtRaiseIn(text: string): { from: number; to: number } | { error: string } | null {
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
  const value = section[index]!.replace(RAISE_LABEL, '').trim();
  const match = RAISE_VALUE.exec(value);
  if (!match) return { error: `the "**Raise:**" line in "## Debt" ${RAISE_FORMAT}` };
  const from = toCount(match[1]!);
  const to = toCount(match[2]!);
  if (to <= from) {
    return {
      error: `"**Raise:** ${from} → ${to}" does not raise the budget — the new budget must be higher than the old one (to lower the budget, edit "maxKnown" in novadev.json)`,
    };
  }
  const elsewhere = section.filter((_, i) => i !== index).join('\n');
  if (!hasWords(match[3] ?? '') && !hasWords(elsewhere)) {
    return {
      error: `"## Debt" raises the budget to ${to} but gives no reason — write why the debt grew (the raise is not applied until then)`,
    };
  }
  return { from, to };
}

/** True when the text says something: a letter, once comments and unfilled `<placeholders>` are gone. */
function hasWords(text: string): boolean {
  return /\p{L}/u.test(text.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^<>\n]*>/g, ''));
}

/**
 * Every `## Debt` raise in the work records of todos still in `todos/`. An archived record is
 * history: its raise was applied by a sync while its batch waited out the grace period there.
 * Reading the archive too would let a budget that was switched off (and its `raises` list lost)
 * come back on with every old raise applied at once.
 */
export function collectRaises(nd: string): { raises: RecordRaise[]; problems: string[] } {
  const raises: RecordRaise[] = [];
  const problems: string[] = [];
  for (const record of openRecords(nd)) {
    const found = debtRaiseIn(record.text);
    if (found === null) continue;
    if ('error' in found) problems.push(`${record.ref}/${record.file}: ${found.error}`);
    else raises.push({ ref: record.ref, file: record.file, ...found });
  }
  return { raises, problems };
}

/**
 * What the `## Debt` sections of open work records say, one entry per record that has words in
 * one. With `only`, just the records at those absolute paths (the ones changed in this round).
 */
export function debtNotes(nd: string, only?: ReadonlySet<string>): { ref: string; text: string }[] {
  const out: { ref: string; text: string }[] = [];
  for (const record of openRecords(nd)) {
    if (only && !only.has(resolve(record.path))) continue;
    const text = debtSections(record.text)
      .map((section) => section.join('\n'))
      .join('\n');
    if (hasWords(text)) out.push({ ref: record.ref, text });
  }
  return out;
}

/** The work records of the todos still in `todos/`. */
function openRecords(nd: string): { ref: string; file: string; path: string; text: string }[] {
  const out: { ref: string; file: string; path: string; text: string }[] = [];
  for (const todo of listAllTodos(nd)) {
    if (todo.archived) continue;
    for (const file of DEBT_RECORDS) {
      const path = join(todo.dir, file);
      if (existsSync(path)) out.push({ ref: todo.ref, file, path, text: readFileSync(path, 'utf8') });
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
  /** Known debt is within the budget: nothing to raise yet. It stays pending. */
  | { status: 'not-needed'; raise: RecordRaise }
  /** There is no debt count to check it against. It stays pending. */
  | { status: 'unmeasured'; raise: RecordRaise };

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
    if (raise.from !== budget.maxKnown) {
      outcomes.push({ status: 'stale', raise });
    } else if (known === null) {
      outcomes.push({ status: 'unmeasured', raise });
    } else if (known <= budget.maxKnown) {
      outcomes.push({ status: 'not-needed', raise });
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
  const manifest = readManifest(nd) ?? {};
  const previous = isPlainObject(manifest.debtBudget) ? manifest.debtBudget : {};
  manifest.debtBudget = { ...previous, maxKnown: budget.maxKnown, raises: budget.raises };
  writeManifest(nd, manifest);
}

function toCount(text: string): number {
  return Number(text.replace(/[,_]/g, ''));
}
