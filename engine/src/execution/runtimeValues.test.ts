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

  it('asks for a text wired into an input that reads its file as a file, to be browsed for', () => {
    // An input node reads no file: the path of one is a text, wired into the
    // input of the node that reads it. Asked for when the run starts, it was
    // asked for as a text -- a bare box, where a file mode offered a browser.
    const port = (id: string, data_type: string) => ({ id, name: id, kind: 'input', data_type, multi: false, required: false, description: '' });
    const wired = (into: string) => parseGraph({
      nodes: [
        { id: 'paper', node_type: 'input', label: 'Manuscript', config: { input_mode: 'text', value: 'paper.md', prompt_at_runtime: true } },
        { id: 'count', node_type: 'code', inputs: [port('text', 'file_path'), port('title', 'text')], config: { code: 'function run() { return {}; }' } },
      ],
      edges: [{ id: 'e', source_node_id: 'paper', source_port_id: 'output', target_node_id: 'count', target_port_id: into }],
    });
    expect(runtimeRequirements(wired('text'), registry)).toEqual([
      { key: 'paper', label: 'Manuscript', kind: 'file', direction: 'input', current: 'paper.md' },
    ]);
    // A text wired where a text is wanted stays one.
    expect(runtimeRequirements(wired('title'), registry)[0].kind).toBe('text');
  });
});
