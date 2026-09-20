import { describe, it, expect } from 'vitest';
import { parseGraph, type Graph, type GraphEdge, type GraphNode } from '../graph.ts';
import { executeGraph, memoryFeedbackEdges } from './executor.ts';
import type { Runtime } from '../elements/Runtime.ts';
import { registry } from '../elements/registry.ts';
import { RUN_PORT, graphTriggers, triggeredNodes } from './triggers.ts';
import { LastOutputs } from './reuse.ts';

/** A code node needs a body to be allowed to run; the fake runner ignores what it says. */
const BODY = { code: 'function run(inputs) { return inputs; }' };

function node(id: string, type = 'code', given: Record<string, unknown> = {}, ports: { in?: string[]; out?: string[] } = {}): GraphNode {
  const port = (name: string, kind: 'input' | 'output') => ({
    id: name, name, kind, data_type: 'any' as const, multi: false, required: false, description: '',
  });
  return {
    id, node_type: type as GraphNode['node_type'], label: id, description: '',
    position: { x: 0, y: 0 },
    config: type === 'code' ? { ...BODY, ...given } : given,
    inputs: (ports.in ?? []).map((name) => port(name, 'input')),
    outputs: (ports.out ?? []).map((name) => port(name, 'output')),
  };
}

function edge(id: string, from: string, fromPort: string, to: string, toPort: string): GraphEdge {
  return { id, source_node_id: from, source_port_id: fromPort, target_node_id: to, target_port_id: toPort };
}

const graphOf = (nodes: GraphNode[], edges: GraphEdge[]): Graph => ({
  metadata: { name: 't', version: '1', description: '', author: '', tags: [], ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night' },
  nodes, edges,
});

/** A page with two buttons, a message box and two displays: two tools in one window. */
function twoTools(): Graph {
  const page = node('page', 'gui', {
    gui_widgets: [
      { id: 'msg', kind: 'text_io', mode: 'input', value: 'hello' },
      { id: 'go_a', kind: 'button', label: 'A' },
      { id: 'go_b', kind: 'button', label: 'B' },
      { id: 'show_a', kind: 'text_io', mode: 'output' },
      { id: 'show_b', kind: 'text_io', mode: 'output' },
    ],
  });
  return graphOf(
    [page, node('a', 'code', {}, { in: ['text'], out: ['text'] }), node('b', 'code', {}, { in: ['text'], out: ['text'] })],
    [
      edge('m_a', 'page', 'msg_out', 'a', 'text'),
      edge('m_b', 'page', 'msg_out', 'b', 'text'),
      edge('run_a', 'page', 'go_a_out', 'a', RUN_PORT),
      edge('run_b', 'page', 'go_b_out', 'b', RUN_PORT),
      edge('a_show', 'a', 'text', 'page', 'show_a_in'),
      edge('b_show', 'b', 'text', 'page', 'show_b_in'),
    ],
  );
}

const ran: string[] = [];
const runtime: Runtime = {
  files: { read: async () => '', write: async () => {}, list: async () => [], resolve: (p) => p, exists: async () => true },
  code: { run: async (_body, inputs) => inputs },
  ai: { complete: async () => '' },
  report: (event) => { if (event.type === 'node_start') ran.push(event.node_id); },
};

describe('triggeredNodes', () => {
  it('runs what the event is wired to, and what that needs', () => {
    const graph = twoTools();
    const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, registry);
    const only = triggeredNodes(graph, { node_id: 'page', port_id: 'go_a_out' }, feedback);
    expect([...only!].sort()).toEqual(['a', 'page']);
  });

  it('means everything when the block is wired to nothing', () => {
    const graph = twoTools();
    graph.edges = graph.edges.filter((e) => e.id !== 'run_a');
    const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, registry);
    expect(triggeredNodes(graph, { node_id: 'page', port_id: 'go_a_out' }, feedback)).toBeNull();
  });

  it('follows the wires downstream of where it starts', () => {
    const graph = graphOf(
      [node('page', 'gui', { gui_widgets: [{ id: 'go', kind: 'button' }] }), node('a'), node('b'), node('other')],
      [edge('r', 'page', 'go_out', 'a', RUN_PORT), edge('ab', 'a', 'o', 'b', 'i')],
    );
    const only = triggeredNodes(graph, { node_id: 'page', port_id: 'go_out' }, new Set());
    expect([...only!].sort()).toEqual(['a', 'b', 'page']);
  });

  it('does not drag in a node just because it can also start one that runs', () => {
    // `timer` may start `b` too, but this event is not the timer's.
    const graph = graphOf(
      [node('page', 'gui', { gui_widgets: [{ id: 'go', kind: 'button' }] }), node('timer'), node('b')],
      [edge('r', 'page', 'go_out', 'b', RUN_PORT), edge('t', 'timer', 'o', 'b', RUN_PORT)],
    );
    const only = triggeredNodes(graph, { node_id: 'page', port_id: 'go_out' }, new Set());
    expect([...only!].sort()).toEqual(['b', 'page']);
  });
});

