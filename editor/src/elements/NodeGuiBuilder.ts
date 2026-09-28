// A node's build-time half, in the browser: the mirror of `engine/src/elements/NodeRunner.ts`.

import type { ComponentType, ReactNode } from 'react';
import type { AICall } from '@/api/client';
import type { Graph, GraphNode, NodeResult, NodeType } from '@/graph';
import type { Refine, Write } from '@/authoring/generation';
import { ElementGuiBuilder } from './ElementGuiBuilder';
import { previewOf, type PortPreviews } from './resultPreview';

/**
 * Which undo step a change made in a node's panel is (`canvas/nodePanel.ts`).
 * Typing is one step with what was typed into the same field a moment before:
 * the setting's own field, unless `{ field }` names the one typed into. `ONCE`
 * is what is not typing -- a file dropped in, a box ticked, what ✨ wrote --
 * written at once, as a step of its own.
 */
export const ONCE = 'once';
export type UndoStep = typeof ONCE | { field: string };

/**
 * What the node editor hands every node panel. A panel takes the part it needs.
 *
 * What a panel changes is in the graph a moment later (`canvas/nodePanel.ts`):
 * there is no Save to wait for. So what cannot be stored yet -- JSON that does
 * not parse, a name another port has -- is not handed on at all: the field
 * keeps it as typed and says why (`useTyped`).
 */
export interface NodePanelProps {
  /** This node type's own builder. */
  builder: NodeGuiBuilder;
  node: GraphNode;
  /**
   * Sets one setting, as the undo step *step* says (typing into it, by
   * default). *value* may instead be a function of the setting as it is when
   * the change lands: what a write made after a wait -- a run upstream, a
   * file read -- is merged into, so that it does not put back a copy from
   * before the wait over what was typed meanwhile.
   */
  setConfig: (key: string, value: unknown, step?: UndoStep) => void;
  /** Changes the node as a whole, for a setting that is a port and a key at once ("Run once per item"). */
  updateNode: (change: (node: GraphNode) => GraphNode, step?: UndoStep) => void;
  /** Writes the node's text -- what it should do, in words -- as typed. */
  setDescription: (text: string) => void;
  /** ✨ is writing now. */
  generating: boolean;
  /** What the last ✨ said. */
  message?: string;
  /**
   * ✨: write *write* -- for the body of a node with definitions, what is
   * missing first -- or, asked with *refine*, change the body there is
   * ("Say what to change", ✨ Fix). Resolves to whether something was written.
   */
  onGenerate: (write: Write, refine?: Refine) => Promise<boolean>;
  /** What only the side panel has, for a panel of a node ✨ writes for. */
  shell?: {
    /** The graph on the canvas with this node as the side panel shows it: what ▶ Try is asked of is the edit. */
    graph: () => Graph;
    /** What *write*'s ✨ would send, filled in, without sending it. */
    preview: (write: Write) => Promise<AICall[]>;
    /** The file the graph hands one of this node's file-reading inputs -- a picker's value, a path the last run brought -- or undefined. */
    graphFile: () => Promise<string | undefined>;
    /** Write what the side panel still holds into the graph now: before a project is saved to open one of its files. */
    flush: () => void;
  };
}

export type PortEditing = 'edit' | 'fixed' | 'none';

/** The folded-away settings most people never touch -- and, where they are the node's own to edit, its ports. */
export type NodeAdvancedPanelProps = Pick<NodePanelProps, 'node' | 'setConfig' | 'updateNode'> & {
  /** The ports editor, drawn by the side panel, for a node that keeps its ports among these settings (`definesItself`). */
  ports?: ReactNode;
};

export abstract class NodeGuiBuilder extends ElementGuiBuilder<NodePanelProps> {
  // ── What it is ────────────────────────────────────────────────────────────

  abstract readonly nodeType: NodeType;

  // ── Run time ──────────────────────────────────────────────────────────────
  // Nothing, on purpose. Whether a node is a page of widgets is the engine's
  // `hasInterface`, asked through `showsPage` (document/guiWidgets.ts), which a
  // deployed tool reads without this class.

