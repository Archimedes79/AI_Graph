/**
 * Shared logic for generating frontend/src/types/graph.generated.ts from the
 * backend's Graph DSL Pydantic models. Used by both `genTypes.mjs` (writes
 * the file) and `checkTypesUpToDate.mjs` (verifies it's not stale) -- see
 * AGENTS.md's "Shared contracts" section.
 */
import { compile } from 'json-schema-to-typescript';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const backendDir = path.resolve(__dirname, '../../backend');
export const exportScript = path.join(backendDir, 'scripts', 'export_graph_schema.py');
export const outFile = path.resolve(__dirname, '../src/types/graph.generated.ts');

function findPython() {
  const venvPython = process.platform === 'win32'
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function loadSchema() {
  const python = findPython();
  const stdout = execFileSync(python, [exportScript], {
    cwd: backendDir,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function generateGraphTypes() {
  const schema = loadSchema();
  return compile(schema, 'Graph', {
    bannerComment:
      '/* eslint-disable */\n' +
      '/**\n' +
      ' * AUTO-GENERATED -- DO NOT EDIT BY HAND.\n' +
      ' *\n' +
      ' * Generated from backend/app/models/graph.py via\n' +
      ' * backend/scripts/export_graph_schema.py + frontend/scripts/genTypes.mjs.\n' +
      ' * Run `npm run gen:types` after changing the backend Graph DSL models.\n' +
      ' */',
    style: { singleQuote: true },
    additionalProperties: false,
    unreachableDefinitions: true,
  });
}
