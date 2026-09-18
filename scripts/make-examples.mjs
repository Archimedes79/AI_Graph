#!/usr/bin/env node
// Writes the example graphs that carry real code.
//
// A graph stores a node's body as a JSON string, and a forty-line function
// written by hand into a JSON string is forty lines of `\n` and `\"` that no
// editor checks. So the bodies are written here as JavaScript, the page's
// ports are asked of the engine rather than typed out, and the JSON is what
// comes out the other end:
//
//     node scripts/make-examples.mjs
//
// The examples it writes are committed; this is how they are changed.

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registry } from '../engine/src/elements/registry.ts';
import { RUN_PORT } from '../engine/src/execution/triggers.ts';

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const MODEL = { provider: 'google', model: 'gemini-flash-lite-latest' };

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

const port = (id, name, kind, data_type = 'any', multi = false, description = '') =>
  ({ id, name, kind, data_type, multi, required: false, description });
const input = (id, name, type, multi, description) => port(id, name, 'input', type, multi, description);
const output = (id, name, type, multi, description) => port(id, name, 'output', type, multi, description);

let edgeCount = 0;
const wire = (from, fromPort, to, toPort) => ({
  id: `e${++edgeCount}`, source_node_id: from, source_port_id: fromPort, target_node_id: to, target_port_id: toPort,
});

const block = (id, kind, rest = {}) => ({ id, kind, label: '', tone: 'plain', w: 16, h: 1, ...rest });
const heading = (value) => block('title', 'text', { mode: 'heading', value });
const caption = (id, value) => block(id, 'text', { mode: 'caption', value });
const rule = (id = 'rule') => block(id, 'divider', { mode: 'horizontal' });

/** A page node, with the ports its blocks really contribute -- asked, not typed. */
function page(id, label, position, widgets, size = { width: 340, height: 260 }) {
  const node = {
    id, node_type: 'gui', label, description: 'The page this tool shows',
    position, ...size, inputs: [], outputs: [], config: { gui_widgets: widgets },
  };
  const ports = registry.node('gui').derivedPorts(node);
  return { ...node, inputs: ports.inputs, outputs: ports.outputs };
}

function ai(id, label, position, { description, system, template = '', inputs, config = {} }) {
  return {
    id, node_type: 'ai', label, description, position, inputs,
    outputs: [output('output', 'Output', 'text', false, 'What the model answered')],
    config: {
      ai_provider: MODEL.provider, ai_model: MODEL.model, temperature: 0.3,
      system_prompt: system, prompt_template: template,
      output_format: 'text', batch_mode: 'whole_list', read_file_inputs: false, ...config,
    },
  };
}

function code(id, label, position, { description, prompt, body, inputs, outputs, config = {} }) {
  return {
    id, node_type: 'code', label, description, position, inputs, outputs,
    config: { code: `${body.trim()}\n`, code_prompt: prompt, batch_mode: 'whole_list', read_file_inputs: false, ...config },
  };
}

function graph(file, metadata, nodes, edges) {
  const document = {
    metadata: {
      version: '1.0.0', author: 'AI-Graph', ai_defaults: MODEL, gui_scheme: 'night', ...metadata,
    },
    nodes, edges,
  };
  writeFileSync(join(EXAMPLES, file), `${JSON.stringify(document, null, 2)}\n`);
  process.stderr.write(`wrote examples/${file}\n`);
}

// ---------------------------------------------------------------------------
// 1. Read a file, summarize it
// ---------------------------------------------------------------------------

const READER = String.raw`
/**
 * The chosen file, as text -- and one line saying what it is.
 *
 * @typedef {Object} Inputs
 * @property {string} file  the file's content (read for us: the port is a file path)
 * @property {string} path  the same file's path, for its name
 */

/** @param {Inputs} inputs */
function run(inputs) {
  const text = String(inputs.file ?? '');
  const name = String(inputs.path ?? '').split(/[\\/]/).pop() || 'no file chosen';
  const words = text.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return {
    text,
    info: name + '\n' + words.toLocaleString('en') + ' words · ' + text.length.toLocaleString('en')
      + ' characters · about ' + minutes + ' min to read',
  };
}
`;

