#!/usr/bin/env node
/**
 * CI guard: fail if frontend/src/types/graph.generated.ts is stale relative
 * to backend/app/models/graph.py. Regenerates the types in-memory (no write)
 * and diffs against the committed file; run via `npm run gen:types:check`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateGraphTypes, outFile } from './graphTypesLib.mjs';

async function main() {
  const fresh = await generateGraphTypes();
  const committed = readFileSync(outFile, 'utf-8');
  if (fresh !== committed) {
    console.error(
      `${path.relative(process.cwd(), outFile)} is out of date relative to ` +
      'backend/app/models/graph.py. Run `npm run gen:types` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`${path.relative(process.cwd(), outFile)} is up to date.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
