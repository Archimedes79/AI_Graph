// A node: the element branch that sits on the canvas and runs in the graph.

import type { GraphNode, NodeType, Port } from '../graph.ts';
import type { RuntimeRequirement } from '../execution/runtimeValues.ts';
import { Element } from './Element.ts';
import type { Runtime } from './Runtime.ts';

export abstract class NodeElement<C = unknown> extends Element<GraphNode, C> {
  abstract readonly nodeType: NodeType;

  /**
   * The ports this node has, *when they follow from its settings*.
   *
   * Two kinds of node, and the difference is worth naming. An input node's
   * ports follow from its mode — text has one output, a folder has `files` and
   * `count` — and a gui node's follow from its blocks. Nobody names those, and
   * a copy of them in the editor is a copy that can disagree with what the
   * element emits, which is exactly how an input node came to emit `output`
   * where its ports said `files`.
   *
   * A code, AI, data or output node is the other kind: a person names its ports
   * to match the code they wrote or the prompt they gave. `count_per_file` has
   * an input called `file`; `total` produces `bla_count` and `summary`. Those
   * are the graph's, not the element's, and returning null says so — the test
   * that checks declarations against real graphs is what made the distinction
   * visible in the first place.
   */
  derivedPorts(_node: GraphNode): { inputs: Port[]; outputs: Port[] } | null {
    return null;
  }

  /**
   * This node keeps its value between runs, so an edge into it can close a
   * cycle: the executor leaves such an edge out of the ordering and settles the
   * fresh value afterwards, for the *next* round.
   */
  readonly isMemory: boolean = false;

  /**
   * A memory node that keeps whatever is delivered to it, loop or no loop. A
   * data node is one: "remember this" does not depend on the edge closing a
   * cycle. A page is not -- what it is *shown* is not what it *holds*.
   */
  readonly settlesOnArrival: boolean = false;

  /**
   * Whether this node works *on* what is wired into it, so that a round in
   * which every wire came up empty is a round with nothing to do. An ai node
   * does: its inputs are the question. A code node does not -- "no file chosen
   * yet" is a case its body may well want to draw.
   */
  needsInput(_node: GraphNode): boolean {
    return false;
  }

  /** This node carries the graph's interface. */
  readonly hasInterface: boolean = false;

  /**
   * What this node shows, per block id, given everything that arrived.
   *
   * Asked by the executor once the round has settled, so values that came back
   * around a loop are here too. Only a node with an interface answers.
   */
  async display(
    _node: GraphNode,
    _arrived: Record<string, unknown>,
    _runtime: Runtime,
  ): Promise<Record<string, unknown>> {
    return {};
  }

  /**
   * Whether this node runs once for the whole list or once per item.
   *
   * A declaration, not an implementation: the fan-out itself belongs to the
   * executor, so "run this once per element" works the same for a code node and
   * an AI node and would work for a third kind without either being told. Both
   * used to carry their own copy of the loop, and the copies had begun to
   * differ in what an empty list meant.
   */
  batchMode(node: GraphNode): 'whole' | 'per_item' {
    return node.config.batch_mode === 'per_item' ? 'per_item' : 'whole';
  }

  /** How many items of a fan-out may be in flight at once. */
  batchConcurrency(node: GraphNode): number {
    return Number(node.config.batch_concurrency ?? 0) || 4;
  }

  /**
   * Whether a wired file path should arrive as the file's *content*.
   *
   * Declared, like batching, and carried out by the executor: a code node and
   * an AI node both want it and neither should own it. It lived inside the code
   * element for a while, which is why an AI node summarising a folder was
   * handed three filenames and dutifully summarised those.
   */
  readsFileInputs(node: GraphNode): boolean {
    return node.config.read_file_inputs === true;
  }

  /** Run once, for inputs already collected from the wires. */
  abstract execute(
    node: GraphNode,
    inputs: Record<string, unknown>,
    runtime: Runtime,
  ): Promise<Record<string, unknown>>;

  /**
   * Store a value that arrived on *portId* as this node's remembered state.
   * Only meaningful when `isMemory`; where it goes differs per element, which
   * is why the executor asks instead of branching on the node type.
   */
  settleMemory(_node: GraphNode, _portId: string, _value: unknown): void {}

  /**
   * What this node needs a person to supply before the graph can run.
   *
   * Asked of the element rather than looked up by node type, so a new element
   * that prompts says so in its own file — and the editor's dialog, a
   * terminal's prompts and a bundle's `--inputs` all read the same list.
   */
  runtimeRequirements(_node: GraphNode): RuntimeRequirement[] {
    return [];
  }

  /**
   * Files and folders this node names as its own defaults: the CSV a picker
   * starts on, the folder an input node reads.
   *
   * A bundle carries them. A tool handed to someone with its default file left
   * behind opens on an error, and the person it was handed to has no way to
   * know which file on someone else's machine it wanted.
   */
  referencedPaths(_node: GraphNode): string[] {
    return [];
  }

  /** Put one supplied value where this element keeps it. */
  applyRuntimeValue(_node: GraphNode, _widgetId: string | null, _value: string): void {}
}
