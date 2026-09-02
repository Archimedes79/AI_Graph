// The empty body of a code element, rendered as a typed, runnable stub.
//
// A generator used to be told its ports as prose — `Inputs: text, files` —
// with no type, no shape and no idea where a value came from. That is the
// least informative form of the most important fact, and small local models
// guess badly from it. The same is true for a person: a code node opened for
// the first time showed an empty textarea.
//
// So both get the same thing instead: the function signature, with one
// commented line per port saying what actually arrives there.
//
//     /**
//      * @typedef {Object} Inputs
//      * @property {string} text     // from "Reader"
//      * @property {string[]} files  // from "Ordner"
//      */
//
//     /** @param {Inputs} inputs */
//     function run(inputs) {
//       return { summary: null };
//     }
//
// JSDoc rather than TypeScript: it *is* plain JavaScript at run time, so
// nothing has to strip anything before the body runs, and the annotation
// cannot become a second contract that disagrees with the ports.
//
// **Rendered, never parsed back.** Ports are derived from the wiring; a text
// file allowed to rename one would silently detach edges.

/** How many characters of a sample value to show. Enough for the shape, not a directory listing. */
const EXAMPLE_LIMIT = 60;

function jsType(value: unknown): string {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return `${value.length ? jsType(value[0]) : '*'}[]`;
  if (value && typeof value === 'object') return 'Object';
  return '*';
}

/** The trailing comment for one input line: where it comes from, and a peek. */
function note(port: string, sources?: Record<string, string>, sample?: Record<string, unknown>): string {
  const parts: string[] = [];
  const origin = sources?.[port];
  if (origin) parts.push(`from "${origin}"`);
  if (sample && port in sample) {
    let rendered = JSON.stringify(sample[port]) ?? String(sample[port]);
    if (rendered.length > EXAMPLE_LIMIT) rendered = `${rendered.slice(0, EXAMPLE_LIMIT)}…`;
    parts.push(`e.g. ${rendered}`);
  }
  return parts.length ? `  // ${parts.join(', ')}` : '';
}

/**
 * A port id as a local variable name.
 *
 * Port ids come from the wiring and may contain characters an identifier
 * cannot (a block's ports are `<widgetId>_in`, and widget ids carry dashes).
 */
export function identifier(port: string): string {
  const cleaned = port.replace(/[^A-Za-z0-9_]/g, '_');
  return !cleaned || /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * The stub for one element's `run`.
 *
 * *sample* is what the ports actually carried on the last run, when there was
 * one; *sources* maps a port to the label of the node feeding it. Both are
 * optional — without them this is still the signature, which is still more
 * than a comma-separated list of names.
 */
export function renderSkeleton(
  inputs: string[],
  outputs: string[],
  sample?: Record<string, unknown>,
  sources?: Record<string, string>,
): string {
  const lines: string[] = [];
  if (inputs.length) {
    lines.push('/**', ' * @typedef {Object} Inputs');
    for (const port of inputs) {
      const kind = sample && port in sample ? jsType(sample[port]) : '*';
      lines.push(` * @property {${kind}} ${port}${note(port, sources, sample)}`);
    }
    lines.push(' */', '', '/** @param {Inputs} inputs */');
  }
  lines.push('function run(inputs) {');
  for (const port of inputs) lines.push(`  const ${identifier(port)} = inputs["${port}"];`);
  if (inputs.length) lines.push('');
  lines.push(outputs.length ? `  return {${outputs.map((port) => `"${port}": null`).join(', ')}};` : '  return {};');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
