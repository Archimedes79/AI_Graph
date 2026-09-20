import { describe, it, expect } from 'vitest';
import { applyMemory, parseGraph, type Graph } from '../graph.ts';
import { executeGraph, inputsFor } from './executor.ts';
import type { Runtime } from '../elements/Runtime.ts';
import { registry } from '../elements/registry.ts';
import { nodeCode } from '../host/node.ts';

/**
 * What a run reports beyond each node's outputs: what it showed, what it kept,
 * what it left alone, and that it can be stopped.
 */

const port = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, ...extra });

/** A body is recognised by a word in it, so a test can say what a node does without a sandbox. */
function runtime(over: Partial<Runtime> = {}): Runtime {
  return {
    files: { read: async () => '', write: async () => {}, list: async () => [], resolve: (p) => p, exists: async () => true },
    code: {
      run: async (body, inputs) => {
        if (body.includes('SHOUT')) return { value: `shown(${String(inputs.value)})` };
        if (body.includes('DOUBLE')) return { out: Number(inputs.n) * 2 };
        return inputs;
      },
    },
    ai: { complete: async (request) => `answer to: ${request.prompt}` },
    ...over,
  };
}

/**
 * A page with a number field and a display, and a code node between them: the
 * ordinary loop.
 *
 * The display is a `table`, not a chart. A chart's body is run by the page when
 * it draws (`WidgetRunner.bodyDrawsOnThePage`), so a run hands it what arrived
 * and transforms nothing -- which is asserted on its own below. Every other
 * display still has its transform run here, and that is what this exercises.
 */
function loop(): Graph {
  return parseGraph({
    nodes: [
      {
        id: 'page', node_type: 'gui',
        config: { gui_widgets: [
          { id: 'n', kind: 'slider', min: 0, max: 100, value: 21 },
          { id: 'shown', kind: 'table', code: '/* SHOUT */ function run(i) { return i; }' },
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
  it('runs a block\'s transform on a value that came back around the loop', async () => {
    // The value reaches the page across a feedback edge, after the page ran.
    // The transform used to run during the page's own turn, on `undefined`,
    // and the raw 42 was shown in its place.
    const result = await executeGraph(loop(), { runtime: runtime(), registry });
    const page = result.node_results.find((r) => r.node_id === 'page')!;
    expect(page.inputs.shown_in).toBe(42);
    expect(page.display).toEqual({ shown: 'shown(42)' });
  });

  it('says what arrived in `inputs` and what is on the screen in `display`', async () => {
    const result = await executeGraph(loop(), { runtime: runtime(), registry });
    const page = result.node_results.find((r) => r.node_id === 'page')!;
    expect(page.inputs.shown_in).not.toEqual(page.display!.shown);
  });

  /**
   * A chart is the one display a run does not transform.
   *
   * Its body wants the block's size and the page's colour scheme, and a run
   * knows neither -- so it is run by the page, on every redraw, and what a run
   * puts on the screen is what arrived. The body here would be loud about
   * having run; the point is that it did not.
   */
  it('hands a chart what arrived, because the page runs its body when it draws', async () => {
    const graph = parseGraph({
      nodes: [
        { id: 'n', node_type: 'input', config: { input_mode: 'text', value: '7' }, outputs: [port('output')] },
        {
          id: 'page', node_type: 'gui',
          config: { gui_widgets: [{ id: 'chart', kind: 'plot_window', code: '/* SHOUT */ function run(i) { return i; }' }] },
        },
      ],
      edges: [{ id: 'e', source_node_id: 'n', source_port_id: 'output', target_node_id: 'page', target_port_id: 'chart_in' }],
    });
    const result = await executeGraph(graph, { runtime: runtime(), registry });
    const page = result.node_results.find((r) => r.node_id === 'page')!;
    expect(page.inputs.chart_in).toBe('7');
    expect(page.display).toEqual({ chart: '7' });
  });
});

describe('what a run remembers', () => {
  it('lists every value a memory node kept, so another copy of the graph can be brought up to date', async () => {
    const result = await executeGraph(loop(), { runtime: runtime(), registry });
    expect(result.memory).toEqual([{ node_id: 'page', port_id: 'shown_in', value: 42 }]);

    // Replayed into a fresh copy -- what the editor's store and the scheduler do.
    const copy = loop();
    applyMemory(copy.nodes, result.memory, (node, portId, value) =>
      registry.node(node.node_type)!.settleMemory(node, portId, value));
    const block = (copy.nodes[0].config.gui_widgets as { id: string; value: unknown }[]).find((w) => w.id === 'shown')!;
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
    const result = await executeGraph(graph, { runtime: runtime(), registry });
    expect(result.memory).toEqual([{ node_id: 'store', port_id: 'input', value: 'kept' }]);
    expect(graph.nodes[1].config.data_value).toBe('kept');
  });
});

describe('a node with nothing to do', () => {
  const chat = (pending: string) => parseGraph({
    nodes: [
      { id: 'page', node_type: 'gui', config: { gui_widgets: [{ id: 'chat', kind: 'chat', value: { messages: [], pending } }] } },
      {
        id: 'ai', node_type: 'ai', inputs: [port('message', { required: true })], outputs: [port('output')],
        config: { ai_model: 'm', prompt_template: 'User: {{message}}' },
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
    const result = await executeGraph(chat(''), {
      registry, runtime: runtime({ ai: { complete: async () => { asked += 1; return 'hm'; } } }),
    });
    expect(asked).toBe(0);
    expect(result.status).toBe('success');
    expect(result.node_results.find((r) => r.node_id === 'ai')).toMatchObject({ status: 'skipped' });
    expect(result.memory).toEqual([]);
  });

  it('runs as soon as there is something to say', async () => {
    const result = await executeGraph(chat('hello'), { registry, runtime: runtime() });
    expect(result.node_results.find((r) => r.node_id === 'ai')?.outputs.output).toBe('answer to: User: hello');
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
    const graph = parseGraph({ nodes: [{ id: 'ai', node_type: 'ai', outputs: [port('output')], config: { ai_model: 'm' } }], edges: [] });
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
