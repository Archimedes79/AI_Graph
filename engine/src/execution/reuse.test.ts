import { describe, it, expect } from 'vitest';
import { executeGraph } from './executor.ts';
import { LastOutputs } from './reuse.ts';
import { registry } from '../elements/registry.ts';
import type { ModelChoice } from '../elements/Runtime.ts';
import type { GraphNode } from '../graph.ts';
import { edge, graphOf, quietRuntime } from '../../test/fakes.ts';

/**
 * What a node run only as context hands back from an earlier round, and when
 * it asks again instead.
 */

function node(id: string, type: string, config: Record<string, unknown>): GraphNode {
  return { id, node_type: type as GraphNode['node_type'], label: id, description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config };
}

describe('a node that asks the model, run as context', () => {
  it('asks again once the model it is answered by has changed', async () => {
    // After another model was chosen in ⚙ Settings it kept handing back what
    // the one before had answered: nothing about the node or its inputs had
    // changed.
    let setting: ModelChoice = { provider: 'ollama', model: 'first' };
    let asked = 0;
    const runtime = quietRuntime({
      ai: {
        complete: async () => { asked += 1; return `said by ${setting.model}`; },
        setting: async () => setting,
      },
      code: { run: async (_body, inputs) => ({ text: `${String(inputs.len)}: ${String(inputs.text)}` }) },
    });
    const graph = graphOf([
      node('page', 'gui', { gui_widgets: [
        { id: 'msg', kind: 'text_io', mode: 'input', value: 'hello' },
        { id: 'len', kind: 'select', options: 'short\nlong', value: 'short', run_on_change: true },
      ] }),
      node('model', 'ai', {}),
      node('shape', 'code', { code: 'shape' }),
    ], [
      edge('m', 'page', 'msg_out', 'model', 'message'),
      edge('t', 'model', 'output', 'shape', 'text'),
      edge('l', 'page', 'len_out', 'shape', 'len'),
    ]);
    const reuse = new LastOutputs();
    const round = async () => (await executeGraph(graph, { runtime, registry, reuse, trigger: { node_id: 'page', port_id: 'len_out' } }))
      .node_results.find((result) => result.node_id === 'shape')!.outputs.text;

    expect(await round()).toBe('short: said by first');
    expect(await round()).toBe('short: said by first');
    expect(asked).toBe(1);
    setting = { provider: 'ollama', model: 'second' };
    expect(await round()).toBe('short: said by second');
    expect(asked).toBe(2);
  });
});
