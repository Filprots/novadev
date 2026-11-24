// Who a todo may be addressed to: the names, who answers to a name, and the project's own list.
//
// A todo may name its RECIPIENT (`"recipient"` in its todo.json, todo-meta.ts): the one it is addressed
// to. Only the recipient works it; a todo without one is anyone's, as every todo was before recipients
// existed. A recipient is one of two things:
//
//   an actor      `paperclip/tester`, `human:filipp`    that one agent, or that person
//   a team        `hq`, `paperclip`                     every actor of that producer: `hq/<anything>`
//
// A team's name is the first part of its members' actors, so nothing has to say who belongs to it: a
// session that starts work as `--agent hq/claude-opus-5-5` answers to `hq`, and `paperclip/dev` answers to
// `paperclip` and to `paperclip/dev`. The word `anyone` is not a name: it is how a list is asked for the
// todos that have no recipient (`novadev todo list --for anyone`).
//
//   "recipients": { "hq": "The headquarters session: the tools, the machines, the rules.",
//                   "paperclip": "The company's agents." }          in .novadev/novadev.json
//   "recipients": ["hq", "paperclip"]                               … or only the names
//
// The setting is optional. With it, a todo can be addressed only to a name it lists, or to an actor of a
// team it lists — a filing to a name nobody answers to is refused instead of waiting forever — and
// `novadev file-todo plan` answers the list, so whoever files sees who can be addressed and what belongs
// to whom. Without it any well-formed name is accepted.
//
// novadev does not authenticate anyone: an actor is what the caller says it is (`--agent`, `--by`). A
// recipient is therefore a rule the record can be checked against, not a lock — which is why every
// re-addressing is written into the todo's history with who did it and when.
import { dirname } from 'node:path';
import { ruleRoot } from './claim-policy.ts';
import { ROOT_DIR_NAME, isPlainObject, novadevDir, readManifest } from './lib.ts';
import { actorKind } from './okf.ts';

export const RECIPIENTS_SETTING = 'recipients';
/** In a filter (`--for`), the todos with no recipient. Never a recipient's name. */
export const ANYONE = 'anyone';
/**
 * Words that read as "no recipient" or "all of them", and the two words that open an actor (`human:<id>`,
 * `process:<id>`) and so are no team: refused as a name, so no todo is ever addressed to them.
 */
const NOT_A_NAME: readonly string[] = [ANYONE, 'anybody', 'everyone', 'everybody', 'all', 'none', 'nobody', 'null', 'human', 'process'];
const TEAM = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_NAME_CHARS = 80;
/** How much of a recipient's description a message shows; `file-todo plan` answers all of it. */
const SHOWN_ABOUT_CHARS = 160;
/** What an argument put in the wrong place looks like: a payload file, or a todo's ref (`2026-10-01_1/02`). */
const LOOKS_LIKE_A_FILE = /\.json$/i;
const LOOKS_LIKE_A_TODO = /^\d{4}-\d{2}-\d{2}_\d+(\/|$)/;

export const RECIPIENT_FORMAT =
  'a team\'s name (like `hq`: every actor `hq/…`), or one actor (`paperclip/tester` for an agent, `human:<id>` for a person)';

/** A team's name — not an actor: no `/`, no `:`. */
export function isTeam(name: string): boolean {
  return TEAM.test(name);
}

/**
 * A recipient as it is written (` hq `), or null when it is no name a todo can be addressed to. A team's
 * name is kept in lower case, so `HQ` and `hq` are one recipient in every list and count; an actor is
 * kept as it is written (matching ignores case). A payload file's name or a todo's ref is never a
 * recipient: it is an argument that landed in the wrong place.
 */
export function parseRecipient(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name === '' || name.length > MAX_NAME_CHARS) return null;
  if (NOT_A_NAME.includes(name.toLowerCase())) return null;
  if (LOOKS_LIKE_A_FILE.test(name) || LOOKS_LIKE_A_TODO.test(name)) return null;
  if (isTeam(name)) return name.toLowerCase();
  return actorKind(name) !== null ? name : null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const memberOf = (actor: string, team: string) => isTeam(team) && actor.toLowerCase().startsWith(`${team.toLowerCase()}/`);

/** Does `who` — an actor, or a team's name — answer to this recipient? Itself, or the team it is an actor of. */
export function answersTo(who: string, recipient: string): boolean {
  return same(who, recipient) || memberOf(who, recipient);
}

/** One recipient the project names, with what belongs to it (null when the setting gives only names). */
export type KnownRecipient = { name: string; about: string | null };

/**
 * The recipients `"recipients"` names: null when the setting is absent — any name is then accepted — and
 * what novadev could not read in it. Read from the main checkout (claim-policy.ts), like the lead: a task
 * branch cannot add a recipient of its own.
 */
