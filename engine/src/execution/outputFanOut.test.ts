import { describe, it, expect } from 'vitest';
import type { Graph, GraphNode, Port } from '../graph.ts';
import { executeGraph } from './executor.ts';
import { type Runtime } from '../elements/Runtime.ts';
import { registry } from '../elements/registry.ts';

/**
 * An output node takes what arrives whole, whatever an older file says.
 *
 * The editor used to save `batch_mode: "per_item"` on every node it made, and
 * the executor fanned out on it for every kind. An output node writing to a
 * file then wrote each item over the same file, the last one winning, and one
 * writing to a folder wrote `value.txt` once per item instead of `value_1..3`.
 * Only code and ai run once per item now (`NodeRunner.fansOut`).
 */

const list = (id: string): Port => ({ id, name: id, kind: 'output', data_type: 'any', multi: true, required: false, description: '' });
const into = (id: string, multi: boolean): Port => ({ id, name: id, kind: 'input', data_type: 'any', multi, required: false, description: '' });

/** A data node holding *value*, wired into an output node set up as an older editor saved it. */
function graph(value: unknown, output: Record<string, unknown>, extra: { paths?: unknown[] } = {}): Graph {
  const nodes: GraphNode[] = [
    {
      id: 'items', node_type: 'data', label: 'Items', description: '', position: { x: 0, y: 0 },
      inputs: [], outputs: [list('output')], config: { data_value: value, data_format: 'structure' },
    },
    {
      id: 'out', node_type: 'output', label: 'Out', description: '', position: { x: 0, y: 0 },
      inputs: [into('value', true), into('path', !!extra.paths)], outputs: [],
      config: { batch_mode: 'per_item', output_label: 'Result', ...output },
    },
  ];
  const edges = [{ id: 'e1', source_node_id: 'items', source_port_id: 'output', target_node_id: 'out', target_port_id: 'value' }];
  if (extra.paths) {
    nodes.push({
      id: 'paths', node_type: 'data', label: 'Paths', description: '', position: { x: 0, y: 0 },
      inputs: [], outputs: [list('output')], config: { data_value: extra.paths, data_format: 'structure' },
    });
    edges.push({ id: 'e2', source_node_id: 'paths', source_port_id: 'output', target_node_id: 'out', target_port_id: 'path' });
  }
  return {
    metadata: { name: 't', version: '1', description: '', author: '', tags: [], ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night' },
    nodes, edges,
  };
}

/** A runtime whose files are a list of writes, in order. */
function recording() {
  const writes: Array<[string, string]> = [];
  const runtime: Runtime = {
    files: {
      resolve: (path) => path, exists: async () => true, read: async () => '', list: async () => [],
      write: async (path, content) => { writes.push([path, content]); },
    },
    code: { run: async (_body, inputs) => inputs },
    ai: { complete: async () => '' },
  };
  return { runtime, writes };
}

async function run(g: Graph) {
  const { runtime, writes } = recording();
  const result = await executeGraph(g, { runtime, registry });
  return { writes, out: result.node_results.find((entry) => entry.node_id === 'out')?.outputs ?? {} };
}

describe('an output node an older editor saved "once per item"', () => {
  it('writes a list to its file once, not each item over the last', async () => {
    const { writes, out } = await run(graph(['a', 'b', 'c'], { write_mode: 'file', value: '/tmp/r.txt' }));
    expect(writes).toEqual([['/tmp/r.txt', JSON.stringify(['a', 'b', 'c'])]]);
    expect(out.written_path).toBe('/tmp/r.txt');
  });

  it('writes a list to its folder as numbered files', async () => {
    const { writes } = await run(graph(['a', 'b', 'c'], { write_mode: 'directory', value: '/tmp/d' }));
    expect(writes.map(([path]) => path)).toEqual(['/tmp/d/value_1.txt', '/tmp/d/value_2.txt', '/tmp/d/value_3.txt']);
  });

  it('hands an empty list on as one, rather than running zero times', async () => {
    const { writes, out } = await run(graph([], { write_mode: 'window' }));
    expect(writes).toEqual([]);
    expect(out.value).toEqual([]);
  });

  it('still writes each value to its own wired path, when a list of paths arrives', async () => {
    // "list" ticked on `path`, with a path per item: the one thing running
    // once per item did for an output node, kept inside the element.
    const { writes, out } = await run(graph(['a', 'b'], { write_mode: 'file', value: '' }, { paths: ['/x/1.txt', '/x/2.txt'] }));
    expect(writes).toEqual([['/x/1.txt', 'a'], ['/x/2.txt', 'b']]);
    expect(out.written_paths).toEqual(['/x/1.txt', '/x/2.txt']);
    expect(out).not.toHaveProperty('path');
  });

  it('is not told to fan out, whatever its file says; a code node still is', () => {
    const output = graph([], { write_mode: 'file' }).nodes[1];
    expect(registry.node('output')!.batchMode(output)).toBe('whole');
    expect(registry.node('code')!.batchMode({ ...output, node_type: 'code' })).toBe('per_item');
  });
});
