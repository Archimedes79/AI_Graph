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
// `node code.js` runs this node on the example in input.js and prints what
// comes out. In a graph it is run by the engine, and this part is skipped.
if (typeof module !== 'undefined' && require.main === module) {
  const example = require('./input.js');
  if (example == null) throw new Error('input.js has no example yet: write it with ✨ Input.');
  const node = { llm: async () => { throw new Error('node.llm needs the engine: node engine/src/main.ts run-node <project> <node id>'); } };
  Promise.resolve(run(example, node)).then((out) => console.log(JSON.stringify(out, null, 2)));
}
