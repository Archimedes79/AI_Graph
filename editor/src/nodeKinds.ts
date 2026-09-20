// What a node of each type *is*, with nothing set — and what a file keeps of it.
//
// Not drawing, and therefore not `NodeUi`. These three facts are asked while a
// graph is *loaded* and *saved*, which a delivered tool does as much as the
// editor: `normalizeGraphNode` fills a node read from a file back out from
// `create`, and `exportGraph` strips it back down with `saved` before it is
// posted for a run.
//
// They lived on `NodeUi` beside the icon, the colour and the settings panel,
// so the store had to reach into the editor's element registry to load a
// graph — and that registry is the whole builder, panels and ✨ generation
// contracts included, in a module the delivered page loads too.
//
// Their natural home is the engine, beside `NodeElement.config`: what a node
// stores is the element's business, and the engine already owns reading it.
// What keeps them here for now is `NodeConfig`, the one spelled-out settings
// shape, which lives in the editor's `graph.ts`. Moving that is the next step
// and a separate one.

import type { GraphNode, NodeConfig, NodeType } from '@/graph';
import { derivedNodePorts } from '@/elements/nodes/gui/guiWidgets';
import { SubgraphNodeElement } from '@engine/elements/nodes/subgraph/SubgraphNodeElement.ts';
import { TriggerNodeElement } from '@engine/elements/nodes/trigger/TriggerNodeElement.ts';
import { baseNodeConfig } from '@/elements/nodes/baseNodeConfig';

/** Kept even at its starting value: the executor reads it whether or not anyone set it. */
const ALWAYS_SAVED = ['batch_mode'];

const SUBGRAPH = new SubgraphNodeElement();
const TRIGGER = new TriggerNodeElement();

const CODE_STARTER = 'function run(inputs) {\n  return { output: inputs.input ?? "" };\n}\n';

export interface NodeKind {
  /** A node of this type with nothing set: what a new one is, and what a loaded one falls back to. */
  create(id: string): GraphNode;
  /**
   * The settings this node type owns, always written when the graph is saved.
   *
   * Every node is created from the one full `NodeConfig` so the panels can
   * read any field with a type; a saved file should not carry thirty keys its
   * node never reads.
   */
  settings: readonly (keyof NodeConfig)[];
  /** Running this node puts its result in a window of its own. */
  showsResultWindow?(node: GraphNode): boolean;
}

