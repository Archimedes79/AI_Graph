// A node's browser half: the mirror of `engine/src/elements/NodeElement.ts`.

import type { ComponentType } from 'react';
import type { GraphNode, NodeConfig, NodeType } from '@/graph';
import type { ElementGeneration, FieldAccess } from '@/authoring/generation';
import { Ui } from './Ui';
import { baseNodeConfig } from './nodes/baseNodeConfig';

/**
 * Written for every node whatever its type: the engine batches any node, and
 * reads a missing `batch_mode` as a whole list where a new node starts per item.
 */
const ALWAYS_SAVED = ['batch_mode'];

/** What the node editor hands every node panel. A panel takes the part it needs. */
export interface NodePanelProps {
  /** This node type's own Ui. */
  ui: NodeUi;
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  setDescription: (value: string) => void;
  /** Present when the element authors a body; see `Ui.generation`. */
  generation?: ElementGeneration<GraphNode>;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  canGenerate: boolean;
  /** Changes an input node's mode, and the ports that follow from it. */
  applyMode: (mode: 'text' | 'file' | 'directory') => void;
  /** Changes a data node's format, and its ports' data type with it. */
  applyDataFormat: (format: GraphNode['config']['data_format']) => void;
  /** Replaces a gui node's widgets, and the ports that follow from them. */
  applyWidgets: (widgets: GraphNode['config']['gui_widgets']) => void;
  /** An example file whose content is sent along when the body is generated. */
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

/** The folded-away settings most people never touch. */
export type NodeAdvancedPanelProps = Pick<NodePanelProps, 'node' | 'setConfig'>;

export abstract class NodeUi extends Ui<GraphNode, NodePanelProps> {
  abstract readonly nodeType: NodeType;
  /** What the palette and the node's header call it. */
  abstract readonly label: string;
  /** Shown on hover in the palette: what the node is for, in one line. */
  abstract readonly hint: string;
  abstract readonly icon: string;
  /** The node's tint on the canvas: a scheme variable, with the default scheme's colour as fallback. */
  abstract readonly color: string;

  /** A new node of this type, as the palette drops it on the canvas. */
  abstract create(id: string): GraphNode;

  /**
   * The settings this node type owns, always written when the graph is saved.
   *
   * Every node is created from the one full `NodeConfig`, so the panels can
   * read any field with a type; a saved file should not carry thirty keys its
   * node never reads. See `saved`.
   */
  abstract readonly settings: readonly (keyof NodeConfig)[];

  /**
   * The node as a graph file keeps it: its own settings, and any other key
   * only when it no longer holds the value every node starts with. Loading
   * fills the rest back in from `create`, so nothing is lost either way.
   */
  saved(node: GraphNode): GraphNode {
    const untouched: Record<string, unknown> = baseNodeConfig();
    const own = new Set<string>([...ALWAYS_SAVED, ...this.settings]);
    const config = Object.fromEntries(Object.entries(node.config)
      .filter(([key, value]) => own.has(key) || JSON.stringify(value) !== JSON.stringify(untouched[key])));
    return { ...node, config: config as NodeConfig };
  }

  /**
   * The settings most people never touch, drawn folded away under everything
   * else, so that opening a node shows what it *does* and not a form.
   */
  readonly AdvancedPanel?: ComponentType<NodeAdvancedPanelProps>;
  /** What the folded-away settings are about, in a few words: shown on the fold. */
  readonly advancedSummary?: string;
  /**
   * How this node declares its output under its panel: `'format'` is the
   * editable output-format contract (ai, code); `'widgets'` the derived
   * summary a gui node shows. Absent: nothing to declare.
   */
  readonly outputContract?: 'format' | 'widgets';
  /**
   * The panel already covers what the node is for -- a prompt box, a code
   * body -- so the shell draws no separate "Description" field above it.
   */
  readonly ownsDescription?: boolean;
  /** This node carries the graph's interface: it gets a live page. */
  readonly hasRuntimeWindow?: boolean;
  /**
   * This node holds a graph of its own, which the editor can go into. The
   * mirror of `NodeElement.nestedGraph`, and the reason no shell has to know
   * which node type that is.
   */
  readonly opensNestedGraph?: boolean;
  /**
   * The node is a composite of widgets (`config.gui_widgets`): drawn with them
   * on the canvas, and generated widget by widget.
   */
  readonly holdsWidgets: boolean = false;
  /** What the output-format contract means for this kind of node, said above it. */
  readonly outputFormatHint?: string;
  /**
   * Detecting a wired file's format asks for a sample path, rather than
   * reading the node's own value -- a directory input holds a folder, not a file.
   */
  readonly asksForFormatSample: boolean = false;

  /** What this node emits, in one line, for its neighbours' generation context. */
  describeOutput?(node: GraphNode): string;
  /** Whether this particular node shows its result in a window when the run ends. */
  showsResultWindow?(node: GraphNode): boolean;
  /** A line of what the node holds, shown on the canvas under its ports. Nothing, for most. */
  canvasSummary?(node: GraphNode): string | undefined;

  /**
   * The node is a source whose data nothing describes yet -- no sample, no
   * contract -- so a generation sweep would be written against a guess.
   * `fed`: something upstream feeds it.
   */
  missingExample(_node: GraphNode, _fed: boolean): boolean {
    return false;
  }

  /** How a neighbour's generation is told this node feeds it. */
  describeAsSource(node: GraphNode, emits: string): string {
    return `Input from "${node.label}" (${node.node_type} node): ${emits}`;
  }

  /** How a neighbour's generation is told this node receives its output. */
  describeAsTarget(node: GraphNode): string {
    return `Output goes to "${node.label}" (${node.node_type} node).`;
  }
}
