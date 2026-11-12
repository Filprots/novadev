// `novadev file-todo` — the command half of /novadev-file-a-todo.
//
//   novadev file-todo plan               which batch the todos would land in, and the next number
//   novadev file-todo file <payload>     create the folders, write the briefs, copy the files in
//
// The payload is a JSON FILE — `{ "parts": [ { slug, title, request, context?, attachments?, priority? } ], "by"? }`
// — because a request is multi-line prose written by a person, and quoting that through a shell is
// how it gets mangled. `attachments` are absolute paths to files already on disk. `priority` is
// urgent | high | normal | later, named only when the person signalled one (it goes into the todo's
// todo.json, todo-meta.ts); `by` is the person who asked (`human:<id>`, or `human` for git's user.name).
//
// Both commands answer in JSON on stdout, and errors as `{ "error": … }` with a non-zero exit, so
// the agent driving them can read the outcome instead of guessing from prose.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { novadevDir, requireProjectRoot } from './lib.ts';
import { fileTodos, parseParts, planBatch } from './todo-filing.ts';
import { resolveActor } from './todo-meta.ts';

const USAGE = 'usage: novadev file-todo plan\n       novadev file-todo file <payload.json>';

export function fileTodo(args: string[]): void {
  const [command, argument] = args;
  const nd = novadevDir(requireProjectRoot());
  try {
    if (command === 'plan') {
      console.log(JSON.stringify(planBatch(nd), null, 2));
      return;
    }
    if (command === 'file') {
      if (argument === undefined) throw new Error(USAGE);
      const path = isAbsolute(argument) ? argument : resolve(process.cwd(), argument);
      if (!existsSync(path)) throw new Error(`No payload file at ${path}.`);
      const payload = JSON.parse(readFileSync(path, 'utf8')) as { parts?: unknown; by?: unknown };
      const parts = parseParts(payload.parts);
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
