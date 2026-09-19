#!/usr/bin/env node
// The executable entry point: `node src/main.ts graph.json`.
//
// Separate from cli.ts so that everything there stays importable and testable
// without a process exiting in the middle of a test run.
//
// The exit code is set, not forced with `process.exit()`: a run that made
// model calls in parallel still has keep-alive connections closing when it
// ends, and exiting in the middle of that aborts Node on Windows
// (`UV_HANDLE_CLOSING`) -- a successful run reported as a crash. The process
// ends by itself once they are closed.
import { main } from './cli/cli.ts';

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
