import { describe, it, expect } from 'vitest';
import { GRAPH_SYSTEM } from './graphPrompt.ts';
import { parseGraph } from '../../graph.ts';
import { registry } from '../../elements/registry.ts';
import { InputNodeRunner } from '../../elements/nodes/input/InputNodeRunner.ts';
import type { GraphNode } from '../../graph.ts';

/**
 * What a graph is *wrong* without.
 *
 * The prompt used to describe only the document's shape, which is enough to
 * get a graph that parses and does nothing: the code went into a key no
 * element reads, and edges named ports an input node never emits. These tests
 * hold the facts that fixed that against the code they describe, so the prompt
 * cannot quietly drift away from the engine it is teaching.
 */

/** The one worked document the prompt hands over, taken back out of it. */
function example(): unknown {
  const fenced = /```json\n([\s\S]*?)```/.exec(GRAPH_SYSTEM);
  expect(fenced, 'the prompt should carry one fenced example').toBeTruthy();
  return JSON.parse(fenced![1]);
}

describe('the graph prompt', () => {
  it('teaches an example that is itself a valid graph', () => {
    // If the document we hand the model as correct does not parse, every graph
    // copied from it is wrong in the same way.
    expect(() => parseGraph(example())).not.toThrow();
  });

  it('wires that example only to ports its elements really emit', () => {
    const graph = parseGraph(example());
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const edge of graph.edges) {
      const source = byId.get(edge.source_node_id)!;
      const element = registry.node(source.node_type)!;
      // A derived-port element ignores what the document declares, so its real
      // ports are the ones to check against.
      const derived = element.derivedPorts(source, registry);
      const emitted = (derived ?? { outputs: source.outputs }).outputs.map((p) => p.id);
      expect(emitted, `${source.id} must really emit ${edge.source_port_id}`).toContain(edge.source_port_id);
    }
  });

  it('names the derived port names the input element actually produces', () => {
    const element = new InputNodeRunner();
    const node = (mode: string): GraphNode => ({
      id: 'i', node_type: 'input', label: '', description: '', position: { x: 0, y: 0 },
      inputs: [], outputs: [], config: { input_mode: mode },
    });
    for (const mode of ['text', 'directory']) {
      for (const port of element.derivedPorts(node(mode))!.outputs) {
        expect(GRAPH_SYSTEM, `${mode} mode emits ${port.id}`).toContain(`"${port.id}"`);
      }
    }
  });

  it('says which derived input ports carry a number, not text', () => {
    // A port named without its type reads as text, and a graph built on that
    // reading adds "3" to "4" and gets "34". Every derived number port is
    // named with what it holds, so a directory's count is used as a count.
    const element = new InputNodeRunner();
    const node = (mode: string): GraphNode => ({
      id: 'i', node_type: 'input', label: '', description: '', position: { x: 0, y: 0 },
      inputs: [], outputs: [], config: { input_mode: mode },
    });
    const numbers = ['text', 'directory']
      .flatMap((mode) => element.derivedPorts(node(mode))!.outputs)
      .filter((port) => port.data_type === 'number');
    expect(numbers.map((port) => port.id)).toContain('count');
    for (const port of numbers) {
      expect(GRAPH_SYSTEM, `${port.id} is said to be a number`).toContain(`"${port.id}" (a number`);
    }
  });

  it('names each derived input port with what it holds', () => {
    // Said from `derivedPorts`, so a type or a port changed there is changed here.
    const element = new InputNodeRunner();
    for (const mode of ['text', 'directory']) {
      const derived = element.derivedPorts({ id: 'i', config: { input_mode: mode } } as unknown as GraphNode)!;
      for (const port of [...derived.inputs, ...derived.outputs]) {
        const holds = { text: 'text', number: 'a number', file_path: port.multi ? 'a list of file paths' : 'a file path' }[port.data_type as string];
        expect(GRAPH_SYSTEM, `${mode}: ${port.id}`).toContain(`"${port.id}" (${holds}`);
      }
    }
  });

  it('offers no input that reads a file: the node that wants the text reads it, from a path held as text', () => {
    expect(GRAPH_SYSTEM).not.toMatch(/input_mode "file"|"input_mode": "file"/);
    expect(registry.node('input')!.graphAuthorNote()).toContain('hold the path as text and wire it into that node\'s input typed "file_path"');
  });

  it('lists every block kind the registry knows, each with what it says of itself', () => {
    // The kinds used to be a hand-kept list, which never learnt of the spacer.
    for (const kind of registry.widgetKinds()) {
      const note = registry.widget(kind)!.graphAuthorNote();
      expect(GRAPH_SYSTEM, kind).toContain(`  - ${kind}${note ? `: ${note}` : '\n'}`);
    }
    // The three modes a text box has, the default one included.
    expect(registry.widget('text_io')!.graphAuthorNote()).toMatch(/input .*output .*both/);
  });

  it('offers a block no code of its own: a drawing block shows what arrives, a folder hands on its listing', () => {
    for (const kind of ['plot_window', 'table', 'image_view'] as const) {
      const note = registry.widget(kind)!.graphAuthorNote()!;
      expect(note, kind).toMatch(/^shows what arrives on "<id>_in"/);
      expect(note, kind).not.toMatch(/config\.code|transform/);
    }
    expect(GRAPH_SYSTEM).toContain('A block has no code of its own');
    expect(GRAPH_SYSTEM).not.toMatch(/selector|select_all_files/);
    // Choosing some of a folder's files is a code node, said where a folder is.
    for (const note of [registry.node('input')!.graphAuthorNote()!, registry.widget('input_picker')!.graphAuthorNote()!]) {
      expect(note).toMatch(/extensions/);
      expect(note).toMatch(/recursive/);
    }
    expect(registry.node('input')!.graphAuthorNote()).toContain('to keep only some of the files, wire a code node after it');
  });

  it('says a node is its label and its description, and where each kind keeps what it runs', () => {
    expect(GRAPH_SYSTEM).toContain('Every node is its label and its description');
    for (const type of ['code', 'ai']) expect(registry.node(type)!.graphAuthorNote(), type).toMatch(/^its description says in words what it does/);
    expect(registry.node('code')!.graphAuthorNote()).toContain('config.code holds it as JavaScript');
    expect(registry.node('ai')!.graphAuthorNote()).toContain('config.output_definition');
    // And the worked example does it: its code node says what it does in its description.
    const code = parseGraph(example()).nodes.find((node) => node.node_type === 'code')!;
    expect(code.description).toBe('Count the lines of the text.');
    expect(code.config.prompt).toBeUndefined();
  });

  it('says a graph has one page, which holds every block: a second one is a problem check names', () => {
    expect(GRAPH_SYSTEM).toContain('- gui: A graph has at most one gui node: its page, which holds every block.');
  });

  it('names every node type the registry knows, except the ones that say a graph is not built with them', () => {
    const silent: string[] = [];
    for (const type of registry.nodeTypes()) {
      const note = registry.node(type)!.graphAuthorNote();
      if (!note) { silent.push(type); continue; }
      expect(GRAPH_SYSTEM, `${type} is listed as valid`).toMatch(new RegExp(`Valid node_type values: [^.]*\\b${type}\\b`));
      expect(GRAPH_SYSTEM, `${type} says where its settings are`).toContain(`- ${type}: ${note}`);
    }
    // Deliberate, and pinned: a subgraph is a graph inside a node, built by hand. A new kind
    // that forgot its note would show up here instead of quietly missing from the prompt.
    expect(silent).toEqual(['subgraph']);
  });
});

describe('a graph that shows nothing', () => {
  /**
   * The complaint this came from: a generated graph computed its answer and
   * ended there, so running it showed a blank screen and the tool looked
   * broken. Ending in something visible is a rule, not a matter of taste.
   */
  it('is ruled out in words: an output node is the run\'s result, under its label, and opens no window', () => {
    expect(GRAPH_SYSTEM).toContain('must end in something a person can see');
    expect(GRAPH_SYSTEM).toContain('what arrives there is the run\'s result, shown to whoever ran the graph under the node\'s label');
    expect(GRAPH_SYSTEM).not.toMatch(/"window"|output_label/);
  });

  it('and the worked example obeys its own rule', () => {
    const graph = parseGraph(example());
    const sources = new Set(graph.edges.map((e) => e.source_node_id));
    const ends = graph.nodes.filter((n) => !sources.has(n.id));
    expect(ends.length).toBeGreaterThan(0);
    for (const node of ends) {
      expect(['output', 'gui'], `${node.id} ends a branch`).toContain(node.node_type);
    }
  });
});
