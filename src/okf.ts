// The Open Knowledge Format (OKF) v0.2 — the format layer, with none of novadev's own rules in it.
// Spec: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
//
// A bundle is a directory of markdown files. Every `.md` file in it is a CONCEPT — YAML frontmatter
// carrying at least a `type`, then a markdown body — except two reserved names: `index.md` (a
// directory listing, for progressive disclosure) and `log.md` (the scope's history, newest first).
// A concept's identity is its path. Concepts link to each other with plain markdown links.
//
// v0.2 makes four things answerable from frontmatter: where a concept came from (`sources`), who
// wrote and who confirmed it (`generated`, `verified` — trust), whether it is current (`status`),
// and whether it is still true (`stale_after`). Identities follow one convention (`actor`), and
// every timestamp is an ISO 8601 datetime with an explicit offset.
//
// This module parses and checks exactly that, and renders index and log text. What a novadev
// project requires on top of it — which types live where, which keys are mandatory — is in
// knowledge.ts. Nothing here imports novadev's own modules.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const OKF_VERSION = '0.2';
export const INDEX_FILE = 'index.md';
export const LOG_FILE = 'log.md';
/** The names that are never concepts, at any level of a bundle. */
export const RESERVED_FILES: readonly string[] = [INDEX_FILE, LOG_FILE];
export const LIFECYCLE_STATUSES = ['draft', 'stable', 'deprecated'] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export type TrustTier = 'unverified' | 'machine-confirmed' | 'human-reviewed';
export const TRUST_TIERS: readonly TrustTier[] = ['unverified', 'machine-confirmed', 'human-reviewed'];

// ---------------------------------------------------------------------------
// YAML — Bun's own parser, so novadev keeps zero dependencies
// ---------------------------------------------------------------------------

type YamlApi = { parse(text: string): unknown };

function yamlApi(): YamlApi {
  const api = (globalThis as { Bun?: { YAML?: YamlApi } }).Bun?.YAML;
  if (!api || typeof api.parse !== 'function') {
    throw new Error(
      `novadev reads Open Knowledge Format frontmatter with Bun's built-in YAML parser, which this Bun (${process.versions.bun ?? 'unknown'}) does not have — upgrade Bun (bun upgrade)`,
    );
  }
  return api;
}

/** Parse YAML text; a syntax error is returned in words, never thrown. */
export function parseYaml(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: yamlApi().parse(text) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('novadev reads')) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.replace(/^SyntaxError:\s*/, '').replace(/^YAML Parse error:\s*/, '') };
  }
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/** A markdown text cut at its frontmatter: the header lines (without the `---` fences) and the rest. */
export type Split = { header: string; body: string };

/**
 * The frontmatter header of a text and its body, or null when the text does not open with a `---`
 * line that a second `---` line closes. A UTF-8 byte order mark before the first fence is allowed.
 */
export function splitFrontmatter(text: string): Split | null {
  const m = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  return { header: m[1] ?? '', body: text.slice(m[0].length) };
}

export type FrontmatterRead =
  | { state: 'none' }
  | { state: 'invalid'; error: string }
  | { state: 'ok'; data: Record<string, unknown>; header: string; body: string };

/**
 * Read a concept's frontmatter: absent, broken (with the reason), or a YAML mapping. A key written
 * twice at the top level is broken too — YAML forbids it, and a parser would silently keep one.
 */
export function readFrontmatterText(text: string): FrontmatterRead {
  const split = splitFrontmatter(text);
  if (split === null) return { state: 'none' };
  const twice = duplicateTopKeys(split.header);
  if (twice.length > 0) return { state: 'invalid', error: `the key "${twice[0]}" is written twice` };
  const parsed = parseYaml(split.header);
  if (!parsed.ok) {
    const hint = yamlHint(split.header);
    return { state: 'invalid', error: hint === null ? parsed.error : `${parsed.error} — ${hint}` };
  }
  if (parsed.value === null || parsed.value === undefined) {
    return { state: 'ok', data: {}, header: split.header, body: split.body };
  }
  if (typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return { state: 'invalid', error: 'the frontmatter is not a mapping of keys to values' };
  }
  return { state: 'ok', data: parsed.value as Record<string, unknown>, header: split.header, body: split.body };
}

