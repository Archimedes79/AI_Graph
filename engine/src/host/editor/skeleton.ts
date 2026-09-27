// The empty body of a code node, as the stub ✨ Code completes.
//
// A generator used to be told its ports as prose — `Inputs: text, files` —
// with no type, no shape and no idea where a value came from. That is the
// least informative form of the most important fact, and small local models
// guess badly from it. The node's definitions say all of it now, as types in
// `input.js` and `output.js`, so the stub names them rather than typing the
// ports a second time:
//
//     /**
//      * @param {import('./input.js').Input} inputs
//      * @returns {import('./output.js').Output}
//      */
//     function run(inputs) {
//       const csv = inputs["csv"];
//
//       return {"figure": null};
//     }
//
// JSDoc rather than TypeScript: it *is* plain JavaScript at run time, so
// nothing has to strip anything before the body runs, and an IDE opening the
// node's folder follows the types to the files that define them.
//
// **Rendered, never parsed back.** Ports are derived from the wiring; a text
// file allowed to rename one would silently detach edges.

/**
 * A port id as a local variable name.
 *
 * Port ids come from the wiring and may contain characters an identifier
 * cannot (a block's ports are `<widgetId>_in`, and widget ids carry dashes).
 */
function identifier(port: string): string {
  const cleaned = port.replace(/[^A-Za-z0-9_]/g, '_');
  return !cleaned || /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** The stub for one code node's `run`: the signature, typed by its definitions, and nothing else. */
export function renderSkeleton(inputs: string[], outputs: string[]): string {
  const lines: string[] = [];
  if (inputs.length || outputs.length) {
    lines.push('/**');
    if (inputs.length) lines.push(" * @param {import('./input.js').Input} inputs");
    if (outputs.length) lines.push(" * @returns {import('./output.js').Output}");
    lines.push(' */');
  }
  lines.push('function run(inputs) {');
  for (const port of inputs) lines.push(`  const ${identifier(port)} = inputs["${port}"];`);
  if (inputs.length) lines.push('');
  lines.push(outputs.length ? `  return {${outputs.map((port) => `"${port}": null`).join(', ')}};` : '  return {};');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
