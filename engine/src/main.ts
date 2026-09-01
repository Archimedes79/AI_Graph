#!/usr/bin/env node
// The executable entry point: `node src/main.ts graph.json`.
//
// Separate from cli.ts so that everything there stays importable and testable
// without a process exiting in the middle of a test run.
import { main } from './cli.ts';

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