edgeCount = 0;
graph('file_summarizer.json', {
  name: 'File reader & summarizer',
  description: 'Pick a text file, read it, and have a model summarize it. Choosing a file or pressing Summarize starts the graph at the reader; changing the length re-runs only the summary. Paths are relative to the working directory, so run this from the repository root.',
  tags: ['example', 'gui', 'ai', 'triggers'],
}, [
  page('page', 'Summarizer', { x: 60, y: 120 }, [
    heading('File reader & summarizer'),
    caption('intro', 'Choose a text file — it is read and summarized straight away. Change the length and it is summarized again.'),
    block('file', 'input_picker', {
      label: 'File', mode: 'file', value: 'examples/data/stories/01_the_lighthouse_keeper.txt', extensions: '.txt,.md',
      run_on_change: true, tone: 'sunken', w: 9, h: 2,
    }),
    block('length', 'select', {
      label: 'Length', options: 'One sentence\nThree sentences\nFive bullet points', value: 'Three sentences',
      run_on_change: true, tone: 'sunken', w: 4, h: 2,
    }),
    block('go', 'button', { label: 'Summarize', w: 3, h: 2 }),
    rule(),
    block('summary', 'text_io', { label: 'Summary', mode: 'output', tone: 'raised', w: 10, h: 5 }),
    block('about', 'text_io', { label: 'About the file', mode: 'output', tone: 'raised', w: 6, h: 5 }),
    block('content', 'text_io', { label: 'What was read', mode: 'output', tone: 'raised', w: 16, h: 6 }),
  ]),
  code('reader', 'Read file', { x: 840, y: 40 }, {
    description: 'Reads the chosen file and says what it is',
    prompt: 'Pass the file\'s text on, and describe the file in one line: its name, word count, character count and reading time.',
    body: READER,
    inputs: [
      input('file', 'File', 'file_path', false, 'The chosen file; arrives as its content'),
      input('path', 'Path', 'text', false, 'The same file\'s path, for its name'),
    ],
    outputs: [output('text', 'Text', 'text', false, 'The file\'s content'), output('info', 'Info', 'text', false, 'One line about the file')],
    config: { read_file_inputs: true },
  }),
  ai('summarizer', 'Summarize', { x: 1140, y: 180 }, {
    description: 'Summarize the text faithfully, at the length asked for.',
    system: 'You summarize texts faithfully. Say what the text is about and what it comes to; add nothing that is not in it and do not judge it. Answer in the language of the text. Output the summary only — no preamble, no title.',
    template: 'Length of the summary: {{length}}\n\nThe text:\n{{text}}',
    inputs: [
      input('text', 'Text', 'text', false, 'What to summarize'),
      input('length', 'Length', 'text', false, 'How long the summary should be'),
    ],
  }),
], [
  wire('page', 'file_out', 'reader', 'file'),
  wire('page', 'file_out', 'reader', 'path'),
  wire('page', 'go_out', 'reader', RUN_PORT),
  wire('reader', 'text', 'summarizer', 'text'),
  wire('page', 'length_out', 'summarizer', 'length'),
  wire('summarizer', 'output', 'page', 'summary_in'),
  wire('reader', 'info', 'page', 'about_in'),
  wire('reader', 'text', 'page', 'content_in'),
]);

// ---------------------------------------------------------------------------
// 2. Summarize every file in a folder
// ---------------------------------------------------------------------------

const ROWS = String.raw`
/**
 * One row per file: its name beside its summary.
 *
 * @typedef {Object} Inputs
 * @property {string[]} files      every path in the folder
 * @property {string[]} summaries  one summary per file, in the same order
 */

/** @param {Inputs} inputs */
function run(inputs) {
  const files = [].concat(inputs.files ?? []);
  const summaries = [].concat(inputs.summaries ?? []);
  return {
    rows: files.map(function (path, index) {
      return {
        File: String(path).split(/[\\/]/).pop(),
        Summary: summaries[index] == null ? '(no summary — this file failed)' : String(summaries[index]).trim(),
      };
    }),
  };
}
`;

