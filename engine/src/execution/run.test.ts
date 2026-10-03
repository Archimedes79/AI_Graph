import { describe, it, expect } from 'vitest';
import { parseGraph, type Graph } from '../graph.ts';
import { executeGraph, inputsFor } from './executor.ts';
import type { Runtime } from '../elements/Runtime.ts';
import { registry } from '../elements/registry.ts';
import { nodeCode } from '../host/node.ts';
import { quietRuntime } from '../../test/fakes.ts';

/**
 * What a run reports beyond each node's outputs: what it showed, what it kept,
 * what it left alone, and that it can be stopped.
 */

const port = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, ...extra });

/** A body is recognised by a word in it, so a test can say what a node does without a sandbox. */
function runtime(over: Partial<Runtime> = {}): Runtime {
  return quietRuntime({
    code: {
      run: async (body, inputs) => {
        if (body.includes('DOUBLE')) return { out: Number(inputs.n) * 2 };
        return inputs;
      },
    },
    ai: { complete: async (request) => `answer to: ${request.prompt}` },
    ...over,
  });
}

/** A page with a number field and a table, and a code node between them: the ordinary loop. */
function loop(): Graph {
  return parseGraph({
    nodes: [
      {
        id: 'page', node_type: 'gui',
        config: { gui_widgets: [
          { id: 'n', kind: 'slider', min: 0, max: 100, value: 21 },
          { id: 'shown', kind: 'table' },
        ] },
      },
      { id: 'double', node_type: 'code', inputs: [port('n')], outputs: [port('out')], config: { code: '/* DOUBLE */' } },
    ],
    edges: [
      { id: 'a', source_node_id: 'page', source_port_id: 'n_out', target_node_id: 'double', target_port_id: 'n' },
      { id: 'b', source_node_id: 'double', source_port_id: 'out', target_node_id: 'page', target_port_id: 'shown_in' },
    ],
  });
}

describe('what a page shows', () => {
  it('shows a value that came back around the loop', async () => {
    // The value reaches the page across a feedback edge, after the page ran.
    // What it showed used to be made during the page's own turn, on
    // `undefined`, and the 42 never reached the screen.
    const result = await executeGraph(loop(), { runtime: runtime(), registry });
    const page = result.node_results.find((r) => r.node_id === 'page')!;
    expect(page.inputs.shown_in).toBe(42);
    expect(page.display).toEqual({ shown: 42 });
  });

  /** One of each drawing block, each fed by a node of its own. */
  function drawing(): Graph {
    const text = (id: string, value: string) => ({ id, node_type: 'input', config: { input_mode: 'text', value }, outputs: [port('output')] });
    const into = (from: string, block: string) => ({ id: from, source_node_id: from, source_port_id: 'output', target_node_id: 'page', target_port_id: `${block}_in` });
    return parseGraph({
      nodes: [
        text('points', '[1, 2, 3]'), text('rows', 'Oslo'), text('picture', 'cover.png'),
        {
          id: 'page', node_type: 'gui',
          config: { gui_widgets: [{ id: 'chart', kind: 'plot_window' }, { id: 'table', kind: 'table' }, { id: 'image', kind: 'image_view' }] },
        },
      ],
      edges: [into('points', 'chart'), into('rows', 'table'), into('picture', 'image')],
    });
  }

  it('shows what arrives at a chart, a table or an image, and runs no code for any of them', async () => {
    const files = { ...quietRuntime().files, read: async (path: string) => `bytes of ${path}` };
    const code = { run: async (): Promise<never> => { throw new Error('no body runs for a block'); } };
    const result = await executeGraph(drawing(), { runtime: runtime({ files, code }), registry });
    const page = result.node_results.find((r) => r.node_id === 'page')!;
    expect(page.display).toEqual({ chart: '[1, 2, 3]', table: 'Oslo', image: 'data:image/png;base64,bytes of cover.png' });
    // What arrived and what is on the screen are told apart: an image's path is read into the picture.
    expect(page.inputs.image_in).toBe('cover.png');
  });
});

describe('what a run remembers', () => {
  it('keeps what came back around a loop in the copy of the graph it ran on', async () => {
    const graph = loop();
    await executeGraph(graph, { runtime: runtime(), registry });
    // That copy is what a session keeps (`host/session.ts`).
    const block = (graph.nodes[0].config.gui_widgets as { id: string; value: unknown }[]).find((w) => w.id === 'shown')!;
    expect(block.value).toBe(42);
  });

  it('keeps what an ordinary edge delivers to a data node, loop or no loop', async () => {
    const graph = parseGraph({
      nodes: [
        { id: 'text', node_type: 'input', config: { input_mode: 'text', value: 'kept' }, outputs: [port('output')] },
        { id: 'store', node_type: 'data', inputs: [port('input')], outputs: [port('output')], config: {} },
      ],
      edges: [{ id: 'e', source_node_id: 'text', source_port_id: 'output', target_node_id: 'store', target_port_id: 'input' }],
    });
    await executeGraph(graph, { runtime: runtime(), registry });
    expect(graph.nodes[1].config.data_value).toBe('kept');
  });
});