/**
 * The likeliest cause of a YAML error in a hand-written header, with its line in the file (the
 * opening `---` is line 1): a plain value holding ": " or " #" — YAML reads the first as a new
 * mapping and the second as a comment — or a tab used to indent. null when nothing obvious is wrong.
 */
export function yamlHint(header: string): string | null {
  const lines = header.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\t/.test(line) || /^ +\t/.test(line)) return `line ${i + 2}: indented with a tab — YAML indents with spaces`;
    const m = /^([A-Za-z0-9_-]+):[ \t]+(.+)$/.exec(line);
    if (!m) continue;
    const value = m[2]!.trim();
    if (/^["'[{|>&*!]/.test(value)) continue;
    if (/:\s/.test(value) || /\s#/.test(value)) {
      return `line ${i + 2} ("${m[1]}"): the value holds ${/:\s/.test(value) ? '": "' : '" #"'} — put the whole value in double quotes`;
    }
  }
  return null;
}

/** A top-level key line: `key:` at column 0, unquoted or quoted, followed by a space or the end. */
const TOP_KEY = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#'"\-?:,[\]{}&*!|>%@`][^:#]*?|-[^\s:#][^:#]*?))[ \t]*:(?:[ \t]|$)/;

/** The top-level key a header line opens, or null for a continuation, comment or blank line. */
export function topKeyOf(line: string): string | null {
  const m = TOP_KEY.exec(line);
  if (!m) return null;
  return (m[1] ?? m[2]?.replace(/''/g, "'") ?? m[3] ?? '').trim();
}

function duplicateTopKeys(header: string): string[] {
  const seen = new Set<string>();
  const twice: string[] = [];
  for (const line of header.split(/\r?\n/)) {
    const key = topKeyOf(line);
    if (key === null) continue;
    if (seen.has(key)) twice.push(key);
    seen.add(key);
  }
  return twice;
}

/** One top-level key of a header and the lines that hold its value: [start, end). */
type KeyBlock = { key: string; start: number; end: number };

function keyBlocks(lines: readonly string[]): KeyBlock[] {
  const blocks: KeyBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const key = topKeyOf(lines[i]!);
    if (key === null) continue;
    let end = i + 1;
    // The value goes on while lines are indented or are block-sequence items ("- …" at column 0,
    // which YAML allows under a key); a blank line or a column-0 comment belongs to it only when
    // more of the value follows.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (/^[ \t]+\S/.test(line) || /^-(?:[ \t]|$)/.test(line)) end = j + 1;
      else if (line.trim() === '' || line.startsWith('#')) continue;
      else break;
    }
    blocks.push({ key, start: i, end });
  }
  return blocks;
}

/**
 * Set top-level keys of a concept's frontmatter, keeping everything else exactly as it was written:
 * the other keys, their order, comments, and the body. A value is the YAML text for the key — one
 * line (`{ by: x, at: y }`) or several (a block list, every line after the first indented). null
 * removes the key. New keys are added at the end of the header, in the order given. Returns null when
 * the text has no frontmatter.
 */
export function setFrontmatterKeys(text: string, updates: Record<string, string | null>): string | null {
  const split = splitFrontmatter(text);
  if (split === null) return null;
  const crlf = text.includes('\r\n');
  const eol = crlf ? '\r\n' : '\n';
  const lines = split.header === '' ? [] : split.header.split(/\r?\n/);
  const blocks = keyBlocks(lines);
  const replaced = new Set<string>();
  // Replace from the bottom up, so earlier line numbers stay valid.
  for (const block of [...blocks].reverse()) {
    // Own keys only: a key named like a prototype member ("constructor") is a key like any other.
    if (!Object.hasOwn(updates, block.key)) continue;
    const value = updates[block.key]!;
    replaced.add(block.key);
    const next = value === null ? [] : renderKey(block.key, value);
    lines.splice(block.start, block.end - block.start, ...next);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (replaced.has(key) || value === null) continue;
    lines.push(...renderKey(key, value));
  }
  const bom = text.startsWith('﻿') ? '﻿' : '';
  return `${bom}---${eol}${lines.length > 0 ? lines.join(eol) + eol : ''}---${eol}${split.body}`;
}