  // ── Build time ────────────────────────────────────────────────────────────
  // The editor: the palette, a new element, its panels, what ✨ is told.
  // It travels into a tool with the class, and no tool calls it (`runtime/boundary.test.ts`).

  /** What the palette calls it, and what a new one's heading starts with: "Code 1". */
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
   * The panel draws the node's text itself -- what it should do, the text ✨
   * writes from -- so the side panel draws no description box of its own above it.
   */
  readonly ownsDescription?: boolean;

  /**
   * A node that says what its ports carry in its definitions (input.js,
   * output.js): a code or an ai node. Its ports are edited among its Advanced
   * settings, without a type per port -- an input's follows its wire -- and
   * its outputs follow its output definition.
   */
  readonly definesItself: boolean = false;

  /**
   * How much of each side's ports is the person's to change.
   * `edit`: add, remove, rename, type. `fixed`: the node reads them by name,
   * so they are shown and not changed. `none`: the side is not shown; the
   * node has no such ports. Only asked where the ports are not derived (`derivedNodePorts`).
   */
  readonly portEditing: { inputs: PortEditing; outputs: PortEditing } = { inputs: 'edit', outputs: 'edit' };

  /** One line under each side of the port list: how the node's body sees them. */
  portHint(_side: 'inputs' | 'outputs', _node: GraphNode): string | undefined {
    return undefined;
  }

  /**
   * What this node hands on, in words, for the nodes it feeds: their ✨ is
   * told it beside the wire. Nothing by default; a node whose output
   * definition says it, or whose kind does, says that.
   */
  describeOutput(_node: GraphNode): string {
    return '';
  }

  /**
   * What a file dropped on the node on the canvas gives it, or undefined where
   * a drop means nothing to it: a code or an ai node takes the file as its
   * example file (by *path*), a data node what the file says (*text*), as what
   * it holds. Only the one that is used is asked for.
   */
  dropPort(_node: GraphNode): 'path' | 'text' | undefined {
    return undefined;
  }

  /** *node* holding *value* from a file dropped on it: see `dropPort`. */
  withDropped(node: GraphNode, _value: unknown): GraphNode {
    return node;
  }

  /** A line of what the node holds, shown on the canvas under its ports. Nothing, for most. */
  canvasSummary?(node: GraphNode): string | undefined;

  /**
   * What the canvas shows of this node's last result, beside the port each
   * value stands at, read by its shape (`resultPreview.ts`): what came out of
   * an output port stands under that port, and a value handed on under the
   * name of an input -- an output node's -- under the input it arrived on.
   */
  resultPreviews(node: GraphNode, result: NodeResult): PortPreviews {
    const previews: PortPreviews = { inputs: {}, outputs: {} };
    for (const [port, value] of Object.entries(result.outputs ?? {})) {
      const side = node.outputs.some((p) => p.id === port) ? 'outputs'
        : node.inputs.some((p) => p.id === port) ? 'inputs' : undefined;
      const preview = side && previewOf(value);
      if (side && preview) previews[side][port] = preview;
    }
    return previews;
  }

  /**
   * The node is a source whose data nothing describes yet -- no file or
   * folder to read -- so a generation sweep would be written against a guess.
   * `fed`: something upstream feeds it.
   */
  missingExample(_node: GraphNode, _fed: boolean): boolean {
    return false;
  }

  /**
   * What this node hands on from one output port without running anything --
   * a typed text, a picked file -- or undefined: where a node wired to it
   * finds the file its example is taken from before the graph has ever run.
   */
  restingValue(_node: GraphNode, _port: string): unknown {
    return undefined;
  }

  /**
   * What this node wants on one of its input ports, in words, for a node
   * wired into it: its ✨ is told, beside the output that feeds it. The
   * port's own description by default; a node whose port wants something
   * more particular -- a chart block, what a data node stores -- says that.
   */
  wantsOn(node: GraphNode, port: string): string | undefined {
    return node.inputs.find((p) => p.id === port)?.description?.trim() || undefined;
  }

}
