import { describe, it, expect } from 'vitest';
import { GRAPH_SYSTEM } from './graphPrompt.ts';
import { parseGraph } from '../../graph.ts';
import { registry } from '../../registry.ts';
import { InputElement } from '../../elements/input/element.ts';
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
      const derived = element.derivedPorts(source);
      const emitted = (derived ?? { outputs: source.outputs }).outputs.map((p) => p.id);
      expect(emitted, `${source.id} must really emit ${edge.source_port_id}`).toContain(edge.source_port_id);
    }
  });

  it('names the derived port names the input element actually produces', () => {
    const element = new InputElement();
    const node = (mode: string): GraphNode => ({
      id: 'i', node_type: 'input', label: '', description: '', position: { x: 0, y: 0 },
      inputs: [], outputs: [], config: { input_mode: mode },
    });
    for (const mode of ['text', 'file', 'directory']) {
      for (const port of element.derivedPorts(node(mode))!.outputs) {
        expect(GRAPH_SYSTEM, `${mode} mode emits ${port.id}`).toContain(`"${port.id}"`);
      }
    }
  });

  it('names every node type the registry knows', () => {
    for (const type of ['input', 'data', 'ai', 'code', 'output', 'gui']) {
      expect(registry.node(type), `${type} should exist`).toBeDefined();
      expect(GRAPH_SYSTEM).toContain(type);
    }
  });
});

describe('a graph that shows nothing', () => {
  /**
   * The complaint this came from: a generated graph computed its answer and
   * ended there, so running it showed a blank screen and the tool looked
   * broken. Ending in something visible is a rule, not a matter of taste.
   */
  it('is ruled out in words', () => {
    expect(GRAPH_SYSTEM).toContain('must end in something a person can see');
    expect(GRAPH_SYSTEM).toContain('"window"');
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
