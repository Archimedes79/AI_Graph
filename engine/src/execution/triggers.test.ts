import { describe, it, expect } from 'vitest';
import type { Graph, GraphEdge, GraphNode } from '../graph.ts';
import { executeGraph, memoryFeedbackEdges } from './executor.ts';
import type { Runtime } from '../elements/Runtime.ts';
import { registry } from '../elements/registry.ts';
import { RUN_PORT, graphTriggers, triggeredNodes } from './triggers.ts';

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
  it('is off unless the graph says otherwise', () => {
    expect(graphTriggers(graphOf([], []))).toEqual({ on_start: false, every: '' });
  });

  it('reads what the graph saved', () => {
    const graph = graphOf([], []);
    graph.metadata.triggers = { on_start: true, every: ' 5m ' };
    expect(graphTriggers(graph)).toEqual({ on_start: true, every: '5m' });
  });
});
