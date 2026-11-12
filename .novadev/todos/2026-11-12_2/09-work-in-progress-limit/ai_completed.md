# ai_completed — work-in-progress-limit

**Date:** 2026-11-12
**Feature:** FEAT-0023
**Commits:** f2904df, 9c808c6

## Prompt
A limit on work in progress per holder: `wipLimit`, `wipCountsPaused`; refusal at the limit; urgent exempt; status shows the counts.

## What I did
- `src/wip.ts`: the settings (main checkout), `wipSlot`, `wipHolders`. `wipCheck` in `startWork` refuses after every other refusal and before the first write.
- A whole-batch lock counts every unfinished todo of it (the board's answer 5); a finished todo frees its slot even before its lock is stopped; a lock without an actor is not counted.
- `status` (*work in progress*) and `status --json` (`wip`).
- **After the independent review:** with a limit set, a start without `--agent` is refused (it was an easy way past the limit).

## Placement
New module `src/wip.ts` (settings and counting); the refusal in `startWork` (`src/work.ts`). No hubs are configured.

## Verification
- `tests/wip-and-express.test.ts` (5 tests): the brief's five — refusal at the limit with the list; slot freed by completion and by a stop; paused counting both ways; urgent exempt; off by default.
