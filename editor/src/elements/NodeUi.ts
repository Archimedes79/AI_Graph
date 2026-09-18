// A node's browser half: the mirror of `engine/src/elements/NodeElement.ts`.

import type { ComponentType } from 'react';
import type { GraphNode, NodeType } from '@/graph';
import type { ElementGeneration, FieldAccess } from '@/authoring/generation';
import { Ui } from './Ui';

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

  /** What this node emits, in one line, for its neighbours' generation context. */
  describeOutput?(node: GraphNode): string;
  /** Whether this particular node shows its result in a window when the run ends. */
  showsResultWindow?(node: GraphNode): boolean;
}
