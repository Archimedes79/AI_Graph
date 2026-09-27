// A node's build-time half, in the browser: the mirror of `engine/src/elements/NodeRunner.ts`.

import type { ComponentType, ReactNode } from 'react';
import type { Graph, GraphNode, NodeResult, NodeType } from '@/graph';
import type { FieldAccess } from '@/authoring/generation';
import { describeDeclaredOutput } from '@/authoring/outputFormat';
import { readPair } from '@/authoring/examplePair';
import { ElementGuiBuilder } from './ElementGuiBuilder';
import { previewOf, type PortPreviews } from './resultPreview';

/** What the node editor hands every node panel. A panel takes the part it needs. */
export interface NodePanelProps {
  /** This node type's own builder. */
  builder: NodeGuiBuilder;
  node: GraphNode;
  /**
   * Sets one setting of the draft. *value* may instead be a function of the
   * setting as the draft holds it when the change lands: what a write made
   * after a wait -- a run upstream, a file read -- is merged into, so that it
   * does not put back a copy from before the wait over what was typed meanwhile.
   */
  setConfig: (key: string, value: unknown) => void;
  /** Changes the draft as a whole, for a setting that is a port and a key at once ("Run once per item"). */
  updateNode: (change: (node: GraphNode) => GraphNode) => void;
  /**
   * The draft's settings and description by name: what ✨ fills in, and what a
   * panel writes the description through. Whether the element authors a body
   * at all is its own `builder.generation`.
   */
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  /**
   * Says that something the panel holds cannot be saved as it stands -- JSON
   * that does not parse -- under *key*, or that it can again (''). While any
   * reason stands the dialog will not Save, and closing asks first: a Save
   * that silently kept the last good value lost the edit without a word.
   */
  setInvalid: (key: string, reason: string) => void;
  /**
   * What only the dialog has, for a panel that authors a body in the four
   * steps (`FourSteps`): the "what ✨ sends" button and what it sends, "open
   * in my editor" -- and, where the ports are the person's to name
   * (`stepped`), the two port lists, for "What comes in" and "What comes out".
   */
  steps?: {
    inputs?: ReactNode;
    outputs?: ReactNode;
    preview?: ReactNode;
    sent?: ReactNode;
    openInEditor?: ReactNode;
    /**
     * The graph on the canvas with this node as the dialog holds it: what Try
     * it, ▶ Test and the model's request are asked of is the edit.
     */
    graph: () => Graph;
    /** ⟳ From the graph: what arrives at the node -- on the last run, else from what feeds it, run now. Absent for a node nothing can feed. */
    fromGraph?: () => Promise<{ values: Record<string, unknown>; said: string }>;
  };
}

export type PortEditing = 'edit' | 'fixed' | 'none';

/** The folded-away settings most people never touch. */
export type NodeAdvancedPanelProps = Pick<NodePanelProps, 'node' | 'setConfig'>;

export abstract class NodeGuiBuilder extends ElementGuiBuilder<GraphNode, NodePanelProps> {
  // ── What it is ────────────────────────────────────────────────────────────

  abstract readonly nodeType: NodeType;

  // ── Run time ──────────────────────────────────────────────────────────────
  // Nothing, on purpose. Whether a node is a page of widgets is the engine's
  // `hasInterface`, asked through `showsPage` (document/guiWidgets.ts), which a
  // deployed tool reads without this class.

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
   * The panel already covers what the node is for -- a prompt box, a code
   * body -- so the shell draws no separate "Description" field above it.
   */
  readonly ownsDescription?: boolean;

  /**
   * The dialog is laid out as the four steps of building the node -- what
   * comes in, what comes out, what it should do, and how, tried right there --
   * with the ports inside those steps rather than in a list of their own. For
   * the nodes whose body is written against its ports: ai and code.
   */
  readonly stepped: boolean = false;

  /**
   * How much of each side's ports is the person's to change.
   * `edit`: add, remove, rename, type. `fixed`: the node reads them by name,
   * so they are shown and not changed. `none`: the side is not shown; the
   * node has no such ports. What a port carries is not written per port: an
   * input's comes from what is wired into it, an output's is said once, in
   * step 2's words. Only asked where the ports are not derived (`derivedNodePorts`).
   */
  readonly portEditing: { inputs: PortEditing; outputs: PortEditing } = { inputs: 'edit', outputs: 'edit' };

  /** One line under each side of the port list: how the node's body sees them. */
  portHint(_side: 'inputs' | 'outputs', _node: GraphNode): string | undefined {
    return undefined;
  }

  /**
   * *after* -- the draft once a setting re-derived its ports -- with each new
   * port that carries on what a port of *before* carried marked as that one
   * (`continuing`), so its wires follow it on Save. *before* is the node as
   * stored, whose ports the wires are on, not the draft a step earlier
   * (`withSetting`). By default no port continues another: a derived port is
   * the port of its name, or new, and a port that is gone takes its wires
   * with it.
   */
  continuePorts(_before: GraphNode, after: GraphNode): GraphNode {
    return after;
  }

  /**
   * What this node emits, in one line, for its neighbours' generation context.
   * The node's declared output by default -- its words, an example, and the
   * shape a run kept, which is the best description there is of what the next
   * node will be handed. A node whose output is something else says that.
   */
  describeOutput(node: GraphNode): string {
    return describeDeclaredOutput(node.config);
  }

  /**
   * Step 1's example, as the values the node is handed on each input port, or
   * undefined when it has none. The first pair of `examples.md` by default:
   * what a node's example has always been, and what `test` runs.
   */
  exampleInput(node: GraphNode): Record<string, unknown> | undefined {
    return readPair(node.config.examples).input;
  }

  /**
   * The description a saved node publishes (the "description" in its
   * nodes/<id>/node.json). Where the dialog asks what the node should do in a
   * field of its own and draws no description box (`ownsDescription`), that
   * task *is* the description, written into it on every Save: a second text
   * nobody could see or edit went on being published beside the task, and the
   * two drifted apart. An empty task leaves what was there.
   */
  publishedDescription(node: GraphNode): string {
    const field = this.generation?.promptField;
    if (!this.ownsDescription || !field || field === 'description') return node.description;
    const task = String((node.config as unknown as Record<string, unknown>)[field] ?? '').trim();
    return task || node.description;
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
   * The node is a source whose data nothing describes yet -- no sample, no
   * contract -- so a generation sweep would be written against a guess.
   * `fed`: something upstream feeds it.
   */
  missingExample(_node: GraphNode, _fed: boolean): boolean {
    return false;
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
   * The file whose text this node hands on from one output port without
   * running anything -- an input node's file -- or undefined. A node wired to
   * it is shown that file's text as its sample before the graph has ever run:
   * the path is sent, and the engine reads it the way a run reads a file.
   */
  restingFile(_node: GraphNode, _port: string): string | undefined {
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
