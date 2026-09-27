// What a node of each type *is* when it is made, and what a file keeps of it.
//
// Not drawing, and therefore not `NodeGuiBuilder`. These facts are asked while a
// graph is *loaded* and *saved*, which a delivered tool does as much as the
// editor: `normalizeGraphNode` fills a node read from a file back out from
// `baseNodeConfig`, and `exportGraph` strips it back down with `savedNode`
// before it is posted for a run.
//
// They lived on `NodeGuiBuilder` beside the icon, the colour and the settings panel,
// so the store had to reach into the editor's element registry to load a
// graph — and that registry is the whole builder, panels and ✨ generation
// contracts included, in a module the delivered page loads too.
//
// Their natural home is the engine, beside `NodeRunner.config`: what a node
// stores is the element's business, and the engine already owns reading it.
// What keeps them here for now is `NodeConfig`, the one spelled-out settings
// shape, which lives in the editor's `graph.ts`. Moving that is the next step
// and a separate one.

import type { GraphNode, NodeType } from '@/graph';
import { derivedNodePorts } from './guiWidgets';
import { SubgraphNodeRunner } from '@engine/elements/nodes/subgraph/SubgraphNodeRunner.ts';
import { TriggerNodeRunner } from '@engine/elements/nodes/trigger/TriggerNodeRunner.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { baseNodeConfig } from './baseNodeConfig';
import { numberedHeading } from './heading';

const SUBGRAPH = new SubgraphNodeRunner();
const TRIGGER = new TriggerNodeRunner();

// A new node's description starts empty. It used to be the type's blurb --
// "Send a prompt to an AI model" -- which, on an ai or code node, is the
// text ✨ writes the body from: pressing ✨ on a fresh node wrote code for the
// blurb. What the type is for is the field's placeholder instead
// (`NodeGuiBuilder.hint`). Its heading is never empty: its kind and a number,
// the lowest one no node beside it has (`numbered`).

/** A node of a kind whose heading is its kind and a number: the lowest one *others* leave free. */
const numbered = (kind: string) => (node: GraphNode, others: GraphNode[]): GraphNode => (
  { ...node, label: numberedHeading(kind, others.map((other) => other.label)) }
);

export interface NodeKind {
  /**
   * A node of this type as it is made here: its ports, and the settings
   * (`baseNodeConfig`) with what a new one of the kind starts with that the
   * defaults do not say -- which is what its file then carries.
   */
  create(id: string): GraphNode;
  /**
   * A node just made, beside *others* already in the graph: what it starts as
   * where that depends on what is there. `create` alone must not depend on
   * its neighbours.
   */
  placedAmong?(node: GraphNode, others: GraphNode[]): GraphNode;
}