describe('a node with nothing to do', () => {
  const chat = (pending: string) => parseGraph({
    nodes: [
      { id: 'page', node_type: 'gui', config: { gui_widgets: [{ id: 'chat', kind: 'chat', value: { messages: [], pending } }] } },
      {
        id: 'ai', node_type: 'ai', inputs: [port('message', { required: true })], outputs: [port('output')],
        config: { ai_model: 'm' },
      },
    ],
    edges: [
      { id: 'm', source_node_id: 'page', source_port_id: 'chat_out', target_node_id: 'ai', target_port_id: 'message' },
      { id: 'r', source_node_id: 'ai', source_port_id: 'output', target_node_id: 'page', target_port_id: 'chat_in' },
    ],
  });

  it('is left alone when a wired, required input brought nothing -- and the run is still a success', async () => {
    // ▶ Run on a chat page nobody has typed into. Asking the model "User:" is
    // not a question, and its answer would be written into the conversation.
    let asked = 0;
    const graph = chat('');
    const result = await executeGraph(graph, {
      registry, runtime: runtime({ ai: { complete: async () => { asked += 1; return 'hm'; } } }),
    });
    expect(asked).toBe(0);
    expect(result.status).toBe('success');
    expect(result.node_results.find((r) => r.node_id === 'ai')).toMatchObject({ status: 'skipped' });
    // Nothing was said, so nothing was written into the conversation.
    expect((graph.nodes[0].config.gui_widgets as { value: unknown }[])[0].value).toEqual({ messages: [], pending: '' });
  });

  it('runs as soon as there is something to say', async () => {
    const result = await executeGraph(chat('hello'), { registry, runtime: runtime() });
    expect(result.node_results.find((r) => r.node_id === 'ai')?.outputs.output).toBe('answer to: hello');
  });
});

describe('stopping', () => {
  it('ends the body in flight and starts nothing after it', async () => {
    const graph = parseGraph({
      nodes: [
        { id: 'slow', node_type: 'code', outputs: [port('out')], config: { code: 'async function run() { await new Promise((r) => setTimeout(r, 30000)); return { out: 1 }; }' } },
        { id: 'after', node_type: 'code', inputs: [port('n')], outputs: [port('out')], config: { code: 'function run(i) { return { out: i.n }; }' } },
      ],
      edges: [{ id: 'e', source_node_id: 'slow', source_port_id: 'out', target_node_id: 'after', target_port_id: 'n' }],
    });
    const stop = new AbortController();
    const started = Date.now();
    setTimeout(() => stop.abort(), 400);
    // The real sandbox: what must be shown is that the *process* ends.
    const result = await executeGraph(graph, { registry, runtime: runtime({ code: nodeCode }), signal: stop.signal });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe('cancelled');
    expect(result.node_results.map((r) => r.node_id)).toEqual(['slow']);
  }, 20_000);

  it('hands the signal to every model call', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const stop = new AbortController();
    const graph = parseGraph({ nodes: [{ id: 'ai', node_type: 'ai', outputs: [port('output')], config: { ai_model: 'm', prompt: 'Say hello.' } }], edges: [] });
    await executeGraph(graph, {
      registry, signal: stop.signal,
      runtime: runtime({ ai: { complete: async (request) => { seen.push(request.signal); return 'x'; } } }),
    });
    expect(seen).toEqual([stop.signal]);
  });
});

describe('inputsFor', () => {
  it('runs what feeds a node, hands back what would arrive, and does not run the node', async () => {
    let asked = 0;
    const graph = parseGraph({
      nodes: [
        { id: 'text', node_type: 'input', config: { input_mode: 'text', value: 'a question' }, outputs: [port('output')] },
        { id: 'ai', node_type: 'ai', inputs: [port('prompt')], outputs: [port('output')], config: { ai_model: 'm' } },
        { id: 'end', node_type: 'output', inputs: [port('value')], config: {} },
      ],
      edges: [
        { id: 'a', source_node_id: 'text', source_port_id: 'output', target_node_id: 'ai', target_port_id: 'prompt' },
        { id: 'b', source_node_id: 'ai', source_port_id: 'output', target_node_id: 'end', target_port_id: 'value' },
      ],
    });
    const { inputs, upstream } = await inputsFor(graph, 'ai', {
      registry, runtime: runtime({ ai: { complete: async () => { asked += 1; return 'x'; } } }),
    });
    expect(inputs).toEqual({ prompt: 'a question' });
    expect(asked).toBe(0);
    expect(upstream.node_results.map((r) => r.node_id)).toEqual(['text']);
  });

  it('finds what a block on a page would be shown, across the loop', async () => {
    const { inputs } = await inputsFor(loop(), 'page', { registry, runtime: runtime() });
    expect(inputs).toEqual({ shown_in: 42 });
  });
});
