/**
 * The engine's shells ask the element; they never switch on its name.
 *
 * The executor, the project folder, `check`, the server and the CLI may not
 * compare a node's type with a literal. What such a comparison would decide is a
 * member of the element's class (`isResult`, `hasInterface`, `problems`,
 * `readsFileInputs`), so a new kind answers for itself and nothing shared has to
 * change. The editor holds the same line in `elements/shells.test.ts`.
 *
 * One file is allowed to read the document without asking: `execution/triggers.ts`
 * lists a graph's trigger nodes so that a scheduler needs no registry.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ALLOWED = new Set(['execution/triggers.ts']);
const TYPE_SWITCH = /\b(node_type|nodeType)\s*[!=]==?\s*['"]/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : [path];
  });
}

const SHELLS = sources(ROOT)
  .map((path) => ({ path, name: relative(ROOT, path).split(sep).join('/') }))
  .filter(({ name }) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !name.startsWith('elements/') && !ALLOWED.has(name));

describe('the engine shells', () => {
  it('are found, so the rule below is checked against something', () => {
    expect(SHELLS.length).toBeGreaterThan(30);
  });

  it('never compare a node type with a name', () => {
    const offending = SHELLS.flatMap(({ path, name }) => readFileSync(path, 'utf8').split('\n')
      .map((line, index) => ({ line, at: `${name}:${index + 1}` }))
      .filter(({ line }) => TYPE_SWITCH.test(line.replace(/typeof\s+\S+/g, '')) && !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .map(({ at, line }) => `${at}  ${line.trim()}`));
    expect(offending).toEqual([]);
  });
});
