/**
 * The manuscript as text, read once and handed to every reviewer.
 *
 * @typedef {Object} Inputs
 * @property {string} file  the file's content (read for us: the port is a file path)
 */

/** @param {Inputs} inputs */
function run(inputs) {
  return { text: String(inputs.file ?? '') };
}

// ── Run on its own ─────────────────────────────────────────────────────────
// "node code.js" runs this node on the example in input.js and prints what
// comes out -- the example read as ▶ Try reads it: the JSON after the last
// "module.exports =" that is code, not one a comment or a string holds. In a
// graph the engine runs this node, and this part is left out.
if (/^code(\.js)?$/.test(process.getBuiltinModule('node:path').basename(process.argv[1] ?? ''))) {
  const { dirname, join } = process.getBuiltinModule('node:path');
  const text = process.getBuiltinModule('node:fs').readFileSync(join(dirname(process.argv[1]), 'input.js'), 'utf8');
  const stringEnd = (start) => {
    for (let at = start + 1; at < text.length; at += 1) {
      if (text[at] === '\\') at += 1;
      else if (text[at] === text[start]) return at;
    }
    return text.length;
  };
  let found = -1;
  for (let at = 0; at < text.length; at += 1) {
    const two = text.slice(at, at + 2);
    if (two === '//') at = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at);
    else if (two === '/*') at = text.indexOf('*/', at + 2) < 0 ? text.length : text.indexOf('*/', at + 2) + 1;
    else if ('"\'`'.includes(text[at])) at = stringEnd(at);
    else if (text.startsWith('module.exports', at) && !/[\w$.]/.test(text[at - 1] ?? '')) {
      const assigned = /^module\.exports\s*=(?!=)/.exec(text.slice(at));
      if (assigned) found = at + assigned[0].length;
    }
  }
  const valueFrom = (start) => {
    const from = text.slice(start).search(/\S/);
    if (from < 0) return '';
    const begin = start + from;
    if (text[begin] !== '{' && text[begin] !== '[') {
      const end = text.slice(begin).search(/;|\n/);
      return end < 0 ? text.slice(begin) : text.slice(begin, begin + end);
    }
    let depth = 0;
    for (let at = begin; at < text.length; at += 1) {
      if (text[at] === '"') at = stringEnd(at);
      else if (text[at] === '{' || text[at] === '[') depth += 1;
      else if ((text[at] === '}' || text[at] === ']') && (depth -= 1) === 0) return text.slice(begin, at + 1);
    }
    return text.slice(begin);
  };
  if (found < 0) throw new Error('input.js cannot be read: it has no "module.exports = { … };" with an example after it.');
  let example;
  try {
    example = JSON.parse(valueFrom(found));
  } catch (error) {
    throw new Error('input.js cannot be read: its example after module.exports is not plain JSON (' + error.message + ').');
  }
  if (example === null) throw new Error('input.js has no example yet: write it with ✨ Input.');
  if (typeof example !== 'object' || Array.isArray(example)) throw new Error('input.js cannot be read: its example after module.exports is not an object keyed by port, like { "input": … }.');
  const node = { llm: async () => { throw new Error('node.llm needs the engine: node engine/src/main.ts run-node <project> <node id>'); } };
  Promise.resolve(run(example, node)).then((out) => console.log(JSON.stringify(out, null, 2)));
}
