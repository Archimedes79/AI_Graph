function run(inputs) {
  const text = String(inputs.text ?? '');
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  const longest = words.reduce((best, word) => (word.replace(/\W/g, '').length > best.length ? word.replace(/\W/g, '') : best), '');
  return { output: { words: words.length, sentences: sentences.length, longest } };
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
