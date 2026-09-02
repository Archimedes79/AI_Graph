import { describe, it, expect } from 'vitest';
import type { Graph, GraphEdge, GraphNode } from './graph.ts';
import { collectInputs, executeGraph, memoryFeedbackEdges, topologicalLevels } from './executor.ts';
import { GraphNodeElement, type Runtime } from './element.ts';
import { registry } from './registry.ts';

function node(id: string, type = 'code', config: Record<string, unknown> = {}): GraphNode {
  return {
    id, node_type: type as GraphNode['node_type'], label: id, description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
  };
}

function edge(id: string, from: string, fromPort: string, to: string, toPort: string): GraphEdge {
  return { id, source_node_id: from, source_port_id: fromPort, target_node_id: to, target_port_id: toPort };
}

/** A runtime with no world attached: these tests are about ordering, not doing. */
const nowhere: Runtime = {
  files: {
    read: async () => '', write: async () => {}, list: async () => [],
    resolve: (p) => p, exists: async () => true,
  },
  code: { run: async (_body, inputs) => inputs },
  ai: { complete: async () => '' },
};

describe('topologicalLevels', () => {
  it('puts independent nodes in one stage and dependents in the next', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('e1', 'a', 'out', 'c', 'in'), edge('e2', 'b', 'out', 'c', 'in')];
    expect(topologicalLevels(nodes, edges, new Set())).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps the graph order inside a stage, so a run is reproducible', () => {
    const nodes = [node('z'), node('y'), node('x')];
    expect(topologicalLevels(nodes, [], new Set())).toEqual([['z', 'y', 'x']]);
  });

  it('refuses a cycle that no memory closes', () => {
    const nodes = [node('a'), node('b')];
    const edges = [edge('e1', 'a', 'out', 'b', 'in'), edge('e2', 'b', 'out', 'a', 'in')];
    expect(() => topologicalLevels(nodes, edges, new Set())).toThrow(/cycle/);
  });
});

describe('memoryFeedbackEdges', () => {
  it('cuts the edge into a node that remembers, and only that one', () => {
    // data remembers; code does not. The loop is legal because the value the
    // data node holds is what breaks it -- the next round starts from there.
    const nodes = [node('store', 'data'), node('step', 'code')];
    const edges = [
      edge('read', 'store', 'output', 'step', 'input'),
      edge('write', 'step', 'output', 'store', 'input'),
    ];
    expect([...memoryFeedbackEdges(nodes, edges, registry)]).toEqual(['write']);
  });

  it('leaves a cycle between two forgetful nodes alone, for the ordering to reject', () => {
    const nodes = [node('a', 'code'), node('b', 'code')];
    const edges = [edge('e1', 'a', 'o', 'b', 'i'), edge('e2', 'b', 'o', 'a', 'i')];
    expect(memoryFeedbackEdges(nodes, edges, registry).size).toBe(0);
  });
});

describe('collectInputs', () => {
  const outputs = new Map([['a', { out: 1 }], ['b', { out: 2 }]]);

  it('gives a single-edge port the value itself, not a list of one', () => {
    const edges = [edge('e1', 'a', 'out', 'c', 'in')];
    expect(collectInputs('c', edges, outputs, new Set())).toEqual({ in: 1 });
  });

  it('gives a port fed by several edges a list', () => {
    const edges = [edge('e1', 'a', 'out', 'c', 'in'), edge('e2', 'b', 'out', 'c', 'in')];
    expect(collectInputs('c', edges, outputs, new Set())).toEqual({ in: [1, 2] });
  });

  it('omits a failed source rather than passing null for it', () => {
    // A null would say "this ran and produced nothing", which is a different
    // fact from "this never ran", and downstream code cannot tell them apart.
    const edges = [edge('e1', 'missing', 'out', 'c', 'in')];
    expect(collectInputs('c', edges, outputs, new Set())).toEqual({});
  });

  it('ignores a feedback edge: its source has not run yet this round', () => {
    const edges = [edge('loop', 'a', 'out', 'c', 'in')];
    expect(collectInputs('c', edges, outputs, new Set(['loop']))).toEqual({});
  });
});

