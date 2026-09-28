import { describe, it, expect } from 'vitest';
import { runExample, testGraph } from './examples.ts';
import { registry } from '../elements/registry.ts';
import { parseGraph, type Graph } from '../graph.ts';
import type { AiRequest } from '../elements/Runtime.ts';
import { quietRuntime } from '../../test/fakes.ts';

const port = (id: string, kind: 'input' | 'output', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '', ...extra });

/** A body run in this process: `run(inputs)`, as the sandbox would run it. */
const running = quietRuntime({ code: { run: async (body, inputs) => new Function('inputs', `${body}; return run(inputs);`)(inputs) } });

/** One code node counting lines, with the definitions given. */
const counter = (config: Record<string, unknown>, inputs = [port('text', 'input', { data_type: 'file_path' })]): Graph => parseGraph({
  metadata: { name: 't' },
  nodes: [{
    id: 'count', node_type: 'code', label: 'Count', inputs, outputs: [port('lines', 'output')],
    config: { code: 'function run(i) { return { lines: String(i.text ?? "").split("\\n").length }; }', ...config },
  }],
  edges: [],
});

const INPUT = 'module.exports = { "text": "a\\nb\\nc" };';

describe('a node\'s example', () => {
  it('is one call on its input.js, held to its output.js', async () => {
    const run = await runExample(counter({ input_definition: INPUT, output_definition: 'module.exports = { "lines": 3 };' }), 'count', { runtime: running, registry });
    expect(run).toEqual({ status: 'pass', details: [], outputs: { lines: 3 }, held: true });
  });

  it('is handed the example as it is: a file-reading input already holds the text, and nothing is read', async () => {
    let read = 0;
    const runtime = { ...running, files: { ...running.files, read: async () => { read += 1; return 'x'; } } };
    expect((await runExample(counter({ input_definition: INPUT }), 'count', { runtime, registry })).outputs).toEqual({ lines: 3 });
    expect(read).toBe(0);
  });

  it('is one item for a node run once per item: one call, nothing fanned out, nothing collected', async () => {
    const graph = counter({ input_definition: INPUT, output_definition: 'module.exports = { "lines": 1 };', batch_mode: 'per_item' },
      [port('text', 'input', { multi: true })]);
    graph.nodes[0].outputs[0].multi = true;
    expect(await runExample(graph, 'count', { runtime: running, registry })).toMatchObject({ status: 'pass', outputs: { lines: 3 } });
  });

  it('fails where what came out does not fit output.js, saying where', async () => {
    const run = await runExample(counter({ input_definition: INPUT, output_definition: 'module.exports = { "lines": "three", "words": 2 };' }), 'count', { runtime: running, registry });
    expect(run.status).toBe('fail');
    expect(run.details).toEqual(['output "words" is missing', 'output "lines" is a number; output.js says text']);
  });

  it('only has to run without an output.js', async () => {
    expect(await runExample(counter({ input_definition: INPUT }), 'count', { runtime: running, registry }))
      .toEqual({ status: 'pass', details: [], outputs: { lines: 3 }, held: false });
  });

  it('says what to do where there is nothing to try it on, or it cannot be read', async () => {
    expect((await runExample(counter({}), 'count', { runtime: running, registry })).details)
      .toEqual(['It has no input.js, so there is nothing to try it on: write one with ✨ Input.']);
    const broken = await runExample(counter({ input_definition: 'module.exports = { text: "a" };' }), 'count', { runtime: running, registry });
    expect(broken.status).toBe('error');
    expect(broken.details[0]).toMatch(/^Its input\.js cannot be read: its example after module.exports is not plain JSON/);
    // A node that takes nothing in is tried on nothing.
    expect((await runExample(counter({}, []), 'count', { runtime: running, registry })).status).toBe('pass');
  });

  it('says how the node failed', async () => {
    const run = await runExample(counter({ input_definition: INPUT, code: 'function run() { throw new Error("no rows"); }' }), 'count', { runtime: running, registry });
    expect(run).toMatchObject({ status: 'error', details: ['no rows'] });
  });

  it('asks the model for an ai node -- and, offline, skips it', async () => {
    const asked: AiRequest[] = [];
    const graph = parseGraph({
      metadata: { name: 't' },
      nodes: [{
        id: 'say', node_type: 'ai', label: 'Say', description: 'Count the lines.', inputs: [port('text', 'input')], outputs: [port('count', 'output')],
        config: { input_definition: INPUT, output_definition: 'module.exports = { "count": 3 };' },
      }],
      edges: [],
    });
    const runtime = quietRuntime({ ai: { complete: async (request) => { asked.push(request); return '{"count": 3}'; } } });
    expect(await runExample(graph, 'say', { runtime, registry, offline: true })).toMatchObject({ status: 'skipped' });
    expect(asked).toEqual([]);
    expect(await runExample(graph, 'say', { runtime, registry })).toMatchObject({ status: 'pass', outputs: { count: 3 } });
    expect(asked[0].prompt).toBe('a\nb\nc');
  });
});

describe('testing a graph', () => {
  const inner = counter({ input_definition: INPUT, output_definition: 'module.exports = { "lines": 3 };' });
  const graph = parseGraph({
    metadata: { name: 'outer' },
    nodes: [
      ...counter({ input_definition: INPUT, output_definition: 'module.exports = { "lines": 3 };' }).nodes,
      // Not tried, and said: it has inputs, and no input.js to try it on.
      { ...counter({}).nodes[0], id: 'plain' },
      { id: 'part', node_type: 'subgraph', label: 'Part', inputs: [], outputs: [], config: { subgraph: inner } },
    ],
    edges: [],
  });

  it('runs every node that has an example, at every depth, names the way down to it -- and says one that has none yet', async () => {
    const { tested, results } = await testGraph(graph, { runtime: () => running, registry });
    expect(tested).toBe(3);
    expect(results.map(({ inside, nodeId, result }) => `${inside}${nodeId}: ${result.status}`)).toEqual(['count: pass', 'plain: skipped', 'part ▸ count: pass']);
    expect(results[1].result.details).toEqual(['It has no input.js yet, so there is nothing to try it on: write one with ✨ Input.']);
  });

  it('runs only the node asked for, and says so where it has nothing to run it on', async () => {
    const { results } = await testGraph(graph, { runtime: () => running, registry, only: 'plain' });
    expect(results).toEqual([{ inside: '', nodeId: 'plain', result: expect.objectContaining({ status: 'error' }) }]);
  });
});
