// `novadev file-todo` — the command half of /novadev-file-a-todo.
//
//   novadev file-todo plan               which batch the todos would land in, and the next number
//   novadev file-todo file <payload>     create the folders, write the briefs, copy the files in
//
// The payload is a JSON FILE — `{ "parts": [ { slug, title, request, context?, attachments? } ] }`
// — because a request is multi-line prose written by a person, and quoting that through a shell is
// how it gets mangled. `attachments` are absolute paths to files already on disk.
//
// Both commands answer in JSON on stdout, and errors as `{ "error": … }` with a non-zero exit, so
// the agent driving them can read the outcome instead of guessing from prose.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { novadevDir, requireProjectRoot } from './lib.ts';
import { fileTodos, parseParts, planBatch } from './todo-filing.ts';

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
      const payload = JSON.parse(readFileSync(path, 'utf8')) as { parts?: unknown };
      const parts = parseParts(payload.parts);
      // Say plainly which attachments will not travel, rather than filing a brief that promises a
      // file the folder does not have.
      const missing = parts.flatMap((part) => (part.attachments ?? []).filter((p) => !existsSync(p)));
      const filed = fileTodos(nd, parts);
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
