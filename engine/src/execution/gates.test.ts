import { describe, it, expect } from 'vitest';
import type { Graph, GraphEdge, GraphNode } from '../graph.ts';
import { executeGraph } from './executor.ts';
import type { Runtime } from '../elements/Runtime.ts';
import { registry } from '../elements/registry.ts';
import { RUN_PORT } from './triggers.ts';
import { Latch } from './latch.ts';

/**
 * The ◆ as a gate, an event as a boolean that is true for one round, and what
 * a node is left holding while its gate is shut.
 *
 * The bodies run for real (in this process, not the sandbox): what is tested
 * is which nodes run and what reaches them, and a router has to compute.
 */

function node(id: string, type = 'code', config: Record<string, unknown> = {}, ports: { in?: string[]; out?: string[] } = {}): GraphNode {
  const port = (name: string, kind: 'input' | 'output') => ({
    id: name, name, kind, data_type: 'any' as const, multi: false, required: false, description: '',
  });
  return {
    id, node_type: type as GraphNode['node_type'], label: id, description: '', position: { x: 0, y: 0 },
    config: type === 'code' ? { code: 'function run(inputs) { return inputs; }', ...config } : config,
    inputs: (ports.in ?? []).map((name) => port(name, 'input')),
    outputs: (ports.out ?? []).map((name) => port(name, 'output')),
  };
}

const edge = (id: string, from: string, fromPort: string, to: string, toPort: string): GraphEdge =>
  ({ id, source_node_id: from, source_port_id: fromPort, target_node_id: to, target_port_id: toPort });

