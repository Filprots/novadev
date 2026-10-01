// Preloaded by bun test (bunfig.toml): one hook for the whole run, after every test file.
import { afterAll } from 'bun:test';
import { removeTempDirs } from './helpers.ts';

afterAll(removeTempDirs);
