#!/usr/bin/env bun
// novadev — a framework/language/agent-agnostic structured development system.
import { NOVADEV_VERSION } from '../src/lib.ts';

const [command, ...args] = process.argv.slice(2);

const HELP = `novadev ${NOVADEV_VERSION} — structured development system

usage:
  novadev sync [--check | --after-merge]
                            THE close-out: run the metrics hook (if set), regenerate derived
                            links and the knowledge indexes, archive what is finished, validate
                            (the knowledge bundle and its log included), and print what the agent
                            + the human still have to do; --check writes nothing and fails on
                            problems, stale derived files (the metrics snapshot and the wiki
                            block included), an unreadable snapshot, a budget raise sync has not
                            written yet, a debt budget it cannot check, or known debt over budget;
                            --after-merge (after merging a branch): repair the knowledge log, run
                            sync, and commit what it changed in .novadev/
  novadev deploy            create/upgrade .novadev/ + the playbook + agent adapters, and the
                            merge rules (.gitattributes + the merge driver in this clone's git config)
                            (on an older layout, run migrate-repo first)
  novadev new [slug…]       scaffold today's next batch (todos/YYYY-MM-DD_N/), optional todo folders
  novadev status [--json]   is a work cycle on? the todos (and whole batches) in work — who, since when,
                            where, paused or abandoned — the worktrees and their locks, then open todos
                            + record states (by priority: urgent first) with each todo's holder,
                            postponed, knowledge;
                            --json: the same as data (for a tool or a chat bot)
  novadev todo …            one todo, away from the repo: "list [--state s,…] [--json]" (with who holds
                            each), "show <ref>" (JSON: brief + records + holder), "addendum <ref> <payload.json>" ({text, attachments}: a Chat
                            addendum to an open todo's brief, files copied into its folder), "edit <ref>
                            <payload.json>" ({title, request, context, reason}: the brief changed, the old one
                            kept in .brief-history/), "cancel <ref> <payload.json>" ({reason}: a *cancelled* ai_failed),
                            "review <ref> <payload.json>" ({verdict: APPROVE|CHANGES, by, checks, findings?}: ai_review.md),
                            "priority <ref> <urgent|high|normal|later> [<payload.json>] [--by <actor>]" (a person's
                            decision, or the lead's — "lead" in novadev.json: {by, reason} — who, when and why are
                            kept in the todo's todo.json; every list orders by priority, then by filing order),
                            "priority --changed-since <date> [--by-agent] [--json]" (the recorded changes, and
                            which ones an agent made), "after <ref> [<ref>…] [--clear] [--by <actor>]"
                            (the todos it waits for: "work start" refuses it until they are completed; the lists
                            say ready / waits for; sync and doctor flag a link to no todo and a cycle)
  novadev owners [<path|area>] [--json]
                            who owns a path or a feature area and who must review a change to it ("owners" in
                            novadev.json: areas, paths as globs or "<sub-repo>:<glob>", override); no argument: the
                            rules. A todo's suggested owner is in file-todo's answer, "todo show" and the JSON lists;
                            "worktree mr" names the required reviewers; "todo review" holds an APPROVE as PARTIAL
                            until one reviewer of each matching rule approved (a person or the lead may override,
                            with a reason)
  novadev work …            the lock of a todo in work (todos/<batch>/<todo>/working.md): "start
                            <batch>/<todo>" takes or resumes it (also <batch>/<nn>, a word of its slug,
                            or "start <batch> --todo <nn|slug>"), "waypoint <ref> <payload.json>" records
                            where the work is, "pause <ref> <payload.json>" writes exactly where it
                            stopped (the command half of /novadev-pause), "stop <ref>" releases it,
                            "claim <ref> <path>…" adds paths the lock owns (start: --claim); <ref> is
                            the todo, or its batch (the locks this worktree holds in it);
                            "start <batch>" with no todo: one developer takes the WHOLE batch (one lock
                            at the batch root, todos/<batch>/working.md);
                            a todo that waits for another ("todo after") is not started until that one is completed;
                            every worktree sees the locks (a registry in the common git dir), and
                            overlapping claims across worktrees are refused (--allow-overlap)
  novadev worktree …        one worktree per task (a todo) across the project and the sub-repos it changes,
                            on one branch: "create <name> [<sub-repo>…] [--claim <path>]… [--todo <ref>]…", "claim <name>
                            <path>…" (more claims, same check), "list", "status",
                            "gate" (the checks before a merge request), "mr" (its text), "sync" (merge the
                            default branches in), "merge <name> [--yes]" (the lead: all or nothing, the
                            gate on the merged result first, then sync --after-merge),
                            "queue add <name> | list | run | remove <name>" (the merge queue: each
                            branch onto the newest default branch, checked there, then landed; a
                            failure lands nothing and the queue goes on), "remove <name> [--force]";
                            "claims": "notice" in novadev.json makes an overlapping claim a notice,
                            "protectedPaths" names where it stays a lock; "wipLimit" caps the unfinished
                            todos one holder may have in work (an urgent todo is exempt: the express lane)
  novadev archive <batch>…  move fully-recorded batch(es) to archive/<year>/   (or: --done for all);
                            on the default branch only — a task branch leaves the moves to it
  novadev knowledge [words] the knowledge bundle (.novadev/knowledge/, Open Knowledge Format 0.2):
                            what it holds, or search it; --type/--tag/--tier filter, --stale lists
                            what is due for a re-check, --drifted what cites code (repo: sources)
                            that changed after its last check; "log <payload.json>" records changes
                            — each concept's stamps and its log.md entry, together
  novadev features [query]  search the feature registry; --touching <path> finds overlap,
                            --hubs lists the features on each hub, --status/--area filter,
                            --new <slug> scaffolds an entry
  novadev links [--fix]     validate the link graph (records ↔ features ↔ commits);
                            --fix regenerates each feature's derived work.md and tests.md
  novadev totest [--all] [--json]   what still needs YOUR hands-on testing, and what is ready
                            for review (--json: as data); --new <slug> scaffolds a test task
  novadev file-todo …       the command half of /novadev-file-a-todo: "plan" says which batch
                            a chat request lands in, "file <payload.json>" writes the folders
                            (a part may carry "priority": urgent|high|normal|later, and "after": the todos it waits for)
  novadev test-result …     the command half of /novadev-what-to-test and /novadev-test-review:
                            "tasks [query]" resolves the queue, "write" records one scenario,
                            "review" records a whole round of a human's testing, "skip" marks
                            scenarios (or the rest) skipped on the owner's word and closes the round
  novadev migrate-repo      upgrade this repo's .novadev/ layout to the installed version
                            (stepwise, version-aware; --dry-run to preview, --force if dirty)
  novadev doctor            validate structure; non-zero exit on problems
  novadev help              this help
`;

