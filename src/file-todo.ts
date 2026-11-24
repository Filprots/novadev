// `novadev file-todo` — the command half of /novadev-file-a-todo.
//
//   novadev file-todo plan               which batch the todos would land in, and the next number
//   novadev file-todo file <payload>     create the folders, write the briefs, copy the files in
//
// The payload is a JSON FILE — `{ "parts": [ { slug, title, request, context?, attachments?, priority?, after?, recipient? } ], "by"? }`
// — because a request is multi-line prose written by a person, and quoting that through a shell is
// how it gets mangled. `attachments` are absolute paths to files already on disk. `priority` is
// urgent | high | normal | later, named only when the person signalled one (it goes into the todo's
// todo.json, todo-meta.ts); `after` lists the todos the part waits for — refs, or the slug of another part
// of the same payload (todo-links.ts); `recipient` is who the part is addressed to, when it is for somebody
// in particular (a team like `hq`, or one actor — recipients.ts; `plan` answers the project's own list
// when it names one) — a `recipient` beside `parts` addresses every part that names none; `by` is who asked
// (`human:<id>`, `human` for git's user.name, or an agent's actor).
//
// Both commands answer in JSON on stdout, and errors as `{ "error": … }` with a non-zero exit, so
// the agent driving them can read the outcome instead of guessing from prose.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { novadevDir, requireProjectRoot } from './lib.ts';
import { RECIPIENT_FORMAT, parseRecipient, readRecipients } from './recipients.ts';
import { fileTodos, parseParts, planBatch } from './todo-filing.ts';
import { resolveActor } from './todo-meta.ts';

const USAGE = 'usage: novadev file-todo plan\n       novadev file-todo file <payload.json>';

export function fileTodo(args: string[]): void {
  const [command, argument] = args;
  const nd = novadevDir(requireProjectRoot());
  try {
    if (command === 'plan') {
      // The recipients the project names, with what belongs to each: whoever files sees who can be addressed.
      const { known } = readRecipients(nd);
      console.log(JSON.stringify({ ...planBatch(nd), ...(known !== null ? { recipients: Object.fromEntries(known.map((k) => [k.name, k.about])) } : {}) }, null, 2));
      return;
    }
    if (command === 'file') {
      if (argument === undefined) throw new Error(USAGE);
      const path = isAbsolute(argument) ? argument : resolve(process.cwd(), argument);
      if (!existsSync(path)) throw new Error(`No payload file at ${path}.`);
      const payload = JSON.parse(readFileSync(path, 'utf8')) as { parts?: unknown; by?: unknown; recipient?: unknown };
      let parts = parseParts(payload.parts);
      // A recipient beside `parts` is for every part that names none: left unread, the whole filing would
      // be anyone's while whoever wrote it believes it is addressed.
      if (payload.recipient !== undefined && payload.recipient !== null) {
        const forAll = parseRecipient(payload.recipient);
        if (forAll === null) throw new Error(`The payload's 'recipient' must be ${RECIPIENT_FORMAT} — not "${String(payload.recipient)}". Leave it out for todos that are anyone's.`);
        parts = parts.map((part) => (part.recipient === undefined ? { ...part, recipient: forAll } : part));
      }
      // Who asked, when the payload says: checked before anything is written.
      const by = payload.by === undefined || payload.by === null ? null : resolveActor(dirname(nd), payload.by, { personOnly: false, what: 'asked for these todos' });
      // Say plainly which attachments will not travel, rather than filing a brief that promises a
      // file the folder does not have.
      const missing = parts.flatMap((part) => (part.attachments ?? []).filter((p) => !existsSync(p)));
      const filed = fileTodos(nd, parts, { by });
      console.log(
        JSON.stringify(
          { filed, ...(missing.length > 0 ? { missingAttachments: missing } : {}) },
          null,
          2,
        ),
      );
      return;
    }
    console.error(USAGE);
    process.exit(2);
  } catch (error) {
    console.log(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
    );
    process.exit(1);
  }
}
