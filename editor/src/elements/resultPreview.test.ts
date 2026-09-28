import { describe, it, expect } from 'vitest';
import { errorLine, previewOf } from './resultPreview';
import { NODE_BUILDERS, WIDGET_BUILDERS } from './registry';
import { NODE_KINDS } from '@/document/nodeKinds';
import { syncGuiNodePorts } from '@/document/guiWidgets';
import type { GraphNode, NodeResult } from '@/graph';

const ran = (outputs: Record<string, unknown>, more: Partial<NodeResult> = {}): NodeResult =>
  ({ node_id: 'n', status: 'success', inputs: {}, outputs, ...more });

describe('a value as a node on the canvas shows it', () => {
  it('is a line for a text, a number or a record', () => {
    expect(previewOf('A keeper counts\n  ships for thirty-one years.')).toEqual({ kind: 'line', text: 'A keeper counts ships for thirty-one years.' });
    expect(previewOf(1419)).toEqual({ kind: 'line', text: '1419' });
    expect(previewOf(true)).toEqual({ kind: 'line', text: 'true' });
    expect(previewOf({ country: 'India', population: 1450 })).toEqual({ kind: 'line', text: 'country: India, population: 1450' });
    const long = previewOf('x'.repeat(500));
    expect(long?.kind === 'line' && long.text.length).toBe(200);
  });

  it('is how many rows, and the first of them, for a list of records', () => {
    const rows = Array.from({ length: 214 }, (_, i) => ({ name: `Town ${i}`, people: i * 10 }));
    expect(previewOf(rows)).toEqual({ kind: 'rows', count: 214, noun: 'rows', first: 'name: Town 0, people: 0' });
    expect(previewOf(['a.txt', 'b.txt'])).toEqual({ kind: 'rows', count: 2, noun: 'items', first: 'a.txt' });
    expect(previewOf([])).toMatchObject({ kind: 'rows', count: 0 });
  });

  it('is a sketch for numbers and for a chart\'s figure', () => {
    expect(previewOf([3, 1, 2])).toEqual({ kind: 'sketch', values: [3, 1, 2], line: false });
    expect(previewOf({ kind: 'line', title: 'Temperature', points: [{ label: 'Mon', value: 3 }, { label: 'Tue', value: 5 }] }))
      .toEqual({ kind: 'sketch', values: [3, 5], line: true });
  });

  it('draws a long series as sixty of its numbers, first and last among them: a node is not wider for more', () => {
    const series = Array.from({ length: 100_000 }, (_, i) => i);
    const sketch = previewOf(series);
    expect(sketch?.kind === 'sketch' && sketch.values).toHaveLength(60);
    expect(sketch?.kind === 'sketch' && [sketch.values[0], sketch.values[59], sketch.line]).toEqual([0, 99_999, true]);
  });

  it('is a thumbnail for a picture: a data URL, an image\'s address, finished SVG', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(previewOf(png)).toEqual({ kind: 'image', src: png, count: 1 });
    expect(previewOf([png, png, png])).toEqual({ kind: 'image', src: png, count: 3 });
    expect(previewOf('https://example.org/cat.jpg')).toMatchObject({ kind: 'image' });
    // A picture, where nothing in the SVG runs.
    const svg = previewOf('<svg viewBox="0 0 4 4"><circle r="2"/></svg>');
    expect(svg).toMatchObject({ kind: 'image' });
    expect(svg?.kind === 'image' && decodeURIComponent(svg.src)).toBe('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><circle r="2"/></svg>');
  });

  it('is nothing for a value that holds nothing', () => {
    for (const empty of [null, undefined, '', '   ', {}]) expect(previewOf(empty)).toBeUndefined();
  });

  it('is one line for a failure: the first thing it said', () => {
    expect(errorLine('\nNo such file: data/x.csv\n    at read (fs.ts:1)')).toBe('No such file: data/x.csv');
    expect(errorLine('')).toBe('Failed');
  });
});

describe('what a node shows of its last result, beside its ports', () => {
  it('stands under the output port it came out of', () => {
    const code = NODE_KINDS.code.create('count');
    const shown = NODE_BUILDERS.code.resultPreviews(code, ran({ output: [{ file: 'a.txt', words: 12 }] }));
    expect(shown).toEqual({ inputs: {}, outputs: { output: { kind: 'rows', count: 1, noun: 'rows', first: 'file: a.txt, words: 12' } } });
  });

  it('is an output node\'s result under the input it arrived on: it hands on what arrives', () => {
    const output = NODE_KINDS.output.create('report');
    const shown = NODE_BUILDERS.output.resultPreviews(output, ran({ value: 'Three stories, two sentences each.' }));
    expect(shown.inputs.value).toEqual({ kind: 'line', text: 'Three stories, two sentences each.' });
    expect(shown.outputs).toEqual({});
  });

  it('is, on a page, what each block shows, read by the block: points on a chart are a chart', () => {
    const blank = NODE_KINDS.gui.create('page');
    const chart = { ...WIDGET_BUILDERS.plot_window.create('Chart'), id: 'chart' };
    const photo = { ...WIDGET_BUILDERS.image_view.create('Photo'), id: 'photo' };
    const picker = { ...WIDGET_BUILDERS.input_picker.create('File'), id: 'file' };
    const page: GraphNode = syncGuiNodePorts({ ...blank, config: { ...blank.config, gui_widgets: [picker, chart, photo] } });
    const shown = NODE_BUILDERS.gui.resultPreviews(page, ran(
      { file_out: 'data/population.csv' },
      { inputs: { chart_in: [{ label: 'India', value: 1450 }, { label: 'China', value: 1419 }], photo_in: 'photo.png' },
        display: { photo: 'data:image/png;base64,iVBORw0KGgo=' } },
    ));
    expect(shown.inputs).toEqual({
      chart_in: { kind: 'sketch', values: [1450, 1419], line: false },
      photo_in: { kind: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', count: 1 },
    });
    // What a block hands on -- the chosen file -- is on the page itself.
    expect(shown.outputs).toEqual({});
  });
});
