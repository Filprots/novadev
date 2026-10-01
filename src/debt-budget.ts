// The debt budget: the most known debt a project accepts, and how a record raises it.
//
// The same idea as a framework baseline, one level up: known debt over `debtBudget.maxKnown`
// fails `novadev sync --check` unless a record raises the budget in a `## Debt` section, with a
// reason. Plain `sync` then writes the raise into novadev.json and remembers it in
// `debtBudget.raises`, so each raise is applied exactly once — an old record can never loosen a
// budget someone lowered later. The metrics that measure the debt are metrics.ts.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RECORD_COMPLETED,
  RECORD_FAILED,
  RECORD_PROGRESS,
  type Parsed,
  byCodePoint,
  isCount,
  isPlainObject,
  listAllTodos,
  readManifest,
  refuse,
  writeManifest,
} from './lib.ts';

/** The work records a `## Debt` raise may sit in — never a brief, never a test gate. */
export const DEBT_RECORDS = [RECORD_COMPLETED, RECORD_PROGRESS, RECORD_FAILED] as const;

/** One applied raise: which record asked, the budget before, the value it asked for, and when. */
export type BudgetRaise = { by: string; from: number; to: number; on: string };
export type DebtBudget = { maxKnown: number; raises: BudgetRaise[] };
/** A `## Debt` raise found in a record. */
export type RecordRaise = { ref: string; file: string; from?: number; to: number };

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
      typeof entry.on !== 'string'
    ) {
      return refuse(
        `"debtBudget.raises[${i}]" must look like { "by": "<batch>/<todo>", "from": 230, "to": 238, "on": "YYYY-MM-DD" } — novadev sync writes these`,
      );
    }
    raises.push({ by: entry.by, from: entry.from, to: entry.to, on: entry.on });
  }
  return { ok: true, value: { maxKnown: raw.maxKnown, raises } };
}

// ---------------------------------------------------------------------------
// Budget raises in records
// ---------------------------------------------------------------------------

/**
 * The `## Debt` raise in one record, if it has one:
 *
 *   ## Debt
 *   **Raise:** 230 → 238
 *   <why the debt grew, why it cannot be avoided now, and what would reduce it again>
 *
 * Returns null when there is no raise (no section, or a section with no `**Raise:**` line — that
 * is a record merely talking about debt). A raise without a number or without a reason is an
 * error: it is never applied.
 */
export function debtRaiseIn(text: string): { from?: number; to: number } | { error: string } | null {
  const body = debtSection(text);
  if (body === null) return null;
  const lines = body.split('\n');
  const index = lines.findIndex((line) => /^\s*\*\*Raise:\*\*/i.test(line));
  if (index === -1) return null;
  const value = lines[index]!.replace(/^\s*\*\*Raise:\*\*/i, '').trim();

  let from: number | undefined;
  let to: number;
  const pair = value.match(/^(\d[\d,_]*)\s*(?:→|->|=>|\bto\b)\s*(\d[\d,_]*)/i);
  const single = value.match(/^(\d[\d,_]*)/);
  if (pair) {
    from = toCount(pair[1]!);
    to = toCount(pair[2]!);
  } else if (single) {
    to = toCount(single[1]!);
  } else {
    return { error: 'the "**Raise:**" line in "## Debt" needs the new budget, like `**Raise:** 230 → 238`' };
  }

  const reason = lines
    .filter((_, i) => i !== index)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^<>\n]*>/g, '') // an unfilled template placeholder is not a reason
    .trim();
  if (reason === '') {
    return {
      error: `"## Debt" raises the budget to ${to} but gives no reason — write why the debt grew (the raise is not applied until then)`,
    };
  }
  return from === undefined ? { to } : { from, to };
}

/** The text under a `## Debt` heading, up to the next level-1/2 heading. Code fences are ignored. */
function debtSection(text: string): string | null {
  const lines = withoutFences(text.replace(/\r\n?/g, '\n')).split('\n');
  const start = lines.findIndex((line) => /^##[ \t]+Debt\b/i.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}[ \t]/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Blank out fenced code blocks, so a record QUOTING the format is not read as a real raise. */
function withoutFences(text: string): string {
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
      if (fence === null) {
        if (marker) {
          fence = marker[0]!;
          return '';
        }
        return line;
      }
      if (marker && marker[0] === fence) fence = null;
      return '';
    })
    .join('\n');
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
  for (const todo of listAllTodos(nd)) {
    if (todo.archived) continue;
    for (const file of DEBT_RECORDS) {
      const path = join(todo.dir, file);
      if (!existsSync(path)) continue;
      const found = debtRaiseIn(readFileSync(path, 'utf8'));
      if (found === null) continue;
      if ('error' in found) problems.push(`${todo.ref}/${file}: ${found.error}`);
      else raises.push({ ref: todo.ref, file, ...found });
    }
  }
  return { raises, problems };
}

/**
 * Raises the budget has not seen yet. A raise is identified by the record that asks (its stable
 * ref) and the value it asks for, so a record that later asks for a different value counts again.
 * Lowest value first, so several raises in one round apply in a readable order.
 */
export function pendingRaises(budget: DebtBudget, raises: readonly RecordRaise[]): RecordRaise[] {
  const key = (by: string, to: number) => `${by}\u0000${to}`;
  const seen = new Set(budget.raises.map((r) => key(r.by, r.to)));
  const pending = new Map<string, RecordRaise>();
  for (const raise of raises) {
    const k = key(raise.ref, raise.to);
    if (!seen.has(k) && !pending.has(k)) pending.set(k, raise);
  }
  return [...pending.values()].sort((a, b) => a.to - b.to || byCodePoint(a.ref, b.ref));
}

/** The budget after the pending raises: never lower than before, every raise remembered. */
export function applyRaises(budget: DebtBudget, pending: readonly RecordRaise[], today: string): DebtBudget {
  let maxKnown = budget.maxKnown;
  const raises = [...budget.raises];
  for (const raise of pending) {
    raises.push({ by: raise.ref, from: maxKnown, to: raise.to, on: today });
    maxKnown = Math.max(maxKnown, raise.to);
  }
  return { maxKnown, raises };
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
