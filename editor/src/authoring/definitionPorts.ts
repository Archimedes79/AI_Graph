// A node's definitions, following its ports as they are renamed and removed.
//
// input.js and output.js are keyed by port: the example's keys, and the name of
// each @property. A port renamed in the ports editor carries its wire along
// (`portRenames`); its definitions carry the name along too, so ▶ Try runs the
// body with the value where it now looks, and `check` does not find a key that
// is no port. A port removed takes its key and its @property line with it.

import { definitionExample } from '@engine/authoring/definition.ts';

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A JSDoc `@property {type}` and the space before the name, as a group. */
const PROPERTY = '(@property\\s+\\{[^}]*\\}\\s+)';

/**
 * *text*, a definition, with its keys following *names* -- old name to new, or
 * to null for a port that is gone. A definition that cannot be read, or that
 * no rename touches, is left as it is.
 */
export function definitionFollowingPorts(text: string, names: Record<string, string | null>): string {
  const renamed = Object.keys(names);
  if (!text.trim() || !renamed.length) return text;
  const read = definitionExample(text);
  if (!('example' in read) || !Object.keys(read.example).some((key) => renamed.includes(key))) return text;
  const example: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(read.example)) {
    const now = key in names ? names[key] : key;
    if (now) example[now] = value;
  }
  let doc = text.slice(0, text.search(/\bmodule\.exports\s*=/));
  for (const [from, to] of Object.entries(names)) {
    const named = `${PROPERTY}${escaped(from)}(?![\\w$])`;
    doc = to ? doc.replace(new RegExp(named, 'g'), `$1${to}`) : doc.replace(new RegExp(`^.*${named}.*\\n?`, 'gm'), '');
  }
  return `${doc}module.exports = ${JSON.stringify(example, null, 2)};\n`;
}
