/**
 * A CSV of names and numbers -> a figure to plot, and the rows behind it.
 *
 * There is no drawing in here, and that is the point. This code runs when the
 * graph runs; the chart is resized when someone drags the window. So this node
 * says *what* to plot -- which shape, which points, what to call it -- and the
 * chart block draws it, at the size it really is and in the colours of the
 * page. Swapping the dropdown to "Donut" changes one string below, because the
 * shape is data like everything else.
 *
 * @typedef {Object} Inputs
 * @property {string} csv   the file's content; first column names, first numeric column values
 * @property {string} kind  "Horizontal bars" | "Columns" | "Line" | "Donut"
 * @property {number} top   how many rows to show, largest first
 */

/** What the dropdown on the page calls a shape, and what a chart calls it. */
const SHAPES = {
  'Horizontal bars': 'bars',
  Columns: 'columns',
  Line: 'line',
  Donut: 'donut',
};

/** Nothing to plot yet, said as a figure so the block draws its axes anyway. */
function nothing(why) {
  return { figure: { kind: 'bars', title: why, points: [] }, rows: [] };
}

function run(inputs) {
  const lines = String(inputs.csv ?? '').split(/\r?\n/).filter(function (line) { return line.trim(); });
  if (lines.length < 2) return nothing('Choose a CSV file to plot.');

  const separator = lines[0].indexOf(';') >= 0 && lines[0].indexOf(',') < 0 ? ';' : ',';
  const cells = function (line) { return line.split(separator).map(function (cell) { return cell.trim().replace(/^"|"$/g, ''); }); };
  const header = cells(lines[0]);
  const table = lines.slice(1).map(cells);

  // The first column that is numbers all the way down is what gets plotted.
  let column = -1;
  for (let c = 1; c < header.length && column < 0; c++) {
    if (table.every(function (row) { return row[c] !== '' && Number.isFinite(Number(row[c])); })) column = c;
  }
  if (column < 0) return nothing('No numeric column found in this file.');

  const all = table
    .map(function (row) { return { label: row[0], value: Number(row[column]) }; })
    .sort(function (a, b) { return b.value - a.value; });

  const top = Math.max(1, Math.min(all.length, Math.round(Number(inputs.top) || 8)));
  const shown = all.slice(0, top);
  const total = all.reduce(function (sum, row) { return sum + row.value; }, 0) || 1;
  const kind = SHAPES[String(inputs.kind ?? '')] || 'bars';

  // A donut shares out a whole, so the rows left over are a slice of their own.
  // On the other shapes they would be a bar that is not a country.
  const rest = all.slice(top).reduce(function (sum, row) { return sum + row.value; }, 0);
  const points = kind === 'donut' && rest > 0
    ? shown.concat([{ label: 'All others', value: rest }])
    : shown;

  const figure = {
    kind: kind,
    title: header[column] + ' by ' + header[0] + ' — top ' + shown.length + ' of ' + all.length,
    points: points,
  };

  const rows = shown.map(function (row, i) {
    const record = { '#': i + 1 };
    record[header[0]] = row.label;
    record[header[column]] = row.value.toLocaleString('en');
    record['Share of all'] = (100 * row.value / total).toFixed(1) + ' %';
    return record;
  });

  return { figure: figure, rows: rows };
}
