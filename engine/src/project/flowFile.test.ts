import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraph } from '../graph.ts';
import { loadGraph, saveGraph } from './folder.ts';
import { checkPath } from './check.ts';
import { describeFlow } from './flowFile.ts';

const port = (id: string, kind: 'input' | 'output', type = 'text') =>
  ({ id, name: id, kind, data_type: type, multi: false, required: false, description: '' });

/** A page with a button and a dropdown, a gated reader, a per-item model call, and the answer shown on the page. */
const graph = () => parseGraph({
  metadata: { name: 'Flows', description: 'Reads a folder and says what is in it.' },
  nodes: [
    { id: 'page', node_type: 'gui', label: 'Page', config: { gui_widgets: [
      { id: 'go', kind: 'button' }, { id: 'folder', kind: 'input_picker', mode: 'directory' }, { id: 'shown', kind: 'text_io', mode: 'output' },
    ] }, inputs: [], outputs: [] },
    { id: 'each-file', node_type: 'ai', label: 'Each file', description: 'Summarize one file.',
      config: { batch_mode: 'per_item', read_file_inputs: true, prompt_template: '{{story}}' },
      inputs: [{ ...port('story', 'input', 'file_path'), multi: true }], outputs: [{ ...port('output', 'output'), multi: true }] },
    { id: 'rows', node_type: 'code', label: 'Rows', config: { code: 'function run(i) { return { rows: [] }; }' },
      inputs: [port('files', 'input'), port('summaries', 'input')], outputs: [port('rows', 'output')] },
  ],
  edges: [
    { id: 'g', source_node_id: 'page', source_port_id: 'go_out', target_node_id: 'each-file', target_port_id: '__run' },
    { id: 's', source_node_id: 'page', source_port_id: 'folder_out', target_node_id: 'each-file', target_port_id: 'story' },
    { id: 'f', source_node_id: 'page', source_port_id: 'folder_out', target_node_id: 'rows', target_port_id: 'files' },
    { id: 'm', source_node_id: 'each-file', source_port_id: 'output', target_node_id: 'rows', target_port_id: 'summaries' },
    { id: 'b', source_node_id: 'rows', source_port_id: 'rows', target_node_id: 'page', target_port_id: 'shown_in' },
  ],
});

