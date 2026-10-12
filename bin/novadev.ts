#!/usr/bin/env bun
// novadev — a framework/language/agent-agnostic structured development system.
import { NOVADEV_VERSION } from '../src/lib.ts';

const [command, ...args] = process.argv.slice(2);

const HELP = `novadev ${NOVADEV_VERSION} — structured development system

usage:
  novadev sync [--check]    THE close-out: run the metrics hook (if set), regenerate derived
                            links and the knowledge indexes, archive what is finished, validate
                            (the knowledge bundle and its log included), and print what the agent
                            + the human still have to do; --check writes nothing and fails on
                            problems, stale derived files (the metrics snapshot and the wiki
                            block included), an unreadable snapshot, a budget raise sync has not
                            written yet, a debt budget it cannot check, or known debt over budget
  novadev deploy            create/upgrade .novadev/ + the playbook + agent adapters
                            (on an older layout, run migrate-repo first)
  novadev new [slug…]       scaffold today's next batch (todos/YYYY-MM-DD_N/), optional todo folders
  novadev status            stock-take: open todos + record states, postponed triggers, wiki/memories
  novadev archive <batch>…  move fully-recorded batch(es) to archive/<year>/   (or: --done for all)
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
  novadev totest [--all]    what still needs YOUR hands-on testing, and what is ready
                            for review; --new <slug> scaffolds a test task
  novadev file-todo …       the command half of /novadev-file-a-todo: "plan" says which batch
                            a chat request lands in, "file <payload.json>" writes the folders
  novadev test-result …     the command half of /novadev-what-to-test and /novadev-test-review:
                            "tasks [query]" resolves the queue, "write" records one scenario,
                            "review" records a whole round of a human's testing
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
    status();
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
