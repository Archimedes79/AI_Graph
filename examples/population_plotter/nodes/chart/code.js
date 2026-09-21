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