describe('a run started by a page event', () => {
  it('runs one tool and leaves the other alone', async () => {
    ran.length = 0;
    const result = await executeGraph(twoTools(), { runtime, registry, trigger: { node_id: 'page', port_id: 'go_a_out' } });
    expect(ran.sort()).toEqual(['a', 'page']);
    expect(result.status).toBe('success');
    expect(result.node_results.map((r) => r.node_id).sort()).toEqual(['a', 'page']);
    // The answer reaches its display; the other display was not touched.
    const page = result.node_results.find((r) => r.node_id === 'page')!;
    expect(page.inputs.show_a_in).toBe('hello');
    expect(page.inputs.show_b_in).toBeUndefined();
  });

  it('delivers nothing on the run port: it says when, not what', async () => {
    const result = await executeGraph(twoTools(), { runtime, registry, trigger: { node_id: 'page', port_id: 'go_a_out' } });
    const a = result.node_results.find((r) => r.node_id === 'a')!;
    expect(a.inputs).toEqual({ text: 'hello' });
  });

  it('runs everything when no event is named', async () => {
    ran.length = 0;
    await executeGraph(twoTools(), { runtime, registry });
    expect(ran.sort()).toEqual(['a', 'b', 'page']);
  });
});

describe('graphTriggers', () => {
  it('is nothing unless the graph holds a trigger node', () => {
    expect(graphTriggers(graphOf([], []))).toEqual([]);
  });

  it('reads each trigger node as the event it is, and when it fires', () => {
    const graph = graphOf([
      node('clock', 'trigger', { trigger_on_start: false, trigger_every: ' 5m ' }),
      node('start', 'trigger', {}),
    ], []);
    expect(graphTriggers(graph)).toEqual([
      { event: { node_id: 'clock', port_id: 'fired' }, on_start: false, every: '5m' },
      { event: { node_id: 'start', port_id: 'fired' }, on_start: true, every: '' },
    ]);
  });

  it('turns the two settings a graph used to have into a trigger node wired to nothing', () => {
    const graph = parseGraph({ metadata: { name: 'old', triggers: { on_start: true, every: '30s' } }, nodes: [{ id: 'trigger', node_type: 'code' }], edges: [] });
    expect((graph.metadata as { triggers?: unknown }).triggers).toBeUndefined();
    expect(graphTriggers(graph)).toEqual([{ event: { node_id: 'trigger_2', port_id: 'fired' }, on_start: true, every: '30s' }]);
    // Wired to nothing, it starts everything -- which is what the settings did.
    expect(triggeredNodes(graph, { node_id: 'trigger_2', port_id: 'fired' }, new Set())).toBeNull();
    // And only once: a graph saved since keeps the node it was given.
    expect(parseGraph(JSON.parse(JSON.stringify(graph))).nodes.filter((n) => n.node_type === 'trigger')).toHaveLength(1);
  });

  it('leaves a graph whose settings were both off without a node', () => {
    const graph = parseGraph({ metadata: { triggers: { on_start: false, every: '' } }, nodes: [], edges: [] });
    expect(graph.nodes).toEqual([]);
  });
});