export const NODE_KINDS: Record<NodeType, NodeKind> = {
  input: {
    settings: [
      'input_mode', 'value', 'prompt_at_runtime', 'recursive', 'extensions', 'select_all_files',
      'selector_prompt', 'selector_code', 'example_file', 'output_format_prompt', 'catch_errors',
    ],
    create(id) {
      // A new input starts in text mode, and its ports follow from that -- asked
      // of the engine rather than listed again here.
      const node: GraphNode = {
        id,
        node_type: 'input',
        label: 'Input',
        description: 'A text value, file, or directory',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        config: { ...baseNodeConfig(), input_mode: 'text' },
      };
      return { ...node, ...(derivedNodePorts(node) ?? {}) };
    },
  },

  ai: {
    settings: [
      'ai_provider', 'ai_model', 'system_prompt', 'temperature', 'prompt_template',
      'output_format', 'output_format_prompt', 'output_example', 'mcp_servers', 'send_images',
      'read_file_inputs', 'batch_concurrency', 'example_file', 'catch_errors', 'examples', 'run_code',
    ],
    create: (id) => ({
      id,
      node_type: 'ai',
      label: 'AI Node',
      description: 'Send a prompt to an AI model',
      position: { x: 0, y: 0 },
      // One input, one output. There used to be a second, "Context", on every
      // new node: a port most nodes never wire, that looked like it had to be.
      // A second input is one click on the node when it is wanted, and the
      // message template is where it then gets its place.
      inputs: [
        { id: 'prompt', name: 'Prompt', kind: 'input', data_type: 'text', multi: true, required: false, description: 'What to ask. A list asks once per item.' },
      ],
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: true, required: false, description: 'The answer. One per item when the prompt was a list.' }],
      config: { ...baseNodeConfig(), system_prompt: 'You are a helpful assistant.' },
    }),
  },

  code: {
    settings: [
      'code', 'code_prompt', 'output_schema', 'examples', 'output_format', 'output_format_prompt',
      'read_file_inputs', 'batch_concurrency', 'example_file', 'catch_errors',
    ],
    create: (id) => ({
      id,
      node_type: 'code',
      label: 'Code Node',
      description: 'Execute custom code',
      position: { x: 0, y: 0 },
      inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
      outputs: [{ id: 'output', name: 'Output batch', kind: 'output', data_type: 'any', multi: true, required: false, description: 'One result per input item' }],
      config: { ...baseNodeConfig(), code: CODE_STARTER },
    }),
  },

  data: {
    settings: ['data_value', 'data_format', 'data_prompt', 'data_format_prompt', 'example_file'],
    create: (id) => ({
      id,
      node_type: 'data',
      label: 'Data Node',
      description: 'Persist data with an explicit format contract',
      position: { x: 0, y: 0 },
      inputs: [{ id: 'input', name: 'Update', kind: 'input', data_type: 'any', multi: false, required: false, description: 'Optional new value' }],
      outputs: [{ id: 'output', name: 'Value', kind: 'output', data_type: 'any', multi: false, required: false, description: 'Persisted value' }],
      config: { ...baseNodeConfig(), data_format: 'text', data_value: '' },
    }),
  },

  output: {
    settings: ['output_label', 'write_mode', 'value', 'prompt_at_runtime'],
    showsResultWindow: (node) => node.config.write_mode === 'window',
    create: (id) => ({
      id,
      node_type: 'output',
      label: 'Output',
      description: 'Graph output node',
      position: { x: 0, y: 0 },
      inputs: [
        { id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' },
        { id: 'path', name: 'Path', kind: 'input', data_type: 'file_path', multi: false, required: false, description: 'Optional wired file/directory path, overriding the config value below.' },
      ],
      outputs: [],
      // A window, not nowhere: an output that shows nothing until someone finds
      // the setting is the one node whose whole point would be missing.
      config: { ...baseNodeConfig(), output_label: 'Result', write_mode: 'window' },
    }),
  },

  gui: {
    settings: ['gui_widgets'],
    create: (id) => ({
      id,
      node_type: 'gui',
      label: 'GUI Node',
      description: 'A composed panel of interactive widgets (file/directory pickers, text/chat windows)',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      config: { ...baseNodeConfig(), gui_widgets: [] },
    }),
  },

  subgraph: {
    settings: ['subgraph', 'task', 'catch_errors'],
    create: (id) => ({
      id,
      node_type: 'subgraph',
      label: 'Subgraph',
      description: 'A part of the work, built as its own graph',
      position: { x: 0, y: 0 },
      // None to start with: a port here is a node in there, and there is
      // nothing in there yet.
      inputs: [],
      outputs: [],
      // The engine's own idea of an empty graph, rather than a second copy
      // of what a graph's metadata starts as.
      config: { ...baseNodeConfig(), subgraph: SUBGRAPH.nestedGraph({ config: {} } as never), task: '' },
    }),
  },

  trigger: {
    settings: ['trigger_on_start', 'trigger_every'],
    create: (id) => ({
      id,
      node_type: 'trigger',
      label: 'Start',
      description: 'What starts this graph by itself',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: TRIGGER.derivedPorts().outputs as GraphNode['outputs'],
      config: { ...baseNodeConfig(), trigger_on_start: true, trigger_every: '' },
    }),
  },
};

/**
 * The node as a graph file keeps it: its own settings, and any other key only
 * when it no longer holds the value every node starts with. Loading fills the
 * rest back in from `create`, so nothing is lost either way.
 */
export function savedNode(node: GraphNode): GraphNode {
  const untouched: Record<string, unknown> = baseNodeConfig();
  const own = new Set<string>([...ALWAYS_SAVED, ...NODE_KINDS[node.node_type].settings]);
  const config = Object.fromEntries(Object.entries(node.config)
    .filter(([key, value]) => own.has(key) || JSON.stringify(value) !== JSON.stringify(untouched[key])));
  return { ...node, config: config as NodeConfig };
}
