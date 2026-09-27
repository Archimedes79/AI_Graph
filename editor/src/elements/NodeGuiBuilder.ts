// A node's build-time half, in the browser: the mirror of `engine/src/elements/NodeRunner.ts`.

import type { ComponentType, ReactNode } from 'react';
import type { GraphNode, NodeType } from '@/graph';
import type { ElementGeneration, FieldAccess } from '@/authoring/generation';
import { outputFormatText } from '@/authoring/outputFormat';
import { readPair } from '@/authoring/examplePair';
import { ElementGuiBuilder } from './ElementGuiBuilder';

/** What the node editor hands every node panel. A panel takes the part it needs. */
export interface NodePanelProps {
  /** This node type's own builder. */
  builder: NodeGuiBuilder;
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  /** Changes the draft as a whole, for a setting that is a port and a key at once ("Run once per item"). */
  updateNode: (change: (node: GraphNode) => GraphNode) => void;
  setDescription: (value: string) => void;
  /** Present when the element authors a body; see `ElementGuiBuilder.generation`. */
  generation?: ElementGeneration<GraphNode>;
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
  steps?: { inputs?: ReactNode; outputs?: ReactNode; preview?: ReactNode; sent?: ReactNode; openInEditor?: ReactNode };
}

export type PortEditing = 'edit' | 'fixed' | 'none';

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
   * editable output-format contract (ai, code). Absent: nothing to declare.
   */
  readonly outputContract?: 'format';

  /**
   * The panel already covers what the node is for -- a prompt box, a code
   * body -- so the shell draws no separate "Description" field above it.
   */
  readonly ownsDescription?: boolean;

  /**
   * What step 2's example output is for this kind of node. `expect`: the
   * outputs its example must give, the example's expect block in
   * `examples.md` -- checked by Try it, ✨'s verify pass and `test`. `answer`:
   * an answer a model is shown to imitate (`output_example`), sent on every
   * run, because an ai node's answer is never the same twice. Absent: the
   * node has no example output to keep.
   */
  readonly exampleOutput?: 'expect' | 'answer';


  /**
   * The node is a composite of widgets (`config.gui_widgets`): drawn with them
   * on the canvas, and generated widget by widget.
   */
  readonly holdsWidgets: boolean = false;

  /**
   * The dialog is laid out as the four steps of building the node -- what
   * comes in, what comes out, what it should do, and how, tried right there --
   * with the ports inside those steps rather than in a list of their own. For
   * the nodes whose body is written against its ports -- ai and code -- and
   * for a data node, whose format is written against what it takes and hands on.
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

  /** What step 2's words mean for this kind of node, said above them: who reads them, and when. */
  readonly outputFormatHint?: string;

  /** What this node emits, in one line, for its neighbours' generation context. */
  describeOutput?(node: GraphNode): string;

  /**
   * The format in words that ✨ is told this node's *own* body must return.
   * The node's declared output by default; a node whose words describe
   * something else -- an input's old "what these files contain", which is what
   * its files hold and not what its selector returns -- says nothing here.
   */
  outputFormatFor(node: GraphNode): string {
    return outputFormatText(node.config);
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
   * The description a saved node publishes (interface.json's "about", the
   * comment in flow.js). Where the dialog asks what the node should do in a
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