describe('a trigger node', () => {
  /** A clock wired to one of two tools: a round it starts runs that one. */
  const clocked = (): Graph => graphOf(
    [node('clock', 'trigger', { trigger_every: '5m' }, { out: ['fired'] }), node('a', 'code', {}, { out: ['o'] }), node('b', 'code', {}, { out: ['o'] })],
    [edge('t', 'clock', 'fired', 'a', RUN_PORT)],
  );

  it('starts what it is wired to, and says it fired', async () => {
    ran.length = 0;
    const result = await executeGraph(clocked(), { runtime, registry, trigger: { node_id: 'clock', port_id: 'fired' } });
    expect(ran.sort()).toEqual(['a', 'clock']);
    expect(result.node_results.find((r) => r.node_id === 'clock')!.outputs).toEqual({ fired: true });
  });

  it('counts as fired in a run nobody started, like every event', async () => {
    ran.length = 0;
    await executeGraph(clocked(), { runtime, registry });
    expect(ran.sort()).toEqual(['a', 'b', 'clock']);
  });

  it('is told when it could never fire, or names an interval nobody can read', () => {
    const element = registry.node('trigger')!;
    expect(element.problems(node('t', 'trigger', { trigger_on_start: false }), registry, 't')[0].problem).toMatch(/never fires/);
    expect(element.problems(node('t', 'trigger', { trigger_every: 'soon' }), registry, 't')[0].problem).toMatch(/Not an interval/);
    expect(element.problems(node('t', 'trigger', { trigger_every: '5m' }), registry, 't')).toEqual([]);
  });
});

describe('reusing context', () => {
  /** A message goes through an expensive step; a length choice only shapes what comes after it. */
  function modelThenShape(message: string): Graph {
    const page = node('page', 'gui', {
      gui_widgets: [
        { id: 'msg', kind: 'text_io', mode: 'input', value: message },
        { id: 'len', kind: 'select', options: 'short\nlong', value: 'short', run_on_change: true },
        { id: 'show', kind: 'text_io', mode: 'output' },
      ],
    });
    return graphOf(
      [
        page,
        node('model', 'code', { code: 'function run(inputs) { /* model */ return inputs; }' }, { in: ['text'], out: ['text'] }),
        node('shape', 'code', {}, { in: ['text', 'len'], out: ['text'] }),
      ],
      [
        edge('m', 'page', 'msg_out', 'model', 'text'),
        edge('t', 'model', 'text', 'shape', 'text'),
        edge('l', 'page', 'len_out', 'shape', 'len'),
        edge('s', 'shape', 'text', 'page', 'show_in'),
      ],
    );
  }

  let asked = 0;
  const counting: Runtime = {
    ...runtime,
    code: { run: async (body, inputs) => { if (body.includes('model')) asked += 1; return inputs; } },
  };
  const choose = { node_id: 'page', port_id: 'len_out' };

  it('does not run what an event only needs again when nothing it depends on changed', async () => {
    const reuse = new LastOutputs();
    asked = 0;
    await executeGraph(modelThenShape('hello'), { runtime: counting, registry, trigger: choose, reuse });
    const second = await executeGraph(modelThenShape('hello'), { runtime: counting, registry, trigger: choose, reuse });
    expect(asked).toBe(1);
    expect(second.node_results.find((r) => r.node_id === 'model')?.messages?.[0]).toMatch(/Reused/);
    // What the event is for ran, and got the reused value.
    expect(second.node_results.find((r) => r.node_id === 'shape')?.outputs).toMatchObject({ text: 'hello', len: 'short' });
  });

  it('runs it again when its input changed', async () => {
    const reuse = new LastOutputs();
    asked = 0;
    await executeGraph(modelThenShape('hello'), { runtime: counting, registry, trigger: choose, reuse });
    await executeGraph(modelThenShape('goodbye'), { runtime: counting, registry, trigger: choose, reuse });
    expect(asked).toBe(2);
  });

  it('never reuses in a whole-graph run, or without somewhere to keep results', async () => {
    const reuse = new LastOutputs();
    asked = 0;
    await executeGraph(modelThenShape('hello'), { runtime: counting, registry, reuse });
    await executeGraph(modelThenShape('hello'), { runtime: counting, registry, reuse });
    await executeGraph(modelThenShape('hello'), { runtime: counting, registry, trigger: choose });
    await executeGraph(modelThenShape('hello'), { runtime: counting, registry, trigger: choose });
    expect(asked).toBe(4);
  });
});
