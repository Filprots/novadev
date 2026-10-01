// Everything about metrics that can be judged from the files alone, never by running the
// command: the settings, the stored snapshot, budget raises, and the generated wiki budgets block.
// `novadev sync` writes the block and reports the problems; `novadev doctor` reports both.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type DebtBudget, collectRaises, planRaises, recordRounds } from './debt-budget.ts';
import {
  type Fix,
  blockBegin,
  blockEnd,
  blockTrouble,
  byCodePoint,
  fenceRanges,
  findBlock,
  isMarkerLine,
  isNovadevManaged,
  listDirs,
  listFiles,
  manifestPath,
  novadevDir,
  readManifest,
  writeBlock,
} from './lib.ts';
import {
  METRICS_DIR,
  METRICS_SNAPSHOT,
  type MetricsView,
  type Snapshot,
  type SnapshotRead,
  describeRaise,
  fmt,
  metricsFolderIsFile,
  readMetricsConfig,
  readSnapshot,
} from './metrics.ts';

/** The generated wiki block: `<!-- novadev:budgets:begin -->` … `<!-- novadev:budgets:end -->`. */
export const BUDGETS_BLOCK = 'budgets';

export type MetricsAudit = { problems: string[]; notes: string[]; fixes: Fix[] };

/**
 * Everything about metrics that can be judged from the files alone — never runs the command.
 * `fixes` is the wiki budgets block, derived from the snapshot and the budget; `novadev sync`
 * writes it, `novadev doctor` reports it when it is stale.
 *
 * `view` is what sync is about to store (the fresh snapshot, the raised budget), so the block is
 * judged against what sync writes — in `--check` too, where nothing is written. Without it (doctor)
 * the files on disk are judged.
 */
export function auditMetrics(root: string, view?: MetricsView): MetricsAudit {
  const nd = novadevDir(root);
  const problems: string[] = [];
  const notes: string[] = [];
  const fixes: Fix[] = [];

  if (existsSync(manifestPath(nd)) && readManifest(nd) === null) {
    problems.push('novadev.json: not a valid JSON object — novadev cannot read its settings');
  }
  const config = readMetricsConfig(nd);
  problems.push(...config.problems);

  if (metricsFolderIsFile(nd)) {
    problems.push(
      `${METRICS_DIR}: a file, not a folder — novadev keeps its metrics snapshot in a folder of that name; move the file away`,
    );
  }

  const snapshot = view?.snapshot ?? readSnapshot(nd);
  // sync says this itself, as a NEXT ACTION: it may be about to write the file again, or be unable
  // to because the command fails. doctor never runs the command, so for doctor it is a problem.
  if (!view && snapshot.state === 'invalid') {
    problems.push(
      `${METRICS_DIR}/${METRICS_SNAPSHOT}: ${snapshot.error} — run \`novadev sync\` to write it again; if it holds merge-conflict markers and the metrics command cannot run, keep one side or delete the file`,
    );
  }
  // Something that is not a file where the snapshot belongs: sync never writes over it.
  if (snapshot.state === 'blocked') {
    problems.push(
      `${METRICS_DIR}/${METRICS_SNAPSHOT}: ${snapshot.error} — novadev keeps its snapshot in a plain file of that name; move it away`,
    );
  }
  for (const file of listFiles(join(nd, METRICS_DIR))) {
    if (file === METRICS_SNAPSHOT) continue;
    if (file === 'README.md' && isNovadevManaged(join(nd, METRICS_DIR, file))) continue;
    notes.push(`${METRICS_DIR}/${file}: not a novadev file (tolerated) — novadev keeps only ${METRICS_SNAPSHOT} here`);
  }
  for (const dir of listDirs(join(nd, METRICS_DIR))) {
    if (dir === METRICS_SNAPSHOT) continue; // a problem, above
    notes.push(`${METRICS_DIR}/${dir}/: not a novadev folder (tolerated)`);
  }

  // A raise line only means something to a project with a debt budget. Without one, a "## Debt"
  // section is free text — a line that happens to start with "Raise:" there is nobody's problem.
  // (Nor is git asked which round a record belongs to.)
  const found = collectRaises(nd, config.budget !== null ? recordRounds(root) : undefined);
  if (config.budget !== null) problems.push(...found.problems);

  if (config.command === null && snapshot.state === 'ok') {
    notes.push(
      `${METRICS_DIR}/${METRICS_SNAPSHOT} exists, but novadev.json sets no "metrics" command — the snapshot is no longer refreshed`,
    );
  }
  if (config.command !== null && snapshot.state === 'absent') {
    notes.push('metrics: a command is set, but no snapshot is stored yet — run `novadev sync`');
  }
  const budget = view ? view.budget : config.budget;
  if (budget !== null) {
    if (config.command === null) notes.push('debtBudget is set, but no "metrics" command measures the debt');
    const known = snapshot.state === 'ok' ? (snapshot.snapshot.debt?.known ?? null) : null;
    const plan = planRaises(budget, found.raises, known, '');
    for (const outcome of plan.outcomes) {
      const line = describeRaise(outcome, budget.maxKnown, false);
      if (line !== null) notes.push(line);
    }
    if (known !== null && known > plan.budget.maxKnown) {
      notes.push(
        `known debt ${fmt(known)} in ${METRICS_DIR}/${METRICS_SNAPSHOT} is over the budget ${fmt(plan.budget.maxKnown)} — \`novadev sync --check\` fails until it is reduced or the budget is raised in a record`,
      );
    }
  }

  const block = budgetsBlockFix(nd, config.wikiPage, snapshot, budget);
  if (block.fix) fixes.push(block.fix);
  if (block.note) notes.push(block.note);
  if (block.problem) problems.push(block.problem);

  return { problems, notes, fixes };
}

