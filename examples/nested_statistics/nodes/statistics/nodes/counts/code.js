function run(inputs) {
  const text = String(inputs.text ?? '');
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  const longest = words.reduce((best, word) => (word.replace(/\W/g, '').length > best.length ? word.replace(/\W/g, '') : best), '');
  return { output: { words: words.length, sentences: sentences.length, longest } };
}

// ── Run on its own ─────────────────────────────────────────────────────────
// "node code.js" runs this node on the example in input.js and prints what
// comes out. In a graph the engine runs this node, and this part is left out.
if (/^code(\.js)?$/.test(process.getBuiltinModule('node:path').basename(process.argv[1] ?? ''))) {
  const input = { exports: null };
  const file = process.getBuiltinModule('node:path').join(process.argv[1], '..', 'input.js');
  process.getBuiltinModule('node:vm').runInNewContext(process.getBuiltinModule('node:fs').readFileSync(file, 'utf8'), { module: input });
  const example = input.exports;
  if (!example || typeof example !== 'object' || Array.isArray(example)) throw new Error('input.js has no example yet -- an object keyed by input, written by ✨ Input.');
  const node = { llm: async () => { throw new Error('node.llm needs the engine: node engine/src/main.ts run-node <project> <node id>'); } };
  Promise.resolve(run(example, node)).then((out) => console.log(JSON.stringify(out, null, 2)));
}