const graphOf = (nodes: GraphNode[], edges: GraphEdge[]): Graph => ({
  metadata: { name: 'gates', version: '1', description: '', author: '', tags: [], ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night' },
  nodes, edges,
});

let ran: string[] = [];
const runtime: Runtime = {
  files: { read: async () => '', write: async () => {}, list: async () => [], resolve: (p) => p, exists: async () => true },
  code: { run: async (body, inputs) => new Function('inputs', `${body}; return run(inputs);`)(inputs) as Record<string, unknown> },
  ai: { complete: async () => '' },
  report: (event) => { if (event.type === 'node_start') ran.push(event.node_id); },
};

/**
 * Read → Summarize, on a page: the button opens the reader's ◆, the length is
 * wired into the summarizer and starts the graph there when it changes.
 */
function reader(): Graph {
  const page = node('page', 'gui', {
    gui_widgets: [
      { id: 'read', kind: 'button', label: 'Read' },
      { id: 'length', kind: 'select', options: 'short\nlong', value: 'short', run_on_change: true },
      { id: 'shown', kind: 'text_io', mode: 'output' },
    ],
  });
  let reads = 0;
  void reads;
  return graphOf(
    [
      page,
      node('reader', 'code', { code: 'function run() { return { text: "the file" }; }' }, { out: ['text'] }),
      node('summary', 'code', { code: 'function run(i) { return { out: i.length + ": " + i.text }; }' }, { in: ['text', 'length'], out: ['out'] }),
    ],
    [
      edge('gate', 'page', 'read_out', 'reader', RUN_PORT),
      edge('text', 'reader', 'text', 'summary', 'text'),
      edge('len', 'page', 'length_out', 'summary', 'length'),
      edge('show', 'summary', 'out', 'page', 'shown_in'),
    ],
  );
}

const READ = { node_id: 'page', port_id: 'read_out' };
const LENGTH = { node_id: 'page', port_id: 'length_out' };
const result = (run: Awaited<ReturnType<typeof executeGraph>>, id: string) => run.node_results.find((r) => r.node_id === id);

describe('the ◆ is a gate', () => {
  it('is opened by the event the round began with', async () => {
    ran = [];
    const run = await executeGraph(reader(), { runtime, registry, trigger: READ, latch: new Latch() });
    expect(ran).toEqual(['page', 'reader', 'summary']);
    expect(result(run, 'page')!.outputs.read_out).toBe(true);
    expect(result(run, 'page')!.inputs.shown_in).toBe('short: the file');
  });

  it('stays shut for another event, and what the node made last stands', async () => {
    const latch = new Latch();
    await executeGraph(reader(), { runtime, registry, trigger: READ, latch });
    ran = [];
    const graph = reader();
    (graph.nodes[0].config.gui_widgets as { id: string; value?: unknown }[])[1].value = 'long';
    const run = await executeGraph(graph, { runtime, registry, trigger: LENGTH, latch });
    expect(ran).toEqual(['page', 'summary']);                       // the reader stood still
    expect(result(run, 'page')!.outputs.read_out).toBe(false);      // not pressed *this* round
    expect(result(run, 'reader')).toMatchObject({ status: 'skipped', held: true, outputs: { text: 'the file' } });
    expect(result(run, 'page')!.inputs.shown_in).toBe('long: the file');
  });

  it('leaves what needs it waiting when it has made nothing yet', async () => {
    ran = [];
    const run = await executeGraph(reader(), { runtime, registry, trigger: LENGTH, latch: new Latch() });
    expect(ran).toEqual(['page']);
    expect(result(run, 'reader')).toMatchObject({ status: 'skipped', outputs: {} });
    expect(result(run, 'reader')!.held).toBeUndefined();
    expect(result(run, 'summary')!.status).toBe('skipped');
    expect(run.status).toBe('success');
  });

  it('counts every event as having happened in a run no event started', async () => {
    ran = [];
    const run = await executeGraph(reader(), { runtime, registry });
    expect(ran).toEqual(['page', 'reader', 'summary']);
    expect(result(run, 'page')!.outputs.read_out).toBe(true);
  });
});

/** Two events into one router, which decides with code what each of them starts. */
function routed(decide: string): Graph {
  const page = node('page', 'gui', {
    gui_widgets: [
      { id: 'go', kind: 'button', label: 'Go' },
      { id: 'tick', kind: 'button', label: 'Tick' },
      { id: 'kind', kind: 'select', options: 'Chart\nTable', value: 'Chart' },
    ],
  });
  return graphOf(
    [
      page,
      node('router', 'code', { code: decide }, { in: ['pressed', 'tick', 'kind'], out: ['draw', 'refresh'] }),
      node('chart', 'code', { code: 'function run() { return { svg: "<svg/>" }; }' }, { out: ['svg'] }),
      node('source', 'code', { code: 'function run() { return { rows: [1] }; }' }, { out: ['rows'] }),
      node('table', 'code', {}, { in: ['rows'], out: ['rows'] }),
    ],
    [
      edge('p', 'page', 'go_out', 'router', 'pressed'),
      edge('t', 'page', 'tick_out', 'router', 'tick'),
      edge('k', 'page', 'kind_out', 'router', 'kind'),
      edge('d', 'router', 'draw', 'chart', RUN_PORT),
      edge('r', 'router', 'refresh', 'source', RUN_PORT),
      edge('s', 'source', 'rows', 'table', 'rows'),
    ],
  );
}

const ROUTER = 'function run(i) { return { draw: i.pressed && i.kind === "Chart", refresh: i.tick }; }';

describe('a code node that returns booleans is a filter', () => {
  it('knows which event this round is by the named input it arrived on', async () => {
    ran = [];
    await executeGraph(routed(ROUTER), { runtime, registry, trigger: { node_id: 'page', port_id: 'go_out' }, latch: new Latch() });
    expect(ran).toEqual(['page', 'router', 'chart']);

    ran = [];
    await executeGraph(routed(ROUTER), { runtime, registry, trigger: { node_id: 'page', port_id: 'tick_out' }, latch: new Latch() });
    expect(ran).toEqual(['page', 'router', 'source', 'table']);
  });

  it('opens a gate with true and with nothing else', async () => {
    ran = [];
    const truthy = 'function run() { return { draw: "yes", refresh: 1 }; }';
    await executeGraph(routed(truthy), { runtime, registry, trigger: { node_id: 'page', port_id: 'go_out' }, latch: new Latch() });
    expect(ran).toEqual(['page', 'router']);
  });

  it('stops the branch behind a shut gate: nothing new reached it', async () => {
    const latch = new Latch();
    const tick = { node_id: 'page', port_id: 'tick_out' };
    await executeGraph(routed(ROUTER), { runtime, registry, trigger: tick, latch });
    ran = [];
    const run = await executeGraph(routed(ROUTER), { runtime, registry, trigger: { node_id: 'page', port_id: 'go_out' }, latch });
    expect(ran).toEqual(['page', 'router', 'chart']);
    expect(result(run, 'source')).toMatchObject({ held: true });
    expect(result(run, 'table')).toMatchObject({ held: true, outputs: { rows: [1] } });
  });
});

describe('what stood still is not news', () => {
  it('does not hand a held value to the page a second time', async () => {
    const latch = new Latch();
    // The page shows what `answer` made; `answer` hangs on the button.
    const graph = (): Graph => graphOf(
      [
        node('page', 'gui', { gui_widgets: [
          { id: 'ask', kind: 'button' },
          { id: 'other', kind: 'select', options: 'a\nb', value: 'a', run_on_change: true },
          { id: 'shown', kind: 'text_io', mode: 'output' },
        ] }),
        node('answer', 'code', { code: 'function run() { return { out: "an answer" }; }' }, { out: ['out'] }),
        node('sink', 'code', {}, { in: ['v'], out: ['v'] }),
      ],
      [
        edge('g', 'page', 'ask_out', 'answer', RUN_PORT),
        edge('s', 'answer', 'out', 'page', 'shown_in'),
        edge('o', 'page', 'other_out', 'sink', 'v'),
        edge('a', 'answer', 'out', 'sink', 'v2'),
      ],
    );
    const first = await executeGraph(graph(), { runtime, registry, trigger: { node_id: 'page', port_id: 'ask_out' }, latch });
    expect(first.memory).toEqual([{ node_id: 'page', port_id: 'shown_in', value: 'an answer' }]);
    const second = await executeGraph(graph(), { runtime, registry, trigger: { node_id: 'page', port_id: 'other_out' }, latch });
    expect(result(second, 'answer')).toMatchObject({ held: true });
    expect(second.memory).toEqual([]);
  });
});