function renderKey(key: string, value: string): string[] {
  const valueLines = value.split('\n');
  const head = valueLines[0]!;
  const rest = valueLines.slice(1);
  const name = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
  return [head === '' ? `${name}:` : `${name}: ${head}`, ...rest];
}

// ---------------------------------------------------------------------------
// Rendering YAML values
// ---------------------------------------------------------------------------

/**
 * A string as a YAML scalar: plain when YAML reads it back as exactly this string, double-quoted
 * otherwise (a JSON string is a valid YAML double-quoted scalar). `flow` asks for a scalar that is
 * also safe inside `[…]` and `{…}`.
 */
export function yamlString(value: string, flow = false): string {
  if (value !== '' && !/[\r\n\t]/.test(value) && value.trim() === value) {
    const probe = flow ? `v: [${value}]` : `v: ${value}`;
    const parsed = parseYaml(probe);
    if (parsed.ok && parsed.value !== null && typeof parsed.value === 'object') {
      const read = (parsed.value as Record<string, unknown>).v;
      const back = flow ? (Array.isArray(read) && read.length === 1 ? read[0] : undefined) : read;
      if (back === value) return value;
    }
  }
  return JSON.stringify(value);
}

/** A flow mapping on one line: `{ by: human:jsmith, at: 2026-06-25T09:00:00Z }`. */
export function yamlFlowMap(entries: ReadonlyArray<readonly [string, string]>): string {
  return `{ ${entries.map(([key, value]) => `${key}: ${yamlString(value, true)}`).join(', ')} }`;
}

/** A flow list on one line: `[sales, revenue]`; `[]` when empty. */
export function yamlFlowList(items: readonly string[]): string {
  return `[${items.map((item) => yamlString(item, true)).join(', ')}]`;
}

// ---------------------------------------------------------------------------
// Actors, timestamps, trust, lifecycle
// ---------------------------------------------------------------------------

/**
 * Who or what did something, in OKF's one convention: `human:<id>` for a person, `process:<id>` for
 * an automated process, `<producer>/<version>` for an agent or tool (`reference_agent/gemini-2.5-pro`).
 */
export type ActorKind = 'human' | 'process' | 'tool';

export function actorKind(actor: unknown): ActorKind | null {
  if (typeof actor !== 'string') return null;
  if (/^human:[^\s,[\]{}]+$/.test(actor)) return 'human';
  if (/^process:[^\s,[\]{}]+$/.test(actor)) return 'process';
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s,[\]{}/][^\s,[\]{}]*$/.test(actor)) return 'tool';
  return null;
}

export const ACTOR_FORMAT =
  '`human:<id>` for a person, `process:<id>` for an automated process, or `<producer>/<version>` for an agent or tool (like `claude-code/claude-opus-5-5`)';

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * True for an ISO 8601 datetime with an explicit offset — `2026-06-30T14:00:00Z`,
 * `2026-10-11T09:30:00+02:00` — that names a real moment. OKF writes every timestamp that way, so
 * that a staleness decision is a plain comparison.
 */
export function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = TIMESTAMP.exec(value);
  if (!m) return false;
  const [, y, mo, d, h, mi, s] = m;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s ?? '0') > 59) return false;
  const day = `${y}-${mo}-${d}`;
  const time = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === day && !Number.isNaN(Date.parse(value));
}

/** The calendar day a timestamp is written in — `2026-10-11` for `2026-10-11T23:30:00+02:00`. */
export function timestampDay(value: string): string {
  return value.slice(0, 10);
}

