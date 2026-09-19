/**
 * A CSV of names and numbers -> a finished chart, and the rows behind it.
 *
 * The chart is an SVG this function writes itself, so it can be more than the
 * built-in bars: sorted, labelled with the values, and drawn three ways. All
 * text is drawn in currentColor, so it reads on a dark page and a light one.
 *
 * @typedef {Object} Inputs
 * @property {string} csv   the file's content; first column names, first numeric column values
 * @property {string} kind  "Horizontal bars" | "Columns" | "Donut"
 * @property {number} top   how many rows to show, largest first
 */

const W = 720, H = 340;
const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#84cc16', '#f97316',
  '#14b8a6', '#eab308', '#8b5cf6', '#ef4444', '#0ea5e9', '#10b981', '#d946ef'];

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 1430000000 -> "1.43 B": a label that fits beside a bar. */
function short(value) {
  const size = Math.abs(value);
  const unit = size >= 1e9 ? [1e9, ' B'] : size >= 1e6 ? [1e6, ' M'] : size >= 1e3 ? [1e3, ' k'] : [1, ''];
  const scaled = value / unit[0];
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return (unit[0] === 1 && Number.isInteger(value) ? String(value) : scaled.toFixed(digits)) + unit[1];
}

/** A round number at or above the largest value, so the axis ends on a tick. */
function niceMax(value) {
  if (value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (let i = 0; i < steps.length; i++) if (steps[i] * power >= value) return steps[i] * power;
  return 10 * power;
}

function clip(label, chars) {
  return label.length <= chars ? label : label.slice(0, Math.max(1, chars - 1)) + '…';
}

function frame(title, body) {
  return '<svg width="100%" height="100%" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg"'
    + ' font-family="Inter, Segoe UI, system-ui, sans-serif">'
    + '<text x="24" y="28" font-size="15" font-weight="600" fill="currentColor">' + esc(title) + '</text>'
    + body + '</svg>';
}

function message(text) {
  return frame('', '<text x="' + (W / 2) + '" y="' + (H / 2) + '" font-size="14" text-anchor="middle"'
    + ' fill="currentColor" opacity="0.55">' + esc(text) + '</text>');
}

function horizontalBars(title, rows) {
  const left = 150, right = 84, top = 70, bottom = 14;
  const max = niceMax(rows[0].value);
  const slot = (H - top - bottom) / rows.length;
  const bar = Math.min(26, slot * 0.68);
  let body = '';
  for (let t = 0; t <= 4; t++) {
    const x = left + (W - left - right) * t / 4;
    body += '<line x1="' + x + '" y1="' + (top - 6) + '" x2="' + x + '" y2="' + (H - bottom) + '"'
      + ' stroke="currentColor" opacity="' + (t === 0 ? 0.35 : 0.1) + '"/>'
      + '<text x="' + x + '" y="' + (top - 10) + '" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.5">'
      + esc(short(max * t / 4)) + '</text>';
  }
  rows.forEach(function (row, i) {
    const y = top + slot * i + (slot - bar) / 2;
    const width = Math.max(2, (W - left - right) * row.value / max);
    body += '<text x="' + (left - 10) + '" y="' + (y + bar / 2 + 4) + '" font-size="12" text-anchor="end" fill="currentColor">'
      + esc(clip(row.label, 20)) + '</text>'
      + '<rect x="' + left + '" y="' + y + '" width="' + width + '" height="' + bar + '" rx="4" fill="' + COLORS[0] + '"'
      + ' opacity="' + (1 - 0.55 * i / Math.max(1, rows.length - 1)) + '"/>'
      + '<text x="' + (left + width + 8) + '" y="' + (y + bar / 2 + 4) + '" font-size="11" fill="currentColor" opacity="0.8">'
      + esc(short(row.value)) + '</text>';
  });
  return frame(title, body);
}

function columns(title, rows) {
  const left = 58, right = 20, top = 66, bottom = 40;
  const max = niceMax(rows[0].value);
  const slot = (W - left - right) / rows.length;
  const bar = Math.min(56, slot * 0.66);
  let body = '';
  for (let t = 0; t <= 4; t++) {
    const y = H - bottom - (H - top - bottom) * t / 4;
    body += '<line x1="' + left + '" y1="' + y + '" x2="' + (W - right) + '" y2="' + y + '"'
      + ' stroke="currentColor" opacity="' + (t === 0 ? 0.35 : 0.1) + '"/>'
      + '<text x="' + (left - 8) + '" y="' + (y + 4) + '" font-size="10" text-anchor="end" fill="currentColor" opacity="0.5">'
      + esc(short(max * t / 4)) + '</text>';
  }
  rows.forEach(function (row, i) {
    const height = Math.max(2, (H - top - bottom) * row.value / max);
    const x = left + slot * i + (slot - bar) / 2;
    const y = H - bottom - height;
    body += '<rect x="' + x + '" y="' + y + '" width="' + bar + '" height="' + height + '" rx="4" fill="' + COLORS[0] + '"'
      + ' opacity="' + (1 - 0.55 * i / Math.max(1, rows.length - 1)) + '"/>'
      + '<text x="' + (x + bar / 2) + '" y="' + (y - 6) + '" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8">'
      + esc(short(row.value)) + '</text>'
      + '<text x="' + (x + bar / 2) + '" y="' + (H - bottom + 16) + '" font-size="11" text-anchor="middle" fill="currentColor">'
      + esc(clip(row.label, Math.max(3, Math.floor(slot / 7)))) + '</text>';
  });
  return frame(title, body);
}

function donut(title, rows, rest) {
  const parts = rest > 0 ? rows.concat([{ label: 'All others', value: rest }]) : rows;
  const total = parts.reduce(function (sum, row) { return sum + row.value; }, 0) || 1;
  const cx = 190, cy = 190, outer = 120, inner = 70;
  let angle = -Math.PI / 2, body = '';
  const at = function (radius, a) { return (cx + radius * Math.cos(a)).toFixed(2) + ' ' + (cy + radius * Math.sin(a)).toFixed(2); };
  parts.forEach(function (row, i) {
    const sweep = Math.min(Math.PI * 2 - 0.0001, Math.PI * 2 * row.value / total);
    const end = angle + sweep, large = sweep > Math.PI ? 1 : 0;
    const colour = row.label === 'All others' && rest > 0 ? '#64748b' : COLORS[i % COLORS.length];
    body += '<path d="M ' + at(outer, angle) + ' A ' + outer + ' ' + outer + ' 0 ' + large + ' 1 ' + at(outer, end)
      + ' L ' + at(inner, end) + ' A ' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + at(inner, angle) + ' Z"'
      + ' fill="' + colour + '" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>';
    const ly = 62 + i * Math.min(24, 250 / parts.length);
    body += '<rect x="372" y="' + (ly - 10) + '" width="12" height="12" rx="3" fill="' + colour + '"/>'
      + '<text x="392" y="' + ly + '" font-size="12" fill="currentColor">' + esc(clip(row.label, 22)) + '</text>'
      + '<text x="' + (W - 24) + '" y="' + ly + '" font-size="11" text-anchor="end" fill="currentColor" opacity="0.7">'
      + esc(short(row.value)) + ' · ' + (100 * row.value / total).toFixed(1) + '%</text>';
    angle = end;
  });
  body += '<text x="' + cx + '" y="' + (cy - 2) + '" font-size="20" font-weight="600" text-anchor="middle" fill="currentColor">'
    + esc(short(total)) + '</text><text x="' + cx + '" y="' + (cy + 18) + '" font-size="11" text-anchor="middle"'
    + ' fill="currentColor" opacity="0.6">in total</text>';
  return frame(title, body);
}

/** @param {Inputs} inputs */
function run(inputs) {
  const lines = String(inputs.csv ?? '').split(/\r?\n/).filter(function (line) { return line.trim(); });
  if (lines.length < 2) return { drawing: message('Choose a CSV file to plot.'), rows: [] };

  const separator = lines[0].indexOf(';') >= 0 && lines[0].indexOf(',') < 0 ? ';' : ',';
  const cells = function (line) { return line.split(separator).map(function (cell) { return cell.trim().replace(/^"|"$/g, ''); }); };
  const header = cells(lines[0]);
  const table = lines.slice(1).map(cells);

  // The first column that is numbers all the way down is what gets plotted.
  let column = -1;
  for (let c = 1; c < header.length && column < 0; c++) {
    if (table.every(function (row) { return row[c] !== '' && Number.isFinite(Number(row[c])); })) column = c;
  }
  if (column < 0) return { drawing: message('No numeric column found in this file.'), rows: [] };

  const all = table
    .map(function (row) { return { label: row[0], value: Number(row[column]) }; })
    .sort(function (a, b) { return b.value - a.value; });
  const top = Math.max(1, Math.min(all.length, Math.round(Number(inputs.top) || 8)));
  const shown = all.slice(0, top);
  const rest = all.slice(top).reduce(function (sum, row) { return sum + row.value; }, 0);
  const total = all.reduce(function (sum, row) { return sum + row.value; }, 0) || 1;

  const title = header[column] + ' by ' + header[0] + ' — top ' + shown.length + ' of ' + all.length;
  const kind = String(inputs.kind ?? '');
  const drawing = kind === 'Donut' ? donut(title, shown, rest)
    : kind === 'Columns' ? columns(title, shown)
      : horizontalBars(title, shown);

  const rows = shown.map(function (row, i) {
    const record = { '#': i + 1 };
    record[header[0]] = row.label;
    record[header[column]] = row.value.toLocaleString('en');
    record['Share of all'] = (100 * row.value / total).toFixed(1) + ' %';
    return record;
  });
  return { drawing: drawing, rows: rows };
}

