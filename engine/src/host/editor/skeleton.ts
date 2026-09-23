// The empty body of a code element, rendered as a typed, runnable stub.
//
// A generator used to be told its ports as prose — `Inputs: text, files` —
// with no type, no shape and no idea where a value came from. That is the
// least informative form of the most important fact, and small local models
// guess badly from it. The same is true for a person: a code node opened for
// the first time showed an empty textarea.
//
// So both get the same thing instead: the function signature, typed. What
// arrives on each port, and from where, is said in the brief above it
// (`brief.ts`), once.
//
//     /**
//      * @typedef {Object} Inputs
//      * @property {string} text
//      * @property {string[]} files
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

function jsType(value: unknown): string {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return `${value.length ? jsType(value[0]) : '*'}[]`;
  if (value && typeof value === 'object') return 'Object';
  return '*';
}

/** A declared port type (`text`, `list of file_path`) as a JSDoc type. */
function declaredType(declared: string | undefined): string {
  if (!declared) return '*';
  const list = declared.startsWith('list of ');
  const base = list ? declared.slice('list of '.length) : declared;
  const js = ({ text: 'string', file_path: 'string', number: 'number', boolean: 'boolean', json: 'Object', image: 'string' } as Record<string, string>)[base] ?? '*';
  return list ? `${js}[]` : js;
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
 * The stub for one element's `run`: the signature, typed, and nothing else.
 *
 * What each port holds, where it comes from and a sample of it are said once,
 * in the brief above the stub (`brief.ts`). They used to be said here too, as
 * comments, beside a second copy in the context -- the same wire twice, in two
 * wordings, and the sample three times.
 *
 * *sample* decides a type when it has the port -- what arrived is surer than
 * what was declared -- and *types*, the declared one, otherwise.
 */
export function renderSkeleton(
  inputs: string[],
  outputs: string[],
  sample?: Record<string, unknown>,
  types: Record<string, string> = {},
): string {
  const lines: string[] = [];
  if (inputs.length) {
    lines.push('/**', ' * @typedef {Object} Inputs');
    for (const port of inputs) {
      const kind = sample && port in sample ? jsType(sample[port]) : declaredType(types[port]);
      lines.push(` * @property {${kind}} ${port}`);
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