/** Now, as OKF writes it: a datetime in this machine's own offset, to the second. */
export function nowTimestamp(now: Date = new Date()): string {
  const offset = -now.getTimezoneOffset();
  const local = new Date(now.getTime() + offset * 60000);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const zone = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${local.toISOString().slice(0, 19)}${zone}`;
}

/** A timestamp moved by whole days, written in the same offset. */
export function addDaysToTimestamp(value: string, days: number): string {
  const m = TIMESTAMP.exec(value);
  if (!m) return value;
  const zone = m[7]!;
  const minutes = zone === 'Z' ? 0 : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const at = Date.parse(value) + days * 86400000 + minutes * 60000;
  return `${new Date(at).toISOString().slice(0, 19)}${zone}`;
}

/** One `{ by, at }` event of `generated` or `verified`. */
export type StampEvent = { by: string; at: string };

/** A parse that worked, or says in words why not. */
export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/** `generated: { by, at }` — `by` is required, `at` is the content's last meaningful change. */
export function readGenerated(value: unknown): Read<{ by: string; at: string | null } | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: '"generated" must be a mapping: { by: <actor>, at: <timestamp> }' };
  }
  const { by, at } = value as Record<string, unknown>;
  if (actorKind(by) === null) return { ok: false, error: `"generated.by" must be an actor — ${ACTOR_FORMAT}` };
  if (at !== undefined && at !== null && !isTimestamp(at)) {
    return { ok: false, error: '"generated.at" must be an ISO 8601 datetime with an offset, like 2026-10-11T09:30:00+02:00' };
  }
  return { ok: true, value: { by: by as string, at: (at as string | undefined) ?? null } };
}

/**
 * `verified` — a list of `{ by, at }` events; a single bare mapping counts as a one-element list, as
 * the spec requires of every consumer.
 */
export function readVerified(value: unknown): Read<StampEvent[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  const list = Array.isArray(value) ? value : [value];
  const events: StampEvent[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: '"verified" must be { by: <actor>, at: <timestamp> }, or a list of them' };
    }
    const { by, at } = entry as Record<string, unknown>;
    if (actorKind(by) === null) return { ok: false, error: `"verified[].by" must be an actor — ${ACTOR_FORMAT}` };
    if (!isTimestamp(at)) {
      return { ok: false, error: '"verified[].at" must be an ISO 8601 datetime with an offset, like 2026-10-11T09:30:00+02:00' };
    }
    events.push({ by: by as string, at });
  }
  return { ok: true, value: events };
}

/** The trust tier a consumer derives from `verified`: by nobody, by machines only, or by a person. */
export function trustTier(events: readonly StampEvent[]): TrustTier {
  if (events.length === 0) return 'unverified';
  return events.some((event) => actorKind(event.by) === 'human') ? 'human-reviewed' : 'machine-confirmed';
}

/** `status` — draft | stable | deprecated; absent means stable. */
export function readStatus(value: unknown): Read<LifecycleStatus> {
  if (value === undefined || value === null) return { ok: true, value: 'stable' };
  if (typeof value === 'string' && (LIFECYCLE_STATUSES as readonly string[]).includes(value)) {
    return { ok: true, value: value as LifecycleStatus };
  }
  return { ok: false, error: `"status" must be one of ${LIFECYCLE_STATUSES.join(', ')} (absent means stable)` };
}

/** `stale_after` — an absolute instant; the concept is stale from then on. */
export function readStaleAfter(value: unknown): Read<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (isTimestamp(value)) return { ok: true, value };
  return { ok: false, error: '"stale_after" must be an ISO 8601 datetime with an offset, like 2027-01-09T00:00:00Z' };
}

/** True once `now` has reached `staleAfter`. */
export function isStale(staleAfter: string | null, now: Date = new Date()): boolean {
  return staleAfter !== null && now.getTime() >= Date.parse(staleAfter);
}

/** `tags` — a YAML list of short strings. */
export function readTags(value: unknown): Read<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (Array.isArray(value) && value.every((tag) => typeof tag === 'string' && tag.trim() !== '')) {
    return { ok: true, value: value as string[] };
  }
  return { ok: false, error: '"tags" must be a YAML list of words, like [sales, revenue]' };
}

/** One entry of `sources`: what a concept derives from. */
export type Source = {
  resource: string;
  id?: string;
  title?: string;
  author?: string;
  usage_count?: number;
  last_modified?: string;
};

/** `sources` — a list of entries, each naming its `resource`; ids, when given, are unique. */
export function readSources(value: unknown): Read<Source[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: '"sources" must be a list of entries, each with a "resource"' };
  const out: Source[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: '"sources" must be a list of entries, each with a "resource"' };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.resource !== 'string' || e.resource.trim() === '') {
      return { ok: false, error: 'every "sources" entry needs a "resource": a URL, a path, or a scope it was drawn from' };
    }
    if (e.id !== undefined && (typeof e.id !== 'string' || e.id.trim() === '')) {
      return { ok: false, error: `"sources" entry ${e.resource}: "id" must be a word, the footnote label that cites it` };
    }
    if (typeof e.id === 'string') {
      if (ids.has(e.id)) return { ok: false, error: `"sources": the id "${e.id}" is used twice` };
      ids.add(e.id);
    }
    if (e.title !== undefined && typeof e.title !== 'string') {
      return { ok: false, error: `"sources" entry ${e.resource}: "title" must be text` };
    }
    if (e.author !== undefined && actorKind(e.author) === null && !(typeof e.author === 'string' && /^team:\S+$/.test(e.author))) {
      return { ok: false, error: `"sources" entry ${e.resource}: "author" must be an actor — ${ACTOR_FORMAT}` };
    }
    if (e.usage_count !== undefined && !(typeof e.usage_count === 'number' && Number.isInteger(e.usage_count) && e.usage_count >= 0)) {
      return { ok: false, error: `"sources" entry ${e.resource}: "usage_count" must be a whole number` };
    }
    if (e.last_modified !== undefined && !isTimestamp(e.last_modified)) {
      return { ok: false, error: `"sources" entry ${e.resource}: "last_modified" must be an ISO 8601 datetime with an offset` };
    }
    out.push({
      resource: e.resource,
      ...(typeof e.id === 'string' ? { id: e.id } : {}),
      ...(typeof e.title === 'string' ? { title: e.title } : {}),
      ...(typeof e.author === 'string' ? { author: e.author } : {}),
      ...(typeof e.usage_count === 'number' ? { usage_count: e.usage_count } : {}),
      ...(typeof e.last_modified === 'string' ? { last_modified: e.last_modified } : {}),
    });
  }
  return { ok: true, value: out };
}

/** `usage_window` — the `{ from, to }` range every `usage_count` is counted over. */
export function readUsageWindow(value: unknown): Read<null | { from: string; to: string }> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const { from, to } = value as Record<string, unknown>;
    if (isTimestamp(from) && isTimestamp(to)) return { ok: true, value: { from, to } };
  }
  return { ok: false, error: '"usage_window" must be { from: <timestamp>, to: <timestamp> }' };
}

// ---------------------------------------------------------------------------
// Markdown links
// ---------------------------------------------------------------------------

/** The targets of the inline markdown links in a text — `[text](target)` — in order. */
export function linkTargets(text: string): string[] {
  const out: string[] = [];
  const re = /\[(?:[^\]\\\n]|\\.)*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push(m[1]!.replace(/^<|>$/g, ''));
  }
  return out;
}

/**
 * Resolve a link target to a path relative to the bundle root, or null when it leaves the bundle or
 * is not a path (a URL, a mail link, a bare anchor). `from` is the bundle path of the file holding
 * the link. A target starting with `/` is bundle-relative, as OKF reads it.
 */
export function resolveBundleLink(target: string, from: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) return null;
  const raw = target.split('#')[0]!.split('?')[0]!;
  if (raw === '') return null;
  const path = raw
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment; // a lone "%" stays as written
      }
    })
    .join('/');
  const base = path.startsWith('/') ? [] : from.split('/').slice(0, -1);
  const parts = [...base];
  for (const part of path.replace(/^\/+/, '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

// ---------------------------------------------------------------------------
// index.md — a directory listing for progressive disclosure
// ---------------------------------------------------------------------------

export type IndexEntry = { title: string; href: string; description?: string };
export type IndexSection = { heading: string; entries: IndexEntry[] };

/** One line of text: newlines and runs of spaces become one space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function linkText(text: string): string {
  return oneLine(text).replace(/[\\[\]]/g, (c) => `\\${c}`);
}

/**
 * A path as a markdown link target that reads back as the same path: "%", "#" and "?" are
 * percent-encoded (a URL would read them as an escape, a fragment and a query), and a target holding
 * a space, a parenthesis or an angle bracket goes in `<…>`.
 */
export function linkHref(path: string): string {
  const href = path.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');
  return /[\s()<>]/.test(href) ? `<${href.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : href;
}

/**
 * An `index.md`: sections, each a heading over `* [Title](url) - description` entries. Index files
 * carry no frontmatter, except that a bundle's ROOT index may declare `okf_version`. `comment`, when
 * given, is an HTML comment line under the frontmatter — invisible when rendered.
 */
export function renderIndex(sections: readonly IndexSection[], opts: { okfVersion?: string; comment?: string } = {}): string {
  const parts: string[] = [];
  if (opts.okfVersion !== undefined) parts.push(`---\nokf_version: ${JSON.stringify(opts.okfVersion)}\n---`);
  if (opts.comment !== undefined) parts.push(`<!-- ${oneLine(opts.comment)} -->`);
  for (const section of sections) {
    const lines = [`# ${oneLine(section.heading)}`, ''];
    for (const entry of section.entries) {
      const description = entry.description ? ` - ${oneLine(entry.description)}` : '';
      lines.push(`* [${linkText(entry.title)}](${linkHref(entry.href)})${description}`);
    }
    if (section.entries.length === 0) lines.pop();
    parts.push(lines.join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * What is wrong with an index file's shape, in words: frontmatter where none is allowed (only a root
 * index may declare `okf_version`, and nothing else), or a line that is neither a heading, an entry
 * linking somewhere, a blank line, nor an HTML comment.
 */
export function indexProblems(text: string, isRoot: boolean): string[] {
  const problems: string[] = [];
  let body = text;
  const split = splitFrontmatter(text);
  if (split !== null) {
    const read = readFrontmatterText(text);
    const keys = read.state === 'ok' ? Object.keys(read.data) : null;
    if (!isRoot) problems.push('an index file carries no frontmatter (only a bundle-root index may declare okf_version)');
    else if (keys === null || keys.some((key) => key !== 'okf_version')) {
      problems.push('a root index file may carry only an okf_version key in its frontmatter');
    }
    body = split.body;
  }
  let comment = false;
  body.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (comment) {
      if (t.includes('-->')) comment = false;
      return;
    }
    if (t === '' || /^#{1,6}\s+\S/.test(t)) return;
    if (t.startsWith('<!--')) {
      if (!t.includes('-->')) comment = true;
      return;
    }
    if (/^[*-]\s+/.test(t) && linkTargets(t).length > 0) return;
    problems.push(`line ${i + 1} is neither a heading nor a "* [Title](url) - description" entry`);
  });
  return problems;
}

// ---------------------------------------------------------------------------
// log.md — the scope's history, newest first
// ---------------------------------------------------------------------------

export type LogEntry = {
  /** The date heading the entry sits under (YYYY-MM-DD). */
  date: string;
  /** 0-based line of the entry's first line. */
  line: number;
  /** The leading bold word — "Update", "Creation", "Deprecation" — or null. */
  kind: string | null;
  text: string;
  links: string[];
};
export type LogSection = { date: string; line: number; entries: LogEntry[] };
export type LogRead = { sections: LogSection[]; entries: LogEntry[]; problems: string[] };

const LOG_DATE = /^##[ \t]+(.+?)[ \t]*$/;

/**
 * Read a log: `## YYYY-MM-DD` sections, newest first, each holding list entries. Problems: a date
 * heading that is not an ISO day, two sections for one day, sections out of order, and an entry that
 * sits under no date.
 */
export function parseLog(text: string): LogRead {
  const sections: LogSection[] = [];
  const entries: LogEntry[] = [];
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  let section: LogSection | null = null;
  let entry: LogEntry | null = null;
  let fence = false;
  lines.forEach((line, i) => {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) fence = !fence;
    if (fence) return;
    const heading = LOG_DATE.exec(line);
    if (heading) {
      entry = null;
      const date = heading[1]!;
      if (!isDay(date)) {
        problems.push(`line ${i + 1}: "${line.trim()}" — a date heading must be an ISO day, like "## 2026-10-11"`);
        section = null;
        return;
      }
      section = { date, line: i, entries: [] };
      sections.push(section);
      return;
    }
    if (/^#\s/.test(line) || /^#{3,}\s/.test(line)) {
      entry = null;
      return;
    }
    const item = /^[*-][ \t]+(.*)$/.exec(line);
    if (item) {
      if (section === null) {
        problems.push(`line ${i + 1}: an entry under no date heading — put it under "## <YYYY-MM-DD>"`);
        entry = null;
        return;
      }
      const kind = /^\*\*([^*]+?)\*\*/.exec(item[1]!)?.[1]?.trim() ?? null;
      entry = { date: section.date, line: i, kind, text: item[1]!, links: linkTargets(item[1]!) };
      section.entries.push(entry);
      entries.push(entry);
      return;
    }
    if (entry !== null && /^[ \t]+\S/.test(line)) {
      const current: LogEntry = entry;
      current.text += `\n${line.trim()}`;
      current.links.push(...linkTargets(line));
    } else if (line.trim() !== '' && !line.trim().startsWith('<!--')) {
      entry = null;
    }
  });
  const seen = new Set<string>();
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    if (seen.has(s.date)) problems.push(`line ${s.line + 1}: a second section for ${s.date} — keep one section per day`);
    seen.add(s.date);
    const previous = sections[i - 1];
    if (previous && previous.date < s.date) {
      problems.push(`line ${s.line + 1}: ${s.date} comes after ${previous.date} — the newest day goes first`);
    }
  }
  return { sections, entries, problems };
}

