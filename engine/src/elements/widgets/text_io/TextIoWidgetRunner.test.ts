import { describe, it, expect } from 'vitest';
import { TextIoWidgetRunner } from './TextIoWidgetRunner.ts';
import type { Widget } from '../../WidgetRunner.ts';
import type { Graph, GraphNode } from '../../../graph.ts';
import { registry } from '../../registry.ts';
import { executeGraph } from '../../../execution/executor.ts';
import { quietRuntime } from '../../../../test/fakes.ts';

/**
 * A box of text holds one of two things, and the difference is what happens to
 * it after a run.
 *
 * A box that sends on Enter holds a *message*: said once, and emptied when a
 * run has delivered it, so the box is ready for the next one. A box that does
 * not send holds a *setting* -- a search term, a name -- and emptying that
 * after every run would make the person retype it every time.
 *
 * The rule used to live in the editor's `WidgetGuiBuilder`, which meant the one store
 * both hosts share had to reach into the builder's registry to ask it. What a
 * run means for a block is the block's own business, the same family as
 * `settle`, so it is asked of the element here.
 */
const element = new TextIoWidgetRunner();

const box = (config: Record<string, unknown>): Widget => ({
  id: 'box', kind: 'text_io', label: 'Box', w: 4, h: 2, tone: 'sunken', config,
});

describe('what a run leaves in a text box', () => {
  it('empties a box that sends, because a message is said once', () => {
    expect(element.clearsValueAfterRun(box({ mode: 'both', run_on_change: true }))).toBe(true);
    expect(element.clearsValueAfterRun(box({ mode: 'input', run_on_change: true }))).toBe(true);
  });

  it('leaves a box that does not send, because that is a setting', () => {
    expect(element.clearsValueAfterRun(box({ mode: 'both' }))).toBe(false);
    expect(element.clearsValueAfterRun(box({ mode: 'input', run_on_change: false }))).toBe(false);
  });

  it('leaves a box that only shows: there is nothing of the person\'s in it', () => {
    expect(element.clearsValueAfterRun(box({ mode: 'output', run_on_change: true }))).toBe(false);
  });

  it('reads an unknown mode as "both", the way its ports do', () => {
    // One rule, not two: `config()` decides the role for the ports, for what a
    // run produces and for this, so a box with no mode set behaves the same in
    // all three.
    expect(element.clearsValueAfterRun(box({ run_on_change: true }))).toBe(true);
    expect(element.clearsValueAfterRun(box({ mode: 'nonsense', run_on_change: true }))).toBe(true);
  });
});

/**
 * A reply that comes back around a loop -- a box, a model, and the answer
 * wired back into the box -- is something to read, not something typed.
 *
 * It used to settle into what the box holds, so the next ▶ Run sent the
 * model's own answer back to it as the person's message, and an answer that
 * was an object went out as "[object Object]".
 */
describe('what a text box keeps from a loop', () => {
  it('keeps what the person typed in a box they type in, whatever came back', () => {
    for (const mode of ['both', undefined, 'nonsense']) {
      const stored: Record<string, unknown> = { id: 'box', kind: 'text_io', mode, value: 'my question' };
      element.settle(stored as never, 'the model reply');
      expect(stored.value, String(mode)).toBe('my question');
    }
  });

  it('keeps what arrived in a box that only shows', () => {
    const stored: Record<string, unknown> = { id: 'box', kind: 'text_io', mode: 'output', value: '' };
    element.settle(stored as never, 'the model reply');
    expect(stored.value).toBe('the model reply');
  });

  it('sends what the person typed on the next run, and shows the reply', async () => {
    const page: GraphNode = {
      id: 'page', node_type: 'gui', label: 'Page', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [],
      config: { gui_widgets: [{ id: 'box', kind: 'text_io', label: 'Box', mode: 'both', value: 'my question' }] },
    };
    const answer: GraphNode = {
      id: 'answer', node_type: 'code', label: 'Answer', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [],
      config: { code: 'function run() {}' },
    };
    const graph: Graph = {
      metadata: { name: 'loop' } as Graph['metadata'],
      nodes: [page, answer],
      edges: [
        { id: 'ask', source_node_id: 'page', source_port_id: 'box_out', target_node_id: 'answer', target_port_id: 'question' },
        { id: 'reply', source_node_id: 'answer', source_port_id: 'output', target_node_id: 'page', target_port_id: 'box_in' },
      ],
    };
    const asked: unknown[] = [];
    const runtime = quietRuntime({
      files: { exists: async () => false },
      code: { run: async (_body, inputs) => { asked.push(inputs.question); return { output: { answer: 42 } }; } },
    });

    const first = await executeGraph(graph, { runtime, registry });
    // The reply is on the page, as what arrived at the box.
    expect(first.node_results.find((r) => r.node_id === 'page')?.inputs.box_in).toEqual({ answer: 42 });
    await executeGraph(graph, { runtime, registry });
    expect(asked).toEqual(['my question', 'my question']);
  });
});

describe('what an empty box that also shows hands on', () => {
  /**
   * Its port is text, and a node wired to it is told so. What arrived used to
   * go straight through when nobody had typed anything: an object on a text
   * port, and a list of objects as "[object Object]" per line.
   */
  const both = box({ mode: 'both', value: '' });

  it('hands on what arrived as the text the box shows it as', async () => {
    expect(await element.execute(both, { box_in: { a: 1 } })).toEqual({ box_out: JSON.stringify({ a: 1 }, null, 2) });
    expect(await element.execute(both, { box_in: 42 })).toEqual({ box_out: '42' });
    expect(await element.execute(both, { box_in: 'plain' })).toEqual({ box_out: 'plain' });
    expect(await element.execute(both, {})).toEqual({ box_out: '' });
  });

  it('hands on a list one item per line, each item as text', async () => {
    expect(await element.execute(both, { box_in: ['one', { two: 2 }] }))
      .toEqual({ box_out: `one\n${JSON.stringify({ two: 2 }, null, 2)}` });
  });

  it('hands on what the person typed over what arrived', async () => {
    expect(await element.execute(box({ mode: 'both', value: 'typed' }), { box_in: { a: 1 } })).toEqual({ box_out: 'typed' });
  });
});
