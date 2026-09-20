// A node: the element branch that sits on the canvas and runs in the graph.

import type { Graph, GraphNode, NodeType, Port } from '../graph.ts';
import type { RuntimeRequirement } from '../execution/runtimeValues.ts';
import type { Schema } from '../execution/interface.ts';
import type { Problem } from '../execution/wiring.ts';
import { Element } from './Element.ts';
import type { Runtime } from './Runtime.ts';

/**
 * The elements, as anything that derives ports may need to ask about them: a
 * node holding a graph has to know which nodes inside it stand at its edge.
 * The registry answers this; so does a test with two elements in a map.
 */
export interface Elements {
  node(type: string): NodeElement<unknown> | undefined;
}

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
  derivedPorts(_node: GraphNode, _elements: Elements): { inputs: Port[]; outputs: Port[] } | null {
    return null;
  }

  /**
   * The graph this node holds, or null for a node that holds none.
   *
   * The one question asked about hierarchy, and it is asked of the element so
   * that nothing else has to know which node type holds a graph. The project
   * folder recurses on it, `check` descends on it, a bundle follows it, and the
   * editor opens what it returns. A node that answers with a graph is a node
   * whose folder is a project folder of its own.
   */
  nestedGraph(_node: GraphNode): Graph | null {
    return null;
  }

  /**
   * Put a graph read from its own folder back into this node, or `null` to
   * take it out because it lives in a file now.
   *
   * The other half of `nestedGraph`: the element owns where it keeps it, the
   * project folder only says what it found.
   */
  setNestedGraph(_node: GraphNode, _graph: Graph | null): void {}

  /**
   * What is wrong with this node that only this element can say.
   *
   * `check` finds what any node can get wrong -- an edge to a port that is not
   * there, a cycle, an interface naming a lost output. What is *this kind of
   * node's* own contract belongs here, in the file that defines it: a node
   * holding a graph knows what may and may not stand at that graph's edge, and
   * the project checker should not have to.
   *
   * Nothing recursive: `check` walks the graphs, this speaks about one node.
   */
  problems(_node: GraphNode, _elements: Elements, _where: string): Problem[] {
    return [];
  }

  /**
   * Whether this node is where its graph meets whatever holds it: `'in'` for a
   * value handed down, `'out'` for one handed back up.
   *
   * What makes an input node a port of the node above is the input node's own
   * business -- it depends on its mode -- so it is answered here rather than
   * guessed from a node type somewhere else. A graph run on its own has the
   * same two ends: they are what a person is asked for and what they are
   * shown.
   */
  boundaryRole(_node: GraphNode): 'in' | 'out' | null {
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
  /**
   * The output ports of this node that can start a round: a button, a chat's
   * send, a block told that using it starts the graph, a trigger.
   *
   * The executor asks so it can say which of them *did*, this round
   * (`Runtime.fired`), and read a wire from one into a node's ◆ as open or
   * closed. Most nodes start nothing.
   */
  eventPorts(_node: GraphNode): string[] {
    return [];
  }

  /**
   * Whether this node asks whoever holds the graph to keep a clock for it.
   * A graph inside a node has nobody to ask: only the outermost one is held.
   */
  keepsTime(_node: GraphNode): boolean {
    return false;
  }

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

  /** Running this node asks a model: its examples are skipped by an offline `test`. */
  readonly asksModel: boolean = false;

  /**
   * What this node's outputs are held to, once someone has kept one: see
   * `execution/interface.ts`. None by default -- a model's answer is described
   * to the model instead (an AI node's `output.md`), not checked afterwards.
   */
  outputInterface(_node: GraphNode): Schema | undefined {
    return undefined;
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
