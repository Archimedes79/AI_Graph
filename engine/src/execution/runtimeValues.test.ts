import { describe, it, expect } from 'vitest';
import { parseGraph } from '../graph.ts';
import { registry } from '../elements/registry.ts';
import { applyRuntimeValues, runtimeRequirements } from './runtimeValues.ts';

/**
 * A question's key is the whole address of its answer. The server used to
 * split it into a node and a block for the wire, and each page rebuilt it --
 * or, on the delivered page, wrote the answer where it guessed the element
 * keeps it. Answered by key, each element puts its answer where it keeps it.
 */
describe('what a graph asks before it runs', () => {
  const graph = () => parseGraph({
    nodes: [
      { id: 'ask', node_type: 'input', config: { input_mode: 'text', prompt_at_runtime: true, value: '' } },
      { id: 'page', node_type: 'gui', config: { gui_widgets: [{ id: 'pick', kind: 'input_picker', mode: 'directory', value: '' }] } },
      { id: 'quiet', node_type: 'input', config: { value: 'kept' } },
    ],
  });

  it('is answered by the keys it asks with, and says which nodes took an answer', () => {
    const asked = graph();
    const keys = runtimeRequirements(asked, registry).map((requirement) => requirement.key);
    expect(keys).toEqual(['ask', 'page::pick']);

    const answered = applyRuntimeValues(asked, { ask: 'in.txt', 'page::pick': 'data', gone: 'x' }, registry);
    expect([...answered].sort()).toEqual(['ask', 'page']);
    expect(runtimeRequirements(asked, registry)).toEqual([
      expect.objectContaining({ key: 'ask', current: 'in.txt' }),
    ]);
    expect((asked.nodes[1].config.gui_widgets as Array<{ value: string }>)[0].value).toBe('data');
    expect(asked.nodes[2].config.value).toBe('kept');
  });
});
