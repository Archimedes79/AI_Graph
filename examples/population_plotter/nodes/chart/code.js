/**
 * A CSV of names and numbers -> what the chart should show.
 *
 * Names are in the first column; the first column that is numbers all the way
 * down is what gets plotted, largest first. Nothing is drawn here: this says
 * *what* to plot, and the chart block on the page draws it.
 *
 * @typedef {Object} Inputs
 * @property {string} csv  the content of the chosen file
 */

function run(inputs) {
  const lines = String(inputs.csv ?? '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { figure: { kind: 'bars', title: 'Choose a CSV file to plot.', points: [] } };

  const separator = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const cells = (line) => line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ''));
  const header = cells(lines[0]);
  const rows = lines.slice(1).map(cells);

  const column = header.findIndex((_, c) => c > 0 && rows.every((row) => row[c] !== '' && Number.isFinite(Number(row[c]))));
  if (column < 0) return { figure: { kind: 'bars', title: 'No numeric column found in this file.', points: [] } };

  const points = rows
    .map((row) => ({ label: row[0], value: Number(row[column]) }))
    .sort((a, b) => b.value - a.value);

  return { figure: { kind: 'bars', title: `${header[column]} by ${header[0]}`, points } };
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