describe('executeGraph', () => {
  const graph = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({
    metadata: {
      name: 'test', version: '1', description: '', author: '', tags: [],
      ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night',
    },
    nodes, edges,
  });

  it('skips what depended on a failure instead of abandoning the run', async () => {
    class Boom extends GraphNodeElement {
      readonly nodeType = 'code' as const;
      config() { return {}; }
      async execute(): Promise<Record<string, unknown>> { throw new Error('no'); }
    }
    const registryWithBoom = {
      node: (type: string) => (type === 'code' ? new Boom() : registry.node(type)),
    };

    const result = await executeGraph(
      graph([node('bad', 'code'), node('after', 'output'), node('elsewhere', 'input')],
            [edge('e', 'bad', 'output', 'after', 'value')]),
      { runtime: nowhere, registry: registryWithBoom as never },
    );

    const status = Object.fromEntries(result.node_results.map((r) => [r.node_id, r.status]));
    expect(status).toEqual({ bad: 'error', after: 'skipped', elsewhere: 'success' });
    // Partial, not error: something did run, and the report should say so.
    expect(result.status).toBe('partial');
  });

  it('settles a feedback edge into the node that remembers, for the next round', async () => {
    const store = node('store', 'data', { data_value: 'old' });
    const step = node('step', 'code', { code: 'x', language: 'js' });
    step.outputs = [{ id: 'output', name: 'o', kind: 'output', data_type: 'any', multi: false, required: false, description: '' }];

    await executeGraph(
      graph([store, step], [
        edge('read', 'store', 'output', 'step', 'input'),
        edge('write', 'step', 'output', 'store', 'input'),
      ]),
      {
        runtime: { ...nowhere, code: { run: async () => ({ output: 'fresh' }) } },
        registry,
      },
    );

    expect(store.config.data_value).toBe('fresh');
  });
});

describe('the AI default a graph carries', () => {
  /** A runtime that remembers what it was asked to call. */
  function listening() {
    const calls: { provider?: string; model?: string }[] = [];
    const runtime: Runtime = {
      ...nowhere,
      ai: { complete: async (request) => { calls.push({ provider: request.provider, model: request.model }); return 'ok'; } },
    };
    return { runtime, calls };
  }

  function graphWith(defaults: { provider: string; model: string }, nodeConfig: Record<string, unknown>): Graph {
    return {
      metadata: { name: 'g', version: '1', ai_defaults: defaults } as Graph['metadata'],
      nodes: [node('a', 'ai', { system_prompt: 'be brief', ...nodeConfig })],
      edges: [],
    };
  }

  it('is what a node left on "default" calls', async () => {
    const { runtime, calls } = listening();
    await executeGraph(graphWith({ provider: 'lmstudio', model: 'qwen' }, { ai_provider: 'default' }), { runtime, registry });
    expect(calls).toEqual([{ provider: 'lmstudio', model: 'qwen' }]);
  });

  it('never overrides a node that named its own', async () => {
    const { runtime, calls } = listening();
    await executeGraph(graphWith({ provider: 'lmstudio', model: 'qwen' }, { ai_provider: 'openai', ai_model: 'gpt-4o-mini' }), { runtime, registry });
    expect(calls).toEqual([{ provider: 'openai', model: 'gpt-4o-mini' }]);
  });

  it('changes nothing when the graph names nothing', async () => {
    const { runtime, calls } = listening();
    await executeGraph(graphWith({ provider: 'default', model: '' }, { ai_provider: 'default' }), { runtime, registry });
    expect(calls).toEqual([{ provider: 'default', model: '' }]);
  });
});

describe('a batch with failing items', () => {
  /** A per_item code node fed a list of three, whose runner fails on the word "bad". */
  function graphOf(items: string[]): Graph {
    return {
      metadata: { name: 'g', version: '1', ai_defaults: { provider: 'default', model: '' } } as Graph['metadata'],
      nodes: [
        { ...node('a', 'data', { data_value: items, data_format: 'structure' }), outputs: [{ id: 'output', name: 'O', kind: 'output', data_type: 'json', multi: true, required: false, description: '' }] },
        {
          ...node('work', 'code', { code: 'function run(i) { return i; }', batch_mode: 'per_item' }),
          inputs: [{ id: 'items', name: 'Items', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
          outputs: [{ id: 'out', name: 'Out', kind: 'output', data_type: 'any', multi: true, required: false, description: '' }],
        },
      ],
      edges: [edge('e', 'a', 'output', 'work', 'items')],
    };
  }
  const picky: Runtime = {
    ...nowhere,
    code: { run: async (_body, inputs) => { if (String(inputs.items).includes('bad')) throw new Error('boom'); return { out: inputs.items }; } },
  };
  const workResult = async (items: string[]) =>
    (await executeGraph(graphOf(items), { runtime: picky, registry })).node_results.find((r) => r.node_id === 'work')!;

  it('is partial, counted, with the first failure quoted, and the rest intact', async () => {
    const work = await workResult(['ok', 'bad', 'ok']);
    expect(work.status).toBe('partial');
    expect(work.error).toContain('1 of 3 items failed');
    expect(work.error).toContain('boom');
    expect(work.outputs.out).toEqual(['ok', null, 'ok']);
  });

  it('is an error, with the message, when every item fails', async () => {
    const work = await workResult(['bad', 'bad']);
    expect(work.status).toBe('error');
    expect(work.error).toContain('boom');
  });

  it('is a plain success when nothing fails', async () => {
    expect((await workResult(['ok', 'ok'])).status).toBe('success');
  });
});
