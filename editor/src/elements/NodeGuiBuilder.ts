// A node's build-time half, in the browser: the mirror of `engine/src/elements/NodeRunner.ts`.

import type { ComponentType, ReactNode } from 'react';
import type { GraphNode, NodeType } from '@/graph';
import type { ElementGeneration, FieldAccess } from '@/authoring/generation';
import { ElementGuiBuilder } from './ElementGuiBuilder';

/** What the node editor hands every node panel. A panel takes the part it needs. */
export interface NodePanelProps {
  /** This node type's own builder. */
  builder: NodeGuiBuilder;
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  setDescription: (value: string) => void;
  /** Present when the element authors a body; see `ElementGuiBuilder.generation`. */
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
  /**
   * The shell's port lists and the "what ✨ sends" button, for a panel laid
   * out in steps (`stepped`): it places them in "What comes in", "What comes
   * out" and beside ✨ -- see `AuthoredBodyEditor`.
   */
  steps?: { inputs: ReactNode; outputs: ReactNode; preview?: ReactNode; sent?: ReactNode };
}

export type PortEditing = 'edit' | 'describe' | 'none';

/** The folded-away settings most people never touch. */
export type NodeAdvancedPanelProps = Pick<NodePanelProps, 'node' | 'setConfig'>;

export abstract class NodeGuiBuilder extends ElementGuiBuilder<GraphNode, NodePanelProps> {
  // ── What it is ────────────────────────────────────────────────────────────

  abstract readonly nodeType: NodeType;

  // ── Run time ──────────────────────────────────────────────────────────────
  // What a deployed tool asks of a node: whether it is a page, whether its result opens a window.



  // ── Build time ────────────────────────────────────────────────────────────
  // The editor: the palette, a new element, its panels, what ✨ Generate is told.
  // It travels into a tool with the class, and no tool calls it (`runtime/boundary.test.ts`).

  /** What the palette and the node's header call it. */
  abstract readonly label: string;

  /** Shown on hover in the palette: what the node is for, in one line. */
  abstract readonly hint: string;

  abstract readonly icon: string;

  /** The node's tint on the canvas: a scheme variable, with the default scheme's colour as fallback. */
  abstract readonly color: string;

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


  /**
   * The node is a composite of widgets (`config.gui_widgets`): drawn with them
   * on the canvas, and generated widget by widget.
   */
  readonly holdsWidgets: boolean = false;

  /**
   * The dialog is laid out as the steps of building the node -- what it should
   * do, what comes in, what comes out, how, and trying it -- with the ports
   * inside those steps rather than in a list of their own. For the nodes whose
   * body is written against its ports -- ai and code -- and for a data node,
   * whose format is written against what it takes and hands on.
   */
  readonly stepped: boolean = false;

  /**
   * How much of each side's ports is the person's to change.
   * `edit`: add, remove, rename, type. `describe`: the ports are fixed -- the
   * node reads them by name -- but what each one carries can be said.
   * `none`: the side is not shown; the node has no such ports.
   * Only asked where the ports are not derived (`derivedNodePorts`).
   */
  readonly portEditing: { inputs: PortEditing; outputs: PortEditing } = { inputs: 'edit', outputs: 'edit' };

  /** One line under each side of the port list: how the node's body sees them. */
  portHint(_side: 'inputs' | 'outputs', _node: GraphNode): string | undefined {
    return undefined;
  }

  /** What the output-format choice is called for this kind of node: an ai node's is its answer's. */
  readonly outputFormatLabel: string = 'Output format';

  /** What the output-format contract means for this kind of node, said above it. */
  readonly outputFormatHint?: string;

  /**
   * Detecting a wired file's format asks for a sample path, rather than
   * reading the node's own value -- a directory input holds a folder, not a file.
   */
  readonly asksForFormatSample: boolean = false;

  /** What this node emits, in one line, for its neighbours' generation context. */
  describeOutput?(node: GraphNode): string;

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

  /**
   * What this node hands on from one output port without running anything --
   * a typed text, a stored value -- or undefined. A node wired to it is shown
   * this as its sample before the graph has ever run, rather than nothing.
   */
  restingValue(_node: GraphNode, _port: string): unknown {
    return undefined;
  }

  /**
   * What this node wants on one of its input ports, in words, for a node
   * wired into it: its ✨ is told, beside the output that feeds it. The
   * port's own description by default; a node whose port wants something
   * more particular -- a chart block, a data node's format -- says that.
   */
  wantsOn(node: GraphNode, port: string): string | undefined {
    return node.inputs.find((p) => p.id === port)?.description?.trim() || undefined;
  }

  /**
   * How a neighbour's generation is told this node receives its output.
   * `port`: the input port the wire lands on, for a node whose ports differ
   * in what they want -- a page's blocks do.
   */
  describeAsTarget(node: GraphNode, _port?: string): string {
    return `Output goes to "${node.label}" (${node.node_type} node).`;
  }

}