switch (command) {
  case 'deploy': {
    const { deploy } = await import('../src/deploy.ts');
    deploy();
    break;
  }
  case 'new': {
    const { newBatch } = await import('../src/new.ts');
    newBatch(args);
    break;
  }
  case 'status': {
    const { status } = await import('../src/status.ts');
    status(args);
    break;
  }
  case 'work': {
    const { work } = await import('../src/work.ts');
    work(args);
    break;
  }
  case 'worktree': {
    const { worktree } = await import('../src/worktree.ts');
    worktree(args);
    break;
  }
  case 'archive': {
    const { archive } = await import('../src/archive.ts');
    archive(args);
    break;
  }
  case 'knowledge': {
    const { knowledge } = await import('../src/knowledge-cmd.ts');
    knowledge(args);
    break;
  }
  case 'features': {
    const { features } = await import('../src/features.ts');
    features(args);
    break;
  }
  case 'links': {
    const { links } = await import('../src/links.ts');
    links(args);
    break;
  }
  case 'totest': {
    const { totest } = await import('../src/totest.ts');
    totest(args);
    break;
  }
  case 'file-todo': {
    const { fileTodo } = await import('../src/file-todo.ts');
    fileTodo(args);
    break;
  }
  case 'todo': {
    const { todoCommand } = await import('../src/todo.ts');
    todoCommand(args);
    break;
  }
  case 'owners': {
    const { ownersCommand } = await import('../src/owners.ts');
    ownersCommand(args);
    break;
  }
  case 'test-result': {
    const { testResult } = await import('../src/test-result.ts');
    testResult(args);
    break;
  }
  case 'sync': {
    const { sync } = await import('../src/sync.ts');
    await sync(args);
    break;
  }
  case 'migrate-repo': {
    const { migrateRepo } = await import('../src/migrations.ts');
    migrateRepo(args);
    break;
  }
  case 'doctor': {
    const { doctor } = await import('../src/doctor.ts');
    doctor();
    break;
  }
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    console.log(HELP);
    break;
  case '--version':
  case '-v':
    console.log(NOVADEV_VERSION);
    break;
  default:
    console.error(`novadev: unknown command "${command}"\n`);
    console.log(HELP);
    process.exit(1);
}
