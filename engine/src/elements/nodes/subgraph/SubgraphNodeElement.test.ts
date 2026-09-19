import { describe, it, expect } from 'vitest';
import { executeGraph } from '../../../execution/executor.ts';
import { registry } from '../../registry.ts';
import { parseGraph, type Graph, type GraphNode } from '../../../graph.ts';
import type { Runtime } from '../../Runtime.ts';

/**
 * A graph inside a node, run by the engine that runs graphs.
 *
 * Every test here goes through `executeGraph`, never through the element on
 * its own: the point of the design is that the outer run and the inner run are
 * the same code, and a test that called `execute` directly would be testing
 * something no run does.
 */

const port = (id: string, kind: 'input' | 'output') =>
  ({ id, name: id, kind, data_type: 'any' as const, multi: false, required: false, description: '' });

function node(id: string, type: string, config: Record<string, unknown> = {}, ports: {
  inputs?: string[]; outputs?: string[];
} = {}): GraphNode {
  return {
    id, node_type: type as GraphNode['node_type'], label: id, description: '',
    position: { x: 0, y: 0 },
    inputs: (ports.inputs ?? []).map((p) => port(p, 'input')),
    outputs: (ports.outputs ?? []).map((p) => port(p, 'output')),
    config,
  };
}

const edge = (id: string, from: string, fromPort: string, to: string, toPort: string) =>
  ({ id, source_node_id: from, source_port_id: fromPort, target_node_id: to, target_port_id: toPort });

function graph(nodes: GraphNode[], edges: ReturnType<typeof edge>[] = []): Graph {
  return parseGraph({ metadata: { name: 'test' }, nodes, edges });
}

/** Shouts the text it is given, so a value that crossed the boundary is visible. */
const shouting: Runtime = {
  files: {
    read: async (path: string) => `contents of ${path}`,
    write: async () => {}, list: async () => [], resolve: (p) => p, exists: async () => true,
  },
  code: { run: async (_body, inputs) => ({ output: String(inputs.value ?? '').toUpperCase() }) },
  ai: { complete: async () => '' },
};

/** The inner graph: one text input, one code node, one output. */
function inner(): unknown {
  return {
    metadata: { name: 'inside' },
    nodes: [
      node('subject', 'input', { input_mode: 'text', value: 'from inside' }),
      node('shout', 'code', { code: 'x', language: 'js' }, { inputs: ['value'], outputs: ['output'] }),
      node('loud', 'output', { output_label: 'Loud' }, { inputs: ['value'] }),
    ],
    edges: [
      edge('a', 'subject', 'output', 'shout', 'value'),
      edge('b', 'shout', 'output', 'loud', 'value'),
    ],
  };
}

const holder = (config: Record<string, unknown> = {}) =>
  node('part', 'subgraph', { subgraph: inner(), ...config });

describe('a node that holds a graph', () => {
  it('has the graph inside it as its ports', () => {
    const element = registry.node('subgraph')!;
    const ports = element.derivedPorts(holder(), registry)!;
    expect(ports.inputs.map((p) => p.id)).toEqual(['subject']);
    expect(ports.outputs.map((p) => p.id)).toEqual(['loud']);
  });

  it('runs the graph inside and hands its output on', async () => {
    const outer = graph([holder(), node('show', 'output', {}, { inputs: ['value'] })],
      [edge('out', 'part', 'loud', 'show', 'value')]);

    const result = await executeGraph(outer, { runtime: shouting, registry });

    expect(result.status).toBe('success');
    // Nothing was wired in, so the input node inside used its own value.
    expect(result.node_results.find((r) => r.node_id === 'part')?.outputs).toEqual({ loud: 'FROM INSIDE' });
  });

  it('answers the input node inside with what arrived on the port', async () => {
    const outer = graph([
      node('source', 'input', { input_mode: 'text', value: 'from outside' }),
      holder(),
      node('show', 'output', {}, { inputs: ['value'] }),
    ], [
      edge('in', 'source', 'output', 'part', 'subject'),
      edge('out', 'part', 'loud', 'show', 'value'),
    ]);

    const result = await executeGraph(outer, { runtime: shouting, registry });
    expect(result.node_results.find((r) => r.node_id === 'part')?.outputs).toEqual({ loud: 'FROM OUTSIDE' });
  });

  it('carries a value the boundary cannot spell as text', async () => {
    // A port is not a text field: what the wire carries is what arrives inside.
    const passing: Runtime = { ...shouting, code: { run: async (_b, inputs) => ({ output: inputs.value }) } };
    const outer = graph([
      node('make', 'code', { code: 'x' }, { outputs: ['output'] }),
      holder(),
    ], [edge('in', 'make', 'output', 'part', 'subject')]);
    const objects: Runtime = {
      ...passing,
      code: {
        run: async (_body, inputs) => ('value' in inputs ? { output: inputs.value } : { output: { rows: [1, 2, 3] } }),
      },
    };

    const result = await executeGraph(outer, { runtime: objects, registry });
    expect(result.node_results.find((r) => r.node_id === 'part')?.outputs).toEqual({ loud: { rows: [1, 2, 3] } });
  });

  it('leaves the graph it holds exactly as it found it', async () => {
    const held = holder();
    const before = JSON.stringify(held.config.subgraph);
    await executeGraph(graph([held]), { runtime: shouting, registry });
    expect(JSON.stringify(held.config.subgraph)).toBe(before);
  });

  it('fails with the inner node named, and the outer one', async () => {
    const breaking: Runtime = { ...shouting, code: { run: async () => { throw new Error('the body blew up'); } } };
    const result = await executeGraph(graph([holder()]), { runtime: breaking, registry });

    expect(result.status).toBe('error');
    const failed = result.node_results.find((r) => r.node_id === 'part')!;
    expect(failed.status).toBe('error');
    expect(failed.error).toMatch(/Inside "part"/);
    expect(failed.error).toMatch(/code node "shout" failed: the body blew up/);
  });

  it('reports the inner run as its own progress, not as nodes nobody expected', async () => {
    const seen: string[] = [];
    const watched: Runtime = { ...shouting, report: (event) => seen.push(`${event.type}:${event.node_id}`) };
    await executeGraph(graph([holder()]), { runtime: watched, registry });

    // The outer node started and finished; nothing inside was announced as a
    // node of the run the page is counting.
    expect(seen).toContain('node_start:part');
    expect(seen.filter((line) => line.includes('shout'))).toEqual([]);
  });

  it('stops when the run is stopped, down to the graph inside', async () => {
    const stop = new AbortController();
    const slow: Runtime = {
      ...shouting,
      code: {
        run: (_body, _inputs, signal) => new Promise((_done, fail) => {
          signal?.addEventListener('abort', () => fail(new Error('Stopped.')), { once: true });
        }),
      },
    };
    const running = executeGraph(graph([holder()]), { runtime: slow, registry, signal: stop.signal });
    setTimeout(() => stop.abort(), 50);
    const result = await running;
    expect(result.status).toBe('cancelled');
  });

  it('will not nest deeper than a person can follow', async () => {
    // Six deep: each graph holds the next, which is one past the limit.
    let held: unknown = { metadata: { name: 'bottom' }, nodes: [], edges: [] };
    for (let level = 0; level < 6; level += 1) {
      held = { metadata: { name: `level ${level}` }, nodes: [node('part', 'subgraph', { subgraph: held })], edges: [] };
    }
    const result = await executeGraph(parseGraph(held), { runtime: shouting, registry });
    expect(result.error).toMatch(/5 deep/);
  });
});
