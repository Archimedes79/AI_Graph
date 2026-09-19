// Where a graph inside a node meets the node that holds it.
//
// Nothing is invented for the edge of a subgraph: its input nodes are the
// holding node's inputs, its output nodes are its outputs. The same graph run
// on its own asks a person for those inputs and reports those outputs, which
// is the point -- a subgraph is an ordinary graph, and this file is only the
// dictionary between the two views of it.
//
// The ids are the inner nodes' ids, so a port keeps its identity while its name
// is edited: renaming a boundary node changes what the port is *called* and
// never which edges lead to it.

import type { Graph, GraphNode, Port } from '../../../graph.ts';
import { port } from '../../port.ts';
import { InputNodeElement } from '../input/InputNodeElement.ts';
import { valuePorts } from '../output/OutputNodeElement.ts';

/** Asked rather than read: the mode is the input element's field, not ours. */
const INPUT = new InputNodeElement();

/**
 * The inner nodes that stand for values handed in from outside.
 *
 * Text mode only. A file or directory input node is a node that *reads*
 * something, not a value that arrives: to say from outside which file it
 * should read, wire a port to its `path` input, exactly as one graph's
 * nodes do to each other.
 */
export function boundaryInputs(graph: Graph): GraphNode[] {
  return graph.nodes.filter((node) => node.node_type === 'input' && INPUT.config(node).mode === 'text');
}

/** The inner nodes that stand for values handed back out. */
export function boundaryOutputs(graph: Graph): GraphNode[] {
  return graph.nodes.filter((node) => node.node_type === 'output');
}

/** What an output node hands up: the one thing wired into it, never the path it writes to. */
export function handedUp(node: GraphNode, arrived: Record<string, unknown>): unknown {
  const wanted = valuePorts(node)[0]?.id;
  // Explicitly null rather than missing: a node that produced nothing must
  // still fill its port, or `reconcileOutputs` reads the empty record as the
  // single output it was supposed to be.
  return wanted ? arrived[wanted] ?? null : null;
}

/** The holding node's ports, as the graph inside it describes them. */
export function boundaryPorts(graph: Graph): { inputs: Port[]; outputs: Port[] } {
  // `any` throughout: of the data types only `file_path` means anything to the
  // engine, and it would mean the wrong thing here -- a path that crosses this
  // boundary is a path, not a file to read on the way in.
  const named = (node: GraphNode): string => node.label || node.id;
  return {
    inputs: boundaryInputs(graph).map((node) => port(node.id, named(node), 'input', 'any', false, node.description)),
    // A list in there is a list out here: what an output node collects is what
    // its port says it collects, and a port that lied about it would stop the
    // node after this one from fanning out over what it is handed.
    outputs: boundaryOutputs(graph).map((node) =>
      port(node.id, named(node), 'output', 'any', valuePorts(node)[0]?.multi === true, node.description)),
  };
}