function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * Add one entry line (without its `* `) under the `## <date>` section, creating the section in date
 * order (newest first) when the log has none for that day. Within a day, entries keep the order they
 * were written in. An empty text starts a new log under `title`.
 */
export function appendLogEntry(text: string, date: string, entry: string, title: string): string {
  const crlf = text.includes('\r\n');
  const lines = text === '' ? [`# ${title}`, ''] : text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const item = `* ${entry}`;
  const read = parseLog(lines.join('\n'));
  const same = read.sections.find((s) => s.date === date);
  if (same) {
    const last = same.entries.at(-1);
    let at = last ? last.line + 1 : same.line + 1;
    // Past the last entry's continuation lines.
    while (last && at < lines.length && /^[ \t]+\S/.test(lines[at]!)) at++;
    if (!last) {
      lines.splice(at, 0, '', item);
    } else {
      lines.splice(at, 0, item);
    }
  } else {
    const older = read.sections.find((s) => s.date < date);
    if (older) {
      lines.splice(older.line, 0, `## ${date}`, '', item, '');
    } else {
      while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
      lines.push('', `## ${date}`, '', item);
    }
  }
  const next = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  return crlf ? next.replace(/\n/g, '\r\n') : next;
}

// ---------------------------------------------------------------------------
// Walking a bundle, and the conformance rules
// ---------------------------------------------------------------------------

