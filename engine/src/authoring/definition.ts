// A node's two definitions, as the files its folder keeps them in: what comes
// in (`input.js`) and what goes out (`output.js`).
//
//     /**
//      * @typedef {Object} Input
//      * @property {string} csv  a CSV's text: a header row, then one row per country
//      */
//     module.exports = { "csv": "Country,Population\nIndia,1450\nChina,1419" };
//
// JavaScript, so a definition reads as code, opens with its types in an IDE and
// can be required. Its first half says the general format, in JSDoc; its second
// is one example of it, and that example is plain JSON after `module.exports =`
// -- so the engine reads it without running anything, and what ▶ Try and `test`
// run a node on is data, not code somebody wrote.
//
// **A definition is of one call.** `input.js` is what `run(inputs)` is handed,
// a file's text where an input reads its file; `output.js` is what one call
// returns. A node run once per item is handed one item, and its answers are
// collected by the executor, not by the definition.
//
// **Its keys are the node's ports**: an input definition names inputs, and an
// output definition's keys are the outputs (✨ Output sets them from it).

import { inferInterface, mismatches, type Schema } from '../execution/interface.ts';
import type { GraphNode } from '../graph.ts';
import type { TextFile } from '../elements/NodeRunner.ts';

/** A node's two definitions as it holds them, each '' while it has none. */
export interface Definitions {
  input: string;
  output: string;
}

/** Where a node that has definitions keeps them: two settings, each a file in its folder. */
export const DEFINITION_TEXTS: readonly TextFile[] = [
  { field: 'input_definition', file: 'input.js' },
  { field: 'output_definition', file: 'output.js' },
];

/** *node*'s definitions, from where `DEFINITION_TEXTS` keeps them. */
export function definitionsIn(node: Pick<GraphNode, 'config'>): Definitions {
  return { input: String(node.config.input_definition ?? ''), output: String(node.config.output_definition ?? '') };
}

/** A definition's example, or the sentence that says why it cannot be read. */
export type DefinitionExample = { example: Record<string, unknown> } | { problem: string };

const EXPORTS = /\bmodule\.exports\s*=/;

/**
 * The example *text* holds: the JSON after `module.exports =`, up to the
 * final `;`, parsed -- or a sentence saying why it is not one, for a person
 * or a model to fix.
 */
export function definitionExample(text: string): DefinitionExample {
  const found = EXPORTS.exec(text);
  if (!found) return { problem: 'it has no "module.exports = { … };" with an example after it' };
  const rest = text.slice(found.index + found[0].length).trim();
  // Up to the final `;`: a comment after it is the file's, not the example's.
  const json = rest.endsWith(';') ? rest.slice(0, -1) : rest.includes(';') ? rest.slice(0, rest.lastIndexOf(';')) : rest;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return {
      problem: `its example after module.exports is not plain JSON (${(error as Error).message}): `
        + 'write it with double-quoted keys and strings, no comments and no trailing commas',
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { problem: 'its example after module.exports is not an object keyed by port, like { "input": … }' };
  }
  return { example: value as Record<string, unknown> };
}

/** The ports *text* names: its example's keys, none when it cannot be read. */
export function definitionKeys(text: string): string[] {
  const read = definitionExample(text);
  return 'example' in read ? Object.keys(read.example) : [];
}

/** The shape of what one call returns, as an output definition's example has it; none when it cannot be read. */
export function definitionShape(text: string): Schema | undefined {
  const read = definitionExample(text);
  return 'example' in read ? inferInterface(read.example) : undefined;
}

/**
 * Where *outputs* -- what one call returned -- do not fit the output
 * definition *text*, as sentences naming the place: a key it names that is
 * missing, a value of another shape. Empty when they fit, and when the
 * definition cannot be read (`check` says so, once, and not at every try).
 */
export function misfits(outputs: Record<string, unknown>, text: string): string[] {
  const shape = definitionShape(text);
  return shape ? mismatches(outputs, shape) : [];
}