const BLOCK_NOTE =
  '<!-- generated by `novadev sync` from .novadev/metrics/latest.json — do not edit inside these markers -->';

function budgetsBlockFix(
  nd: string,
  page: string | null,
  snapshot: SnapshotRead,
  budget: DebtBudget | null,
): { fix?: Fix; note?: string; problem?: string } {
  if (page === null) return {};
  const wikiDir = join(nd, 'wiki');
  // No wiki yet: building it is already on the agent's list, and it will get the block after.
  if (!existsSync(join(wikiDir, 'INDEX.md'))) return {};
  const path = join(wikiDir, page);
  if (!existsSync(path)) {
    return snapshot.state === 'ok'
      ? { note: `wiki/${page}: missing, so the budgets block has nowhere to go — create the page, or set "metricsWikiPage"` }
      : {};
  }
  if (!statSync(path).isFile()) return { problem: `wiki/${page}: not a file — the budgets block needs a page of that name` };
  // A snapshot that cannot be read says nothing about the numbers: leave the block as it is.
  if (snapshot.state === 'invalid' || snapshot.state === 'blocked') return {};

  // Work on LF text and write back in the page's own line endings: a CRLF checkout
  // (core.autocrlf) must not read as "out of date" on every run.
  const raw = readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  const current = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  const lines = current.split('\n');
  // The page is hand-written: only marker LINES outside code count (see findBlock), so a page that
  // quotes the markers is never rewritten between the quote and the real block. Broken markers are
  // a problem, and the page is not touched — a second block would make the next rewrite span from
  // a stray marker to the new one and delete whatever a person wrote in between.
  const spot = findBlock(lines, BUDGETS_BLOCK);
  if (spot.state === 'broken') {
    return {
      problem: `wiki/${page}: ${blockTrouble(current, BUDGETS_BLOCK)} — repair them, or delete both and \`novadev sync\` adds the block again`,
    };
  }
  if (spot.state === 'absent') {
    if (snapshot.state !== 'ok') return {};
    // A code fence can hide a block: one that never closes swallows everything after it. Adding a
    // block then would add one more on every run, so say what is wrong and leave the page alone.
    const fences = fenceRanges(lines);
    const hidden = hiddenBlock(lines, fences);
    if (hidden) {
      return {
        problem: `wiki/${page}: the budgets block on line ${hidden.line + 1} is inside a code fence that opens on line ${hidden.fence + 1}, so sync cannot see it — close that fence, and sync rewrites the block where it is`,
      };
    }
    const open = fences.find((fence) => fence.close === null);
    if (open) {
      return {
        problem: `wiki/${page}: the code fence that opens on line ${open.open + 1} is never closed, so a budgets block added at the end of the page would be part of it — close the fence, and \`novadev sync\` adds the block`,
      };
    }
  }
  const body =
    snapshot.state === 'ok'
      ? renderBudgetsBlock(snapshot.snapshot, budget)
      : `${BLOCK_NOTE}\n_No metrics snapshot is stored — set "metrics" in \`.novadev/novadev.json\`._`;
  const handWritten = current.trimEnd();
  const next =
    spot.state === 'found'
      ? writeBlock(current, BUDGETS_BLOCK, body)!
      : `${handWritten ? `${handWritten}\n\n` : ''}## Budgets\n\n${blockBegin(BUDGETS_BLOCK)}\n${body}\n${blockEnd(BUDGETS_BLOCK)}\n`;
  // Never write a block the next run cannot find: it would be added again on every run.
  if (findBlock(next.split('\n'), BUDGETS_BLOCK).state !== 'found') {
    return {
      problem: `wiki/${page}: a budgets block written into this page could not be found again — check its code fences and markers`,
    };
  }
  if (next === current) return {};
  return {
    fix: {
      path,
      label: `wiki/${page}: budgets block ${spot.state === 'found' ? 'out of date' : 'missing'}`,
      next: crlf ? next.replace(/\n/g, '\r\n') : next,
    },
  };
}