describe('flow.js', () => {
  it('says the wiring as code: one call per node, in the order a run takes, each handed its wires by name', () => {
    const flow = describeFlow(graph());
    const body = flow.slice(flow.indexOf('async function flow(node) {'));
    const code = body.split('\n').filter((line) => line.trim() && !line.trim().startsWith('//')).join('\n');
    expect(code).toBe([
      'async function flow(node) {',
      '  const page = await node.page();',
      // An id that is no JavaScript name becomes one; the gate, the fan-out and the file reading are said.
      '  const each_file = await node.each_file(',
      '    { story: page.folder_out },',
      '    { gate: page.go_out, each: true, readFiles: true },',
      '  );',
      '  const rows = await node.rows({ files: page.folder_out, summaries: each_file.output });',
      // What closes the loop reaches the page once the round is done.
      '  node.page.next({ shown_in: rows.rows });',
      '}',
    ].join('\n'));
  });

  it('names what each node runs, in the words of its panel, and which of its ports start a round', () => {
    const flow = describeFlow(graph());
    expect(flow).toContain('// Each file · ai · nodes/each-file/run.js · id "each-file"');
    expect(flow).toContain('// Rows · code · nodes/rows/code.js');
    expect(flow).toContain('// Page · gui · engine/src/elements/nodes/gui/GuiNodeRunner.ts › execute');
    expect(flow).toContain('// starts a round: go_out');
    expect(flow).toContain('// Summarize one file.');
  });

  it('is JavaScript, whatever the ids and ports are called', () => {
    const odd = parseGraph({
      metadata: { name: 'Odd' },
      nodes: [
        { id: '1st', node_type: 'input', config: { input_mode: 'text' }, inputs: [], outputs: [] },
        { id: 'class', node_type: 'code', config: { code: 'function run(i) { return i; }' }, inputs: [port('my-port', 'input')], outputs: [port('out put', 'output')] },
        { id: 'class ', node_type: 'output', config: {}, inputs: [port('value', 'input')], outputs: [] },
      ],
      edges: [
        { id: 'a', source_node_id: '1st', source_port_id: 'output', target_node_id: 'class', target_port_id: 'my-port' },
        { id: 'b', source_node_id: 'class', source_port_id: 'out put', target_node_id: 'class ', target_port_id: 'value' },
      ],
    });
    const flow = describeFlow(odd);
    expect(() => new Function(`'use strict'; ${flow}; return flow;`)).not.toThrow();
    expect(flow).toContain('const _class = await node._class({ "my-port": _1st.output });');
    expect(flow).toContain('await node.class_({ value: _class["out put"] });');
  });

  it('never fails a save: whatever a hand-written graph.json holds where a name belongs is said as text', () => {
    const odd = graph();
    (odd.metadata as unknown as Record<string, unknown>).name = ['a', 'list'];
    (odd.metadata as unknown as Record<string, unknown>).description = 2024;
    expect(() => describeFlow(odd)).not.toThrow();
    expect(describeFlow(odd).split('\n').slice(0, 2)).toEqual(['// ["a","list"]', '// 2024']);
  });

  it('names a node\'s folder as the folder layer does, and is JavaScript for a strict reader too', () => {
    const strict = parseGraph({
      metadata: { name: 'Strict' },
      nodes: [
        { id: 'interface', node_type: 'input', config: { input_mode: 'text' }, inputs: [], outputs: [] },
        { id: 'my node', node_type: 'code', config: { code: 'function run(i) { return i; }' }, inputs: [port('value', 'input')], outputs: [] },
      ],
      edges: [{ id: 'a', source_node_id: 'interface', source_port_id: 'output', target_node_id: 'my node', target_port_id: 'value' }],
    });
    const flow = describeFlow(strict);
    expect(flow).toContain('· nodes/my_node/code.js · id "my node"');
    expect(() => new Function(`'use strict'; ${flow}; return flow;`)).not.toThrow();
  });

  it('breaks a call that would not fit a line, one wire a line', () => {
    const wide = parseGraph({
      metadata: { name: 'Wide' },
      nodes: [
        ...['alpha', 'beta', 'gamma', 'delta'].map((id) => ({ id: `reviewer_${id}`, node_type: 'input', config: { input_mode: 'text' }, inputs: [], outputs: [] })),
        { id: 'judge', node_type: 'output', config: {}, inputs: ['alpha', 'beta', 'gamma', 'delta'].map((id) => port(`review_by_${id}`, 'input')), outputs: [] },
      ],
      edges: ['alpha', 'beta', 'gamma', 'delta'].map((id) => (
        { id, source_node_id: `reviewer_${id}`, source_port_id: 'output', target_node_id: 'judge', target_port_id: `review_by_${id}` })),
    });
    expect(describeFlow(wide)).toContain('  await node.judge({\n    review_by_alpha: reviewer_alpha.output,\n');
    expect(Math.max(...describeFlow(wide).split('\n').map((line) => line.length))).toBeLessThanOrEqual(100);
  });
});

describe('flow.js in a project folder', () => {
  it('is written beside graph.json on every save, and in the folder of a graph inside a node', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-'));
    await saveGraph(dir, graph());
    expect(await readFile(join(dir, 'flow.js'), 'utf8')).toBe(describeFlow(graph()));
    expect((await checkPath(dir)).problems).toEqual([]);

    const examples = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples');
    const nested = await loadGraph(join(examples, 'nested_statistics'));
    const copy = await mkdtemp(join(tmpdir(), 'flow-nested-'));
    await saveGraph(copy, nested);
    expect(existsSync(join(copy, 'nodes', 'statistics', 'flow.js'))).toBe(true);
    expect((await checkPath(copy)).problems).toEqual([]);
  });

  it('is rendered, never read back: edited outside, it is replaced and nothing is refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-'));
    await saveGraph(dir, graph());
    await writeFile(join(dir, 'flow.js'), 'async function flow(node) { await node.something_else(); }\n');
    const loaded = await loadGraph(dir);
    expect(loaded.nodes.map((node) => node.id)).toEqual(['page', 'each-file', 'rows']);
    await saveGraph(dir, loaded);
    expect(await readFile(join(dir, 'flow.js'), 'utf8')).toContain('await node.each_file(');
  });
});