export function readRecipients(nd: string): { known: KnownRecipient[] | null; error: string | null } {
  const raw = readManifest(novadevDir(ruleRoot(dirname(nd))))?.[RECIPIENTS_SETTING];
  if (raw === undefined || raw === null) return { known: null, error: null };
  const entries: [unknown, unknown][] | null = Array.isArray(raw) ? raw.map((name) => [name, null]) : isPlainObject(raw) ? Object.entries(raw) : null;
  if (entries === null) return { known: [], error: `it must be an object of names with what belongs to each ({ "hq": "…" }), or a list of names` };
  const known: KnownRecipient[] = [];
  const bad: string[] = [];
  for (const [key, about] of entries) {
    const name = parseRecipient(key);
    if (name === null) {
      bad.push(`${JSON.stringify(key)} is not a name (${RECIPIENT_FORMAT})`);
      continue;
    }
    // A description novadev cannot read is named, but the recipient itself stays one: its todos must not
    // lose their recipient over a typo in a text.
    if (about !== null && typeof about !== 'string') bad.push(`what belongs to ${JSON.stringify(key)} must be a text`);
    if (!known.some((k) => same(k.name, name))) known.push({ name, about: typeof about === 'string' && about.trim() !== '' ? about.trim() : null });
  }
  return { known, error: bad.length > 0 ? bad.join('; ') : null };
}

/** The listed recipient a name is: the entry itself, or the team the name is an actor of. Null when it is neither. */
function knownAs(known: readonly KnownRecipient[], name: string): KnownRecipient | null {
  return known.find((k) => same(k.name, name)) ?? known.find((k) => memberOf(name, k.name)) ?? null;
}

/** May a todo be addressed to this name here? Always, in a project that names no recipients. */
export function isKnownRecipient(nd: string, name: string): boolean {
  const { known } = readRecipients(nd);
  return known === null || knownAs(known, name) !== null;
}

/** How a message lists the project's recipients: `hq (the tools, the machines), paperclip`. */
export function recipientsText(known: readonly KnownRecipient[]): string {
  const shown = (about: string) => (about.length > SHOWN_ABOUT_CHARS ? `${about.slice(0, SHOWN_ABOUT_CHARS).trimEnd()}…` : about);
  return known.length === 0 ? 'none — the list is empty' : known.map((k) => (k.about !== null ? `${k.name} (${shown(k.about)})` : k.name)).join(', ');
}

/**
 * The recipient a filing or a re-addressing names, checked: a name novadev can read, and — in a project
 * that names its recipients — one of them, spelled as the project spells it. Throws otherwise, saying
 * which names there are.
 */
export function resolveRecipient(nd: string, raw: unknown): string {
  const name = parseRecipient(raw);
  if (name === null) {
    throw new Error(`"${typeof raw === 'string' ? raw.trim() : String(raw ?? '')}" is not a recipient — write ${RECIPIENT_FORMAT}. A todo for anyone has no recipient at all.`);
  }
  const { known } = readRecipients(nd);
  if (known === null) return name;
  const entry = knownAs(known, name);
  if (entry === null) {
    throw new Error(
      `"${name}" is not a recipient of this project — nobody would pick the todo up. The recipients ("${RECIPIENTS_SETTING}" in ${ROOT_DIR_NAME}/novadev.json): ${recipientsText(known)}. Address it to one of them or to one of their actors, or leave the recipient out: the todo is then anyone's.`,
    );
  }
  return same(entry.name, name) ? entry.name : name;
}

/** `, for hq` after a state in a list line — nothing for a todo without a recipient, so old projects print as before. */
export function recipientTag(recipient: string | null): string {
  return recipient === null ? '' : `, for ${recipient}`;
}

/**
 * A `--for` value: the recipients asked for, `anyone` among them for the todos that have none. Throws on
 * a word that is neither.
 */
export function parseForFilter(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    const name = raw.toLowerCase() === ANYONE ? ANYONE : parseRecipient(raw);
    if (name === null) throw new Error(`--for "${raw}": not a recipient — write ${RECIPIENT_FORMAT}, or \`${ANYONE}\` for the todos that have no recipient.`);
    if (!out.includes(name)) out.push(name);
  }
  if (out.length === 0) throw new Error(`--for needs a recipient: ${RECIPIENT_FORMAT}, or \`${ANYONE}\` for the todos that have no recipient.`);
  return out;
}

/**
 * Is a todo with this recipient one the filter asks for? `anyone` asks for the todos that have none. A
 * name asks for the todos addressed to it, to the team it is an actor of (what that actor may take), or —
 * when the name is a team's — to one of the team's actors (what a lead who hands the team's work out has
 * to see).
 */
export function matchesFor(recipient: string | null, filter: readonly string[]): boolean {
  return filter.some((who) => (who === ANYONE ? recipient === null : recipient !== null && (answersTo(who, recipient) || answersTo(recipient, who))));
}

/** A `"recipients"` novadev cannot read is a problem `sync` and `doctor` name. */
export function auditRecipientsSetting(nd: string): { problems: string[] } {
  const { error } = readRecipients(nd);
  return { problems: error === null ? [] : [`${ROOT_DIR_NAME}/novadev.json: "${RECIPIENTS_SETTING}" — ${error}. Until it is fixed that entry names nobody.`] };
}