/**
 * A block sync wrote, now inside fenced code — its begin marker line, then the generated note. A
 * fenced EXAMPLE of the markers is not this: only sync writes the note.
 */
function hiddenBlock(lines: readonly string[], fences: ReturnType<typeof fenceRanges>): { line: number; fence: number } | null {
  for (const fence of fences) {
    const last = fence.close ?? lines.length;
    for (let i = fence.open + 1; i < last; i++) {
      if (isMarkerLine(lines[i]!, blockBegin(BUDGETS_BLOCK)) && lines[i + 1]?.trim() === BLOCK_NOTE) {
        return { line: i, fence: fence.open };
      }
    }
  }
  return null;
}

/** The generated wiki block: the debt line, then the hubs, biggest first. */
export function renderBudgetsBlock(snapshot: Snapshot, budget: DebtBudget | null): string {
  const lines = [BLOCK_NOTE];
  const when = snapshot.updated ? `as of ${snapshot.updated}` : '';
  if (snapshot.debt) {
    const parts = [`**Known debt:** ${fmt(snapshot.debt.known)}${budget ? ` (budget ${fmt(budget.maxKnown)})` : ''}`];
    if (snapshot.debt.new !== undefined) parts.push(`**new:** ${fmt(snapshot.debt.new)}`);
    if (when) parts.push(when);
    lines.push(parts.join(' · '));
  } else if (when) {
    lines.push(`Measured ${when}.`);
  }
  lines.push('');
  if (snapshot.hubs.length === 0) {
    lines.push('_No hubs reported._');
    return lines.join('\n');
  }
  const withPath = snapshot.hubs.some((hub) => hub.path);
  lines.push(withPath ? '| Hub | Measure | Over budget on | Path |' : '| Hub | Measure | Over budget on |');
  lines.push(withPath ? '|---|---:|---|---|' : '|---|---:|---|');
  const hubs = [...snapshot.hubs].sort((a, b) => b.measure - a.measure || byCodePoint(a.name, b.name));
  for (const hub of hubs) {
    const cells = [textCell(hub.name), fmt(hub.measure), hub.over.length ? textCell(hub.over.join(', ')) : '—'];
    if (withPath) cells.push(hub.path ? codeCell(hub.path) : '—');
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** One line for `novadev status`. */
export function metricsStatusLine(nd: string): string {
  const config = readMetricsConfig(nd);
  const read = readSnapshot(nd);
  if (read.state === 'invalid' || read.state === 'blocked') {
    return `metrics — ⚠ ${METRICS_DIR}/${METRICS_SNAPSHOT} cannot be read (${read.error}); \`novadev doctor\` says more`;
  }
  const snapshot = read.state === 'ok' ? read.snapshot : null;
  if (config.command === null && snapshot === null) {
    return 'metrics — off (no "metrics" command in novadev.json)';
  }
  if (snapshot === null) return 'metrics — on, no snapshot yet (`novadev sync` takes the first one)';
  const parts: string[] = [];
  if (snapshot.debt) {
    parts.push(
      `known debt ${fmt(snapshot.debt.known)}${config.budget ? ` of ${fmt(config.budget.maxKnown)}` : ''}`,
    );
    if (snapshot.debt.new !== undefined) parts.push(`${fmt(snapshot.debt.new)} new`);
  }
  parts.push(`${snapshot.hubs.length} hub(s)`);
  const when = snapshot.updated ? `, as of ${snapshot.updated}` : '';
  const off = config.command === null ? ' — no command set, not refreshed' : '';
  return `metrics — ${parts.join(', ')}${when}${off}`;
}

/**
 * Plain text in a table cell: one line, with the characters escaped that markdown would read as a
 * column break, a code span, emphasis, a link or HTML.
 */
function textCell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*[\]<|~]/g, '\\$&');
}

/** A path in a table cell, as a code span that no backtick inside it can end early. */
function codeCell(text: string): string {
  const flat = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}