edgeCount = 0;
graph('folder_summaries.json', {
  name: 'Summarize a folder',
  description: 'Every text file in a folder is summarized on its own — the AI node runs once per file — and a second AI node then says what the files have in common. Paths are relative to the working directory, so run this from the repository root.',
  tags: ['example', 'gui', 'ai', 'batch', 'triggers'],
}, [
  page('page', 'Folder summaries', { x: 60, y: 140 }, [
    heading('Summarize a folder'),
    caption('intro', 'Every .txt file in the folder gets its own two-sentence summary; then one paragraph on what they share.'),
    block('folder', 'input_picker', {
      label: 'Folder', mode: 'directory', value: 'examples/data/stories', extensions: '.txt', select_all_files: true,
      tone: 'sunken', w: 12, h: 2,
    }),
    block('go', 'button', { label: 'Summarize all', w: 4, h: 2 }),
    rule(),
    block('table', 'table', { label: 'Each file', w: 16, h: 5 }),
    block('overall', 'text_io', { label: 'What they have in common', mode: 'output', tone: 'raised', w: 16, h: 4 }),
  ]),
  ai('per_file', 'Each file', { x: 840, y: 20 }, {
    description: 'Summarize one story in exactly two sentences.',
    system: 'You summarize short stories. Answer with exactly two sentences: the first says what happens, the second what it comes to. Do not repeat the title and do not judge the story. Answer in the language of the story, with the two sentences only.',
    inputs: [input('story', 'Story', 'file_path', true, 'One file per run; arrives as its content')],
    config: { batch_mode: 'per_item', read_file_inputs: true, batch_concurrency: 3 },
  }),
  code('rows', 'Table rows', { x: 1140, y: 0 }, {
    description: 'Puts each file name beside its summary',
    prompt: 'Make one table row per file: the file name and its summary.',
    body: ROWS,
    inputs: [
      input('files', 'Files', 'any', true, 'Every path in the folder'),
      input('summaries', 'Summaries', 'text', true, 'One per file, same order'),
    ],
    outputs: [output('rows', 'Rows', 'json', false, 'A list of {File, Summary}')],
  }),
  ai('overall', 'In common', { x: 1140, y: 220 }, {
    description: 'Say what the stories share, from their summaries.',
    system: 'You are given the summaries of several short stories from one collection. Write one paragraph of at most four sentences on what the stories have in common: shared motifs, the kind of people in them, the attitude of the telling. Do not retell the plots. Answer in the language of the summaries.',
    inputs: [input('summaries', 'Summaries', 'text', true, 'Every summary, as paragraphs')],
    config: { temperature: 0.4 },
  }),
], [
  wire('page', 'folder_out', 'per_file', 'story'),
  wire('page', 'go_out', 'per_file', RUN_PORT),
  wire('page', 'folder_out', 'rows', 'files'),
  wire('per_file', 'output', 'rows', 'summaries'),
  wire('per_file', 'output', 'overall', 'summaries'),
  wire('rows', 'rows', 'page', 'table_in'),
  wire('overall', 'output', 'page', 'overall_in'),
]);

// ---------------------------------------------------------------------------
// 3. Plot population data
// ---------------------------------------------------------------------------

const CHART = String.raw`
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
`;

