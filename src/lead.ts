// The project's lead: who may decide what otherwise only a person decides.
//
//   "lead": "paperclip/minifil"                       in .novadev/novadev.json — one actor,
//   "lead": ["paperclip/minifil", "human:anna"]       or several
//
// Team mode (`"team": true`) says that a lead approves and merges, but never who that is; this
// setting names them, and it works with team mode on or off. The lead may change a todo's priority
// (`novadev todo priority`, todo-meta.ts) and override a missing owner review with a recorded
// reason (`novadev todo review`, owners.ts). A project without the setting has no lead: both stay
// a person's decision, exactly as before the setting existed.
//
// novadev does not authenticate anyone: an actor is what the caller says it is (`--by`, `by`). The
// setting is therefore a rule the record can be checked against, not a lock — which is why every
// such decision is written down with who, when and why, and why `novadev todo priority
// --changed-since` lists the ones an agent made.
import { ROOT_DIR_NAME, readManifest } from './lib.ts';
import { ACTOR_FORMAT, actorKind } from './okf.ts';

export const LEAD_SETTING = 'lead';

/** The actors `"lead"` names (none when it is absent), and what novadev could not read in it. */
export function readLeads(nd: string): { leads: string[]; error: string | null } {
  const raw = readManifest(nd)?.[LEAD_SETTING];
  if (raw === undefined || raw === null) return { leads: [], error: null };
  const list = Array.isArray(raw) ? raw : [raw];
  const leads: string[] = [];
  const bad: string[] = [];
  for (const item of list) {
    const actor = typeof item === 'string' ? item.trim() : '';
    if (actorKind(actor) === null) bad.push(JSON.stringify(item));
    else if (!leads.includes(actor)) leads.push(actor);
  }
  return { leads, error: bad.length > 0 ? `${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not an actor — ${ACTOR_FORMAT}` : null };
}

/** Is this actor one the project names as its lead? Never true in a project that names none. */
export function isLead(nd: string, actor: string): boolean {
  return readLeads(nd).leads.includes(actor);
}

/** How a message names the lead: the actors, or where to name one. */
export function leadText(nd: string): string {
  const { leads } = readLeads(nd);
  return leads.length > 0 ? leads.join(', ') : `none named — "${LEAD_SETTING}" in ${ROOT_DIR_NAME}/novadev.json names one`;
}

/** A `"lead"` novadev cannot read is a problem `sync` and `doctor` name: an unreadable entry is nobody's permission. */
export function auditLead(nd: string): { problems: string[] } {
  const { error } = readLeads(nd);
  return { problems: error === null ? [] : [`${ROOT_DIR_NAME}/novadev.json: "${LEAD_SETTING}" — ${error}. Until it is fixed that entry names nobody.`] };
}
