import { describe, it, expect } from 'vitest';
import type { Graph, GraphNode } from '../graph.ts';
import { collectInputs, executeGraph, memoryFeedbackEdges, topologicalLevels } from './executor.ts';
import { NodeRunner } from '../elements/NodeRunner.ts';
import { type Runtime } from '../elements/Runtime.ts';
import { registry } from '../elements/registry.ts';
import { edge, graphOf, quietRuntime } from '../../test/fakes.ts';

function node(id: string, type = 'code', config: Record<string, unknown> = {}): GraphNode {
  return {
    id, node_type: type as GraphNode['node_type'], label: id, description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
  };
}

/** A runtime with no world attached: these tests are about ordering, not doing. */
const nowhere = quietRuntime();

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

  it('cuts only an edge that closes a loop, whatever order the wires are stored in', async () => {
    // store <-> step is the loop; step -> kept -> show hangs below it, and
    // `kept` remembers too. Cutting the wire into `kept` would settle it a
    // round late for nothing.
    const nodes = () => [
      node('store', 'data', { data_value: 1 }), node('step', 'code', { code: 'function run(i) { return { out: i.x + 1 }; }' }),
      node('kept', 'data', { data_value: 'stale' }), node('show', 'code', { code: 'function run(i) { return { saw: i.v }; }' }),
    ];
    const loop = [edge('read', 'store', 'output', 'step', 'x'), edge('write', 'step', 'out', 'store', 'input')];
    const tail = [edge('keep', 'step', 'out', 'kept', 'input'), edge('shown', 'kept', 'output', 'show', 'v')];
    expect([...memoryFeedbackEdges(nodes(), [...loop, ...tail], registry)]).toEqual(['write']);
    expect([...memoryFeedbackEdges(nodes(), [...tail, ...loop], registry)]).toEqual(['write']);

    const runtime = quietRuntime({ code: { run: async (body, inputs) => new Function('inputs', `${body}; return run(inputs);`)(inputs) } });
    const saw = async (edges: typeof loop) => (await executeGraph(graphOf(nodes(), edges), { runtime, registry }))
      .node_results.find((r) => r.node_id === 'show')!.outputs;
    expect(await saw([...tail, ...loop])).toEqual({ saw: 2 });
    expect(await saw([...loop, ...tail])).toEqual({ saw: 2 });
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
  it('skips what depended on a failure instead of abandoning the run', async () => {
    class Boom extends NodeRunner {
      readonly nodeType = 'code' as const;
      config() { return {}; }
      async execute(): Promise<Record<string, unknown>> { throw new Error('no'); }
    }
    const registryWithBoom = {
      node: (type: string) => (type === 'code' ? new Boom() : registry.node(type)),
    };

    const result = await executeGraph(
      graphOf([node('bad', 'code'), node('after', 'output'), node('elsewhere', 'input')],
            [edge('e', 'bad', 'output', 'after', 'value')]),
      { runtime: nowhere, registry: registryWithBoom as never },
    );

    const status = Object.fromEntries(result.node_results.map((r) => [r.node_id, r.status]));
    expect(status).toEqual({ bad: 'error', after: 'skipped', elsewhere: 'success' });
    // Partial, not error: something did run, and the report should say so.
    expect(result.status).toBe('partial');
    // And what the reader is told: which node, by the name on the canvas, and why.
    expect(result.error).toBe('code node "bad" failed: no (1 more could not run)');
  });

  it('takes a result that is handed in, and does not run that node', async () => {
    let ran = 0;
    class Counts extends NodeRunner {
      readonly nodeType = 'code' as const;
      config() { return {}; }
      async execute(_node: GraphNode, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
        ran += 1;
        return { output: `saw ${String(inputs.value)}` };
      }
    }
    const counting = { node: (type: string) => (type === 'code' ? new Counts() : registry.node(type)) };

    const result = await executeGraph(
      graphOf([node('source'), node('after'), node('show', 'output')], [
        edge('e1', 'source', 'output', 'after', 'value'),
        edge('e2', 'after', 'output', 'show', 'value'),
      ]),
      { runtime: nowhere, registry: counting as never, given: { source: { output: 'a value' } } },
    );

    // Only the two nodes that were not answered ran, and the answer travelled.
    expect(ran).toBe(1);
    const source = result.node_results.find((r) => r.node_id === 'source')!;
    expect(source.status).toBe('success');
    expect(source.outputs).toEqual({ output: 'a value' });
    expect(source.messages?.[0]).toMatch(/Handed in from outside/);
    expect(result.node_results.filter((r) => r.node_id === 'source')).toHaveLength(1);
    expect(result.node_results.find((r) => r.node_id === 'after')?.outputs).toEqual({ output: 'saw a value' });
  });

  it('refuses a result for a node that is not in the graph', async () => {
    await expect(executeGraph(
      graphOf([node('here', 'output')]),
      { runtime: nowhere, registry, given: { elsewhere: { output: 1 } } },
    )).rejects.toThrow(/"elsewhere", which is not a node in this graph/);
  });

  it('will not start on two nodes with one id, or an edge that ends nowhere', async () => {
    await expect(executeGraph(
      graphOf([node('twice'), node('twice')]),
      { runtime: nowhere, registry },
    )).rejects.toThrow(/More than one node has this id/);

    // Silent otherwise: nothing is ever put on that wire, and the run would
    // report a result computed without it.
    await expect(executeGraph(
      graphOf([node('here', 'output')], [edge('e', 'ghost', 'output', 'here', 'value')]),
      { runtime: nowhere, registry },
    )).rejects.toThrow(/edge "e": Its source is node "ghost", and there is no such node/);
  });

  it('runs a graph whose nodes declare no ports: the edges are the wiring', async () => {
    // What a graph written by hand looks like. `check` says the ports are
    // missing; the run does not, because the value travels by edge.
    const result = await executeGraph(
      graphOf([node('make', 'code', { code: 'x', language: 'js' }), node('show', 'output')],
            [edge('e', 'make', 'output', 'show', 'value')]),
      { runtime: { ...nowhere, code: { run: async () => ({ output: 'made' }) } }, registry },
    );
    expect(result.status).toBe('success');
  });

  it('settles a feedback edge into the node that remembers, for the next round', async () => {
    const store = node('store', 'data', { data_value: 'old' });
    const step = node('step', 'code', { code: 'x', language: 'js' });
    step.outputs = [{ id: 'output', name: 'o', kind: 'output', data_type: 'any', multi: false, required: false, description: '' }];

    await executeGraph(
      graphOf([store, step], [
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

  it('keeps the list a port fed by two wires received, not the last wire\'s value', async () => {
    // A data node fed by two nodes hands on both this round: it must keep both.
    const store = node('store', 'data', { data_value: 'old' });
    const runtime = { ...nowhere, code: { run: async (body: string) => ({ v: body }) } };
    const run = await executeGraph(
      graphOf([node('a', 'code', { code: 'A' }), node('b', 'code', { code: 'B' }), store],
        [edge('ea', 'a', 'v', 'store', 'input'), edge('eb', 'b', 'v', 'store', 'input')]),
      { runtime, registry },
    );
    expect(run.node_results.find((r) => r.node_id === 'store')!.outputs.output).toEqual(['A', 'B']);
    expect(store.config.data_value).toEqual(['A', 'B']);
    expect(run.memory).toEqual([{ node_id: 'store', port_id: 'input', value: ['A', 'B'] }]);
  });

  it('shows a block fed across a loop by two wires both of them', async () => {
    const page = node('page', 'gui', { gui_widgets: [{ id: 'q', kind: 'text_io', mode: 'input', value: 'go' }, { id: 'show', kind: 'table' }] });
    const runtime = { ...nowhere, code: { run: async (body: string) => ({ output: body }) } };
    const run = await executeGraph(
      graphOf([page, node('a', 'code', { code: 'answer a' }), node('b', 'code', { code: 'answer b' })], [
        edge('e1', 'page', 'q_out', 'a', 'x'), edge('e2', 'page', 'q_out', 'b', 'x'),
        edge('e3', 'a', 'output', 'page', 'show_in'), edge('e4', 'b', 'output', 'page', 'show_in'),
      ]),
      { runtime, registry },
    );
    expect(run.node_results.find((r) => r.node_id === 'page')!.inputs.show_in).toEqual(['answer a', 'answer b']);
    expect(run.memory).toEqual([{ node_id: 'page', port_id: 'show_in', value: ['answer a', 'answer b'] }]);
  });

  it('keeps every output in the result when two share a label', async () => {
    // Every new output node is called "Result". Two of them used to leave the
    // run's result with one value, the other gone without a word.
    const result = await executeGraph(
      graphOf([
        node('a', 'input', { input_mode: 'text', value: 'alpha' }),
        node('b', 'input', { input_mode: 'text', value: 'beta' }),
        node('first', 'output', { output_label: 'Result' }),
        node('second', 'output', { output_label: 'Result' }),
        node('named', 'output', { output_label: 'Named' }),
      ], [
        edge('e1', 'a', 'output', 'first', 'value'),
        edge('e2', 'b', 'output', 'second', 'value'),
        edge('e3', 'a', 'output', 'named', 'value'),
      ]),
      { runtime: nowhere, registry },
    );
    // The last keeps its label: a run used to write each over the one before,
    // so "Result" held the last one's value, and a graph saved then still
    // finds it there. Labels nobody shares are left as they were.
    expect(result.outputs).toEqual({
      'Result (first)': { value: 'alpha' },
      Result: { value: 'beta' },
      Named: { value: 'alpha' },
    });
  });

  it('keys an output the same whether or not the one after it ran', async () => {
    // A round that runs only part of the graph -- a page event, a trigger --
    // must not hand the first's value on under the last's key: rounds laid
    // over each other would lose the last's value once more.
    const result = await executeGraph(
      graphOf([
        node('a', 'input', { input_mode: 'text', value: 'alpha' }),
        node('b', 'input', { input_mode: 'text', value: 'beta' }),
        node('first', 'output', { output_label: 'Result' }),
        node('clash', 'output', { output_label: 'Result (first)' }),
        node('second', 'output', { output_label: 'Result' }),
      ], [
        edge('e1', 'a', 'output', 'first', 'value'),
        edge('e2', 'b', 'output', 'second', 'value'),
        edge('e3', 'a', 'output', 'clash', 'value'),
      ]),
      { runtime: nowhere, registry, only: new Set(['a', 'first', 'clash']) },
    );
    // And a label that happens to be another's key is told apart the same way.
    expect(result.outputs).toEqual({
      'Result (first) 2': { value: 'alpha' },
      'Result (first)': { value: 'alpha' },
    });
  });

  it('keeps every output when a label is the key an earlier repeat would be given', async () => {
    // With "Result (first)" in the graph, the first "Result" would be keyed
    // "Result (first)" too, and one of the two values gone without a word.
    const result = await executeGraph(
      graphOf([
        node('a', 'input', { input_mode: 'text', value: 'alpha' }),
        node('b', 'input', { input_mode: 'text', value: 'beta' }),
        node('c', 'input', { input_mode: 'text', value: 'gamma' }),
        node('first', 'output', { output_label: 'Result' }),
        node('clash', 'output', { output_label: 'Result (first)' }),
        node('second', 'output', { output_label: 'Result' }),
      ], [
        edge('e1', 'a', 'output', 'first', 'value'),
        edge('e2', 'b', 'output', 'second', 'value'),
        edge('e3', 'c', 'output', 'clash', 'value'),
      ]),
      { runtime: nowhere, registry },
    );
    expect(result.outputs).toEqual({
      'Result (first) 2': { value: 'alpha' },
      'Result (first)': { value: 'gamma' },
      Result: { value: 'beta' },
    });
  });
});

describe('a batch with failing items', () => {
  /** A per_item code node fed a list of three, whose runner fails on the word "bad". */
  function batchOf(items: string[], catches = false): Graph {
    return {
      metadata: { name: 'g' } as Graph['metadata'],
      nodes: [
        { ...node('a', 'data', { data_value: items, data_format: 'structure' }), outputs: [{ id: 'output', name: 'O', kind: 'output', data_type: 'json', multi: true, required: false, description: '' }] },
        {
          ...node('work', 'code', { code: 'function run(i) { return i; }', batch_mode: 'per_item', ...(catches ? { catch_errors: true } : {}) }),
          inputs: [{ id: 'items', name: 'Items', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
          outputs: [
            { id: 'out', name: 'Out', kind: 'output', data_type: 'any', multi: true, required: false, description: '' },
            ...(catches ? [{ id: 'error', name: 'Error', kind: 'output' as const, data_type: 'text' as const, multi: false, required: false, description: '' }] : []),
          ],
        },
      ],
      edges: [edge('e', 'a', 'output', 'work', 'items')],
    };
  }
  const picky: Runtime = {
    ...nowhere,
    code: { run: async (_body, inputs) => { if (String(inputs.items).includes('bad')) throw new Error('boom'); return { out: inputs.items }; } },
  };
  const workResult = async (items: string[], catches = false) =>
    (await executeGraph(batchOf(items, catches), { runtime: picky, registry })).node_results.find((r) => r.node_id === 'work')!;

  it('puts the reason on the error port of a node that catches its failures, once for the node', async () => {
    // It used to carry [null]: a list with a null for the failed item, which
    // says nothing, and is not empty -- so what was wired to it ran on nothing.
    const work = await workResult(['ok', 'bad'], true);
    expect(work.status).toBe('partial');
    expect(work.outputs.out).toEqual(['ok', null]);
    expect(typeof work.outputs.error).toBe('string');
    expect(work.outputs.error).toBe(work.error);
    expect(work.outputs.error).toContain('1 of 2 items failed');
    expect(work.outputs.error).toContain('boom');
  });

  it('leaves the error port of a node that catches its failures empty when nothing failed', async () => {
    const work = await workResult(['ok', 'ok'], true);
    expect(work.status).toBe('success');
    expect(work.outputs.error).toBeUndefined();
  });

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

describe('a node that catches its own failure', () => {
  /**
   * `catch_errors` is one mechanism for every element rather than a copy in
   * each: the element throws as it always did, and the executor decides what
   * that costs. The error port is optional to wire -- unwired, the run simply
   * carries on, and the node still reports what went wrong.
   */
  class Boom extends NodeRunner {
    readonly nodeType = 'code' as const;
    config() { return {}; }
    async execute(): Promise<Record<string, unknown>> { throw new Error('the body blew up'); }
  }
  const withBoom = { node: (type: string) => (type === 'code' ? new Boom() : registry.node(type)) };

  function failing(config: Record<string, unknown>): GraphNode {
    const bad = node('bad', 'code', config);
    bad.outputs = [
      { id: 'value', name: 'Value', kind: 'output', data_type: 'any', multi: false, required: false, description: '' },
      { id: 'error', name: 'Error', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
    ];
    return bad;
  }

  it('keeps the run going, and puts the message on its error port', async () => {
    const result = await executeGraph(
      graphOf([failing({ catch_errors: true })], []),
      { runtime: nowhere, registry: withBoom as never },
    );
    const bad = result.node_results[0];
    expect(bad.status).toBe('partial');
    expect(bad.outputs).toEqual({ value: null, error: 'the body blew up' });
    expect(bad.error).toBe('the body blew up');
  });

  it('lets what is downstream run, instead of skipping it', async () => {
    const result = await executeGraph(
      graphOf([failing({ catch_errors: true }), node('after', 'output')],
            [edge('e', 'bad', 'error', 'after', 'value')]),
      { runtime: nowhere, registry: withBoom as never },
    );
    const status = Object.fromEntries(result.node_results.map((r) => [r.node_id, r.status]));
    expect(status).toEqual({ bad: 'partial', after: 'success' });
  });

  it('is off unless asked: the same node without it still ends the run there', async () => {
    const result = await executeGraph(
      graphOf([failing({}), node('after', 'output')], [edge('e', 'bad', 'value', 'after', 'value')]),
      { runtime: nowhere, registry: withBoom as never },
    );
    const status = Object.fromEntries(result.node_results.map((r) => [r.node_id, r.status]));
    expect(status).toEqual({ bad: 'error', after: 'skipped' });
  });

  it('does not need the port wired to anything', async () => {
    const result = await executeGraph(
      graphOf([failing({ catch_errors: true })], []),
      { runtime: nowhere, registry: withBoom as never },
    );
    expect(result.status).toBe('partial');
    expect(result.error).toBeNull();
  });
});
