#!/usr/bin/env bun
// novadev — a framework/language/agent-agnostic structured development system.
import { NOVADEV_VERSION } from '../src/lib.ts';

const [command, ...args] = process.argv.slice(2);

const HELP = `novadev ${NOVADEV_VERSION} — structured development system

usage:
  novadev sync [--check]    THE close-out: regenerate derived links, archive what is finished,
                            validate, and print what the agent + the human still have to do
  novadev deploy            create/upgrade .novadev/ + the playbook + agent adapters
  novadev new [slug…]       scaffold today's next batch (todos/YYYY-MM-DD_N/), optional todo folders
  novadev status            stock-take: open todos + record states, postponed triggers, wiki/memories
  novadev archive <batch>…  move fully-recorded batch(es) to archive/<year>/   (or: --done for all)
  novadev features [query]  search the feature registry; --touching <path> finds overlap,
                            --status/--area filter, --new <slug> scaffolds an entry
  novadev links [--fix]     validate the link graph (records ↔ features ↔ commits);
                            --fix regenerates derived backlinks and features/INDEX.md
  novadev totest [--all]    what still needs YOUR hands-on testing, and what is ready
                            for review; --new <slug> scaffolds a test task
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
  case 'sync': {
    const { sync } = await import('../src/sync.ts');
    sync(args);
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