export const NODE_KINDS: Record<NodeType, NodeKind> = {
  input: {
    create(id) {
      // A new input starts in text mode, and its ports follow from that -- asked
      // of the engine rather than listed again here.
      const node: GraphNode = {
        id,
        node_type: 'input',
        label: 'Input',
        description: '',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        config: baseNodeConfig(),
      };
      return { ...node, ...(derivedNodePorts(node) ?? {}) };
    },
  },

  ai: {
    create: (id) => ({
      id,
      node_type: 'ai',
      label: 'AI 1',
      description: '',
      position: { x: 0, y: 0 },
      // One input, one output. There used to be a second, "Context", on every
      // new node: a port most nodes never wire, that looked like it had to be.
      // A second input is one click on the node when it is wanted, and the
      // message template is where it then gets its place.
      inputs: [
        // `any`, not `text`: nobody has said what this carries yet, and that is the
        // difference that decides whether a wired file is read (`execution/fileInputs.ts`).
        // Created `text`, an AI node wired to a folder picker was handed the file
        // *names* -- the box ticked, the rule looking at a word nobody had said.
        { id: 'prompt', name: 'Prompt', kind: 'input', data_type: 'any', multi: true, required: false, description: 'What to ask. A list asks once per item.' },
      ],
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: true, required: false, description: 'The answer. One per item when the prompt was a list.' }],
      // Once per item: a list that arrives is asked about an item at a time.
      config: { ...baseNodeConfig(), batch_mode: 'per_item' },
    }),
    placedAmong: numbered('AI'),
  },

  code: {
    create: (id) => ({
      id,
      node_type: 'code',
      label: 'Code 1',
      description: '',
      position: { x: 0, y: 0 },
      inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
      // No description on the output: "one result per item" was true only while
      // "Run once per item" was ticked, and ✨ is told that by the brief itself.
      outputs: [{ id: 'output', name: 'Output batch', kind: 'output', data_type: 'any', multi: true, required: false, description: '' }],
      // No code: its code.js is the stub until ✨ Code writes it from the text.
      config: { ...baseNodeConfig(), batch_mode: 'per_item' },
    }),
    placedAmong: numbered('Code'),
  },

  data: {
    create: (id) => ({
      id,
      node_type: 'data',
      label: 'Data 1',
      description: '',
      position: { x: 0, y: 0 },
      inputs: [{ id: 'input', name: 'Update', kind: 'input', data_type: 'any', multi: false, required: false, description: 'Optional new value' }],
      outputs: [{ id: 'output', name: 'Value', kind: 'output', data_type: 'any', multi: false, required: false, description: 'Persisted value' }],
      config: baseNodeConfig(),
    }),
    placedAmong: numbered('Data'),
  },

  output: {
    create: (id) => ({
      id,
      node_type: 'output',
      // What it is called is what the run's result calls its value.
      label: 'Result',
      description: '',
      position: { x: 0, y: 0 },
      inputs: [
        { id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' },
        { id: 'path', name: 'Path', kind: 'input', data_type: 'file_path', multi: false, required: false, description: 'Optional: a wired file or folder path, used instead of the one set above.' },
      ],
      outputs: [],
      config: baseNodeConfig(),
    }),
    // Its own label, "Result 2" beside a "Result": two results that share one
    // are a problem `check` names, and only the first keeps it in the run's result.
    // The labels taken are asked the way `check` asks them, of every element
    // that is a result.
    placedAmong(node, others) {
      const taken = new Set(others.flatMap((other) => {
        const element = engineRegistry.node(other.node_type);
        return element?.isResult ? [element.resultLabel(other)] : [];
      }));
      let label = 'Result';
      for (let n = 2; taken.has(label); n += 1) label = `Result ${n}`;
      return { ...node, label };
    },
  },

  gui: {
    create: (id) => ({
      id,
      node_type: 'gui',
      label: 'Page',
      description: '',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      config: baseNodeConfig(),
    }),
  },

  subgraph: {
    create: (id) => ({
      id,
      node_type: 'subgraph',
      label: 'Subgraph',
      description: '',
      position: { x: 0, y: 0 },
      // None to start with: a port here is a node in there, and there is
      // nothing in there yet.
      inputs: [],
      outputs: [],
      // The engine's own idea of an empty graph, rather than a second copy
      // of what a graph's metadata starts as.
      config: { ...baseNodeConfig(), subgraph: SUBGRAPH.nestedGraph({ config: {} } as never) },
    }),
  },

  trigger: {
    create: (id) => ({
      id,
      node_type: 'trigger',
      label: 'Start',
      description: '',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: TRIGGER.derivedPorts().outputs as GraphNode['outputs'],
      config: baseNodeConfig(),
    }),
  },
};

/**
 * The node as a graph file keeps it: every setting that is not its default
 * (`baseNodeConfig`), and none that is -- the engine reads a key left out as
 * that default, and loading fills it back in, so nothing is lost either way.
 */
export function savedNode(node: GraphNode): GraphNode {
  const defaults: Record<string, unknown> = baseNodeConfig();
  const config = Object.fromEntries(Object.entries(node.config)
    .filter(([key, value]) => value !== undefined && JSON.stringify(value) !== JSON.stringify(defaults[key])));
  return { ...node, config: config as GraphNode['config'] };
}
