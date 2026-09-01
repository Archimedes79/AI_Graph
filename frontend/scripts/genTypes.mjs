#!/usr/bin/env node
/**
 * Regenerate frontend/src/types/graph.generated.ts from the backend's Graph
 * DSL Pydantic models (backend/app/models/graph.py). This is the frontend
 * half of the schema-deduplication bridge -- `models/graph.py` is the one
 * definition of the Graph DSL, and this derives the TypeScript from it:
 *
 *   backend/app/models/graph.py
 *     -> backend/scripts/export_graph_schema.py (pydantic model_json_schema)
 *     -> frontend/scripts/graphTypesLib.mjs (json-schema-to-typescript)
 *     -> frontend/src/types/graph.generated.ts
 *
 * Run via `npm run gen:types` whenever the backend models change.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateGraphTypes, outFile } from './graphTypesLib.mjs';

async function main() {
  const ts = await generateGraphTypes();
  writeFileSync(outFile, ts, 'utf-8');
  console.log(`Wrote ${path.relative(process.cwd(), outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
