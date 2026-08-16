#!/usr/bin/env bun
// novadev — a framework/language/agent-agnostic structured development system.
import { NOVADEV_VERSION } from '../src/lib.ts';

const [command, ...args] = process.argv.slice(2);

const HELP = `novadev ${NOVADEV_VERSION} — structured development system

usage:
  novadev deploy            create/upgrade .novadev/ + skills + agent adapters in the current project
  novadev new [slug…]       scaffold today's next batch (todos/YYYY-MM-DD_N/), optional todo folders
  novadev status            stock-take: open todos + record states, postponed triggers, wiki/memories
  novadev archive <batch>…  move fully-recorded batch(es) to archive/<year>/   (or: --done for all)
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