edgeCount = 0;
graph('population_plotter.json', {
  name: 'Population plotter',
  description: 'Plot a CSV of names and numbers — here, the population of countries — as sorted bars, columns or a donut, with the rows beside it. No model involved: one code node draws the chart as SVG. Every control on the page redraws it at once. Paths are relative to the working directory, so run this from the repository root.',
  tags: ['example', 'gui', 'plot', 'csv', 'triggers'],
  ai_defaults: { provider: 'default', model: '' },
}, [
  page('page', 'Plotter', { x: 60, y: 120 }, [
    heading('Population plotter'),
    caption('intro', 'A CSV with names in the first column and numbers in another. Change anything and the chart redraws.'),
    block('file', 'input_picker', {
      label: 'CSV file', mode: 'file', value: 'examples/data/population.csv', extensions: '.csv',
      run_on_change: true, tone: 'sunken', w: 7, h: 2,
    }),
    block('kind', 'select', {
      label: 'Chart', options: 'Horizontal bars\nColumns\nDonut', value: 'Horizontal bars',
      run_on_change: true, tone: 'sunken', w: 3, h: 2,
    }),
    block('top', 'slider', { label: 'How many', min: 3, max: 15, step: 1, value: 8, run_on_change: true, tone: 'sunken', w: 4, h: 2 }),
    block('go', 'button', { label: 'Plot', w: 2, h: 2 }),
    block('plot', 'plot_window', { label: '', w: 16, h: 7 }),
    block('table', 'table', { label: 'The rows plotted', w: 16, h: 5 }),
  ], { width: 340, height: 300 }),
  code('chart', 'Draw chart', { x: 840, y: 160 }, {
    description: 'Parses the CSV and draws it',
    prompt: 'Read the CSV (names in the first column, values in the first numeric column), keep the largest "top" rows, and draw them as an SVG chart of the chosen kind: horizontal bars, columns, or a donut with a legend. Also return the plotted rows for a table.',
    body: CHART,
    inputs: [
      input('csv', 'CSV', 'file_path', false, 'The chosen file; arrives as its content'),
      input('kind', 'Chart', 'text', false, 'Horizontal bars, Columns or Donut'),
      input('top', 'How many', 'any', false, 'How many rows to show'),
    ],
    outputs: [
      output('drawing', 'Drawing', 'text', false, 'A finished SVG document'),
      output('rows', 'Rows', 'json', false, 'The plotted rows, for a table'),
    ],
    config: { read_file_inputs: true, output_format: 'custom', output_format_prompt: 'drawing: an SVG document as a string; rows: a list of objects with the same keys' },
  }),
], [
  wire('page', 'file_out', 'chart', 'csv'),
  wire('page', 'kind_out', 'chart', 'kind'),
  wire('page', 'top_out', 'chart', 'top'),
  wire('page', 'go_out', 'chart', RUN_PORT),
  wire('chart', 'drawing', 'page', 'plot_in'),
  wire('chart', 'rows', 'page', 'table_in'),
]);

// ---------------------------------------------------------------------------
// 4. A chatbot: a page and a model
// ---------------------------------------------------------------------------

edgeCount = 0;
graph('chat.json', {
  name: 'Chat',
  description: 'A chatbot is two nodes: a page with a chat block, and a model. Sending a message starts the graph at the AI node; the answer comes back into the conversation, and the conversation goes out again as history with the next message.',
  tags: ['example', 'chat', 'gui', 'ai', 'triggers'],
}, [
  page('page', 'Chat', { x: 60, y: 140 }, [
    heading('Chat'),
    caption('intro', 'Type a message and press Enter. The model sees the whole conversation each time.'),
    block('chat', 'chat', { label: 'Chat', value: { messages: [], pending: '' }, w: 16, h: 8 }),
  ], { width: 340, height: 220 }),
  ai('assistant', 'Assistant', { x: 840, y: 150 }, {
    description: 'Answer the user\'s last message as a friendly, concise assistant that remembers the conversation.',
    system: 'You are a friendly, concise assistant in a chat window.\n\nYou are given the conversation so far and the user\'s newest message. Answer the newest message, using the conversation for context. Answer in the language the user writes in. Use Markdown where it helps (lists, **bold**, `code`), and keep answers short unless asked for detail. Reply with the answer only — do not prefix it with "Assistant:".',
    template: 'Conversation so far:\n{{history}}\n\nUser: {{message}}',
    inputs: [
      input('history', 'History', 'text', false, 'The conversation so far'),
      // Required: with nothing typed there is nothing to answer, and ▶ Run on an
      // empty box must not put a reply to nobody into the conversation.
      { ...input('message', 'Message', 'text', false, 'What the user just said'), required: true },
    ],
    config: { temperature: 0.7 },
  }),
], [
  wire('page', 'chat_out', 'assistant', 'message'),
  wire('page', 'chat_history', 'assistant', 'history'),
  wire('assistant', 'output', 'page', 'chat_in'),
]);
