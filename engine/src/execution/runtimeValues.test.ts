import { describe, it, expect } from 'vitest';
import { parseGraph } from '../graph.ts';
import { registry } from '../elements/registry.ts';
import { runtimeRequirements } from './runtimeValues.ts';
import { applyValues } from './graphInterface.ts';
import { memoryFeedbackEdges } from './executor.ts';
import { triggeredNodes } from './triggers.ts';

/**
 * A question's key is the name of the value that answers it -- the name any
 * caller gives that value under (`graphInterface.ts`). The server used to split
 * a key into a node and a block for the wire, and each page rebuilt it.
 * Answered by name, each element puts its answer where it keeps it.
 */
describe('what a graph asks before it runs', () => {
  const graph = () => parseGraph({
    nodes: [
      { id: 'ask', node_type: 'input', config: { input_mode: 'text', prompt_at_runtime: true, value: '' } },
      { id: 'page', node_type: 'gui', config: { gui_widgets: [{ id: 'pick', kind: 'input_picker', mode: 'directory', value: '' }] } },
      { id: 'quiet', node_type: 'input', config: { value: 'kept' } },
    ],
  });

  it('is answered by the names it asks with -- a block by its id, a node by its own', () => {
    const asked = graph();
    const keys = runtimeRequirements(asked, registry).map((requirement) => requirement.key);
    expect(keys).toEqual(['ask', 'pick']);

    applyValues(asked, { ask: 'in.txt', pick: 'data' }, registry);
    expect(runtimeRequirements(asked, registry)).toEqual([
      expect.objectContaining({ key: 'ask', current: 'in.txt' }),
    ]);
    expect((asked.nodes[1].config.gui_widgets as Array<{ value: string }>)[0].value).toBe('data');
    expect(asked.nodes[2].config.value).toBe('kept');
  });

  it('refuses an answer under a name the graph does not take, before it writes any', () => {
    const asked = graph();
    expect(() => applyValues(asked, { ask: 'in.txt', gone: 'x' }, registry)).toThrow(/No value called "gone": this graph takes "ask", "pick", "quiet"/);
    expect(asked.nodes[0].config.value).toBe('');
  });

  it('asks for one event only what that event runs: pressing "Plot" does not ask for the file only "Summarize" reads', () => {
    const port = (id: string) => ({ id, name: id, kind: 'input', data_type: 'any', multi: false, required: false, description: '' });
    const block = (id: string) => ({ id, kind: 'input_picker', mode: 'file', label: id, value: '' });
    const tools = parseGraph({
      nodes: [
        { id: 'page', node_type: 'gui', config: { gui_widgets: [block('text'), block('csv'), { id: 'summarize', kind: 'button', label: 'Summarize' }, { id: 'plot', kind: 'button', label: 'Plot' }] } },
        { id: 'summary', node_type: 'code', inputs: [port('file')], config: { code: 'function run() { return {}; }' } },
        { id: 'chart', node_type: 'code', inputs: [port('file')], config: { code: 'function run() { return {}; }' } },
      ],
      edges: [
        { id: 'a', source_node_id: 'page', source_port_id: 'text_out', target_node_id: 'summary', target_port_id: 'file' },
        { id: 'b', source_node_id: 'page', source_port_id: 'summarize_out', target_node_id: 'summary', target_port_id: '__run' },
        { id: 'c', source_node_id: 'page', source_port_id: 'csv_out', target_node_id: 'chart', target_port_id: 'file' },
        { id: 'd', source_node_id: 'page', source_port_id: 'plot_out', target_node_id: 'chart', target_port_id: '__run' },
      ],
    });
    const feedback = memoryFeedbackEdges(tools.nodes, tools.edges, registry);
    const askedFor = (event: string | null) => runtimeRequirements(
      tools, registry, event ? triggeredNodes(tools, { node_id: 'page', port_id: event }, feedback) : null,
    ).map((requirement) => requirement.key);
    expect(askedFor('plot_out')).toEqual(['csv']);
    expect(askedFor('summarize_out')).toEqual(['text']);
    // A run of everything asks everything.
    expect(askedFor(null)).toEqual(['text', 'csv']);
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