/** The markdown files of a bundle, as paths relative to its root, sorted; hidden entries skipped. */
export function bundleMarkdownFiles(bundleDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(full, `${prefix}${name}/`);
      else if (stat.isFile() && name.toLowerCase().endsWith('.md')) out.push(`${prefix}${name}`);
    }
  };
  walk(bundleDir, '');
  return out;
}

/** True for the reserved names: `index.md`, `log.md` — at any level. */
export function isReserved(path: string): boolean {
  return RESERVED_FILES.includes(path.split('/').pop()!);
}

/**
 * The bundle-level conformance rules, for one file: a concept needs parseable frontmatter with a
 * non-empty `type`; an index file follows the listing shape; a log file uses ISO day headings.
 * Returns the problems in words (empty when it conforms).
 */
export function conformanceProblems(path: string, text: string): string[] {
  const name = path.split('/').pop()!;
  if (name === INDEX_FILE) return indexProblems(text, !path.includes('/'));
  if (name === LOG_FILE) {
    const problems: string[] = [];
    if (splitFrontmatter(text) !== null) problems.push('a log file carries no frontmatter');
    problems.push(...parseLog(text).problems.filter((p) => p.includes('ISO day') || p.includes('under no date')));
    return problems;
  }
  const read = readFrontmatterText(text);
  if (read.state === 'none') return ['no frontmatter — a concept opens with a `---` block that names its `type`'];
  if (read.state === 'invalid') return [`frontmatter is not valid YAML: ${read.error}`];
  const type = read.data.type;
  if (typeof type !== 'string' || type.trim() === '') return ['frontmatter has no `type` — every concept names its type'];
  return [];
}
