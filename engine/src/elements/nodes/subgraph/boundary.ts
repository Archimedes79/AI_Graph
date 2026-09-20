// Where a graph inside a node meets the node that holds it.
//
// Nothing is invented for the edge of a subgraph: the nodes that stand at the
// edge of *any* graph are its edge here too. Which nodes those are is the
// elements' own answer (`NodeRunner.boundaryRole`), so this file names no
// node type and holds no second copy of anyone's settings.
//
// The ids are the inner nodes' ids, so a port keeps its identity while its name
// is edited: renaming a boundary node changes what the port is *called* and
// never which edges lead to it.

import type { Graph, GraphNode, Port } from '../../../graph.ts';
import type { NodeRunner } from '../../NodeRunner.ts';
import { port } from '../../port.ts';

/** The one question this file asks about a node, asked of whoever owns it. */
export interface Runners {
  node(type: string): NodeRunner<unknown> | undefined;
}

const withRole = (graph: Graph, elements: Runners, role: 'in' | 'out'): GraphNode[] =>
  graph.nodes.filter((node) => elements.node(node.node_type)?.boundaryRole(node) === role);

/**
 * The inner nodes that stand for values handed in from outside.
 *
 * A file or directory input node is not one: it is a node that *reads*
 * something. To say from outside which file it should read, wire a port to its
 * `path` input, exactly as one graph's nodes do to each other.
 */
export function boundaryInputs(graph: Graph, elements: Runners): GraphNode[] {
  return withRole(graph, elements, 'in');
}

/** The inner nodes that stand for values handed back out. */
export function boundaryOutputs(graph: Graph, elements: Runners): GraphNode[] {
  return withRole(graph, elements, 'out');
}

/**
 * What a boundary node hands up: the one thing wired into it.
 *
 * `path` is left out -- on an output node it says where to write, not what.
 */
export function handedUp(node: GraphNode, arrived: Record<string, unknown>): unknown {
  const wanted = valuePorts(node)[0]?.id;
  // Explicitly null rather than missing: a node that produced nothing must
  // still fill its port, or `reconcileOutputs` reads the empty record as the
  // single output it was supposed to be.
  return wanted ? arrived[wanted] ?? null : null;
}

/** The inputs of a boundary node that carry a value, in the order it declares them. */
export function valuePorts(node: GraphNode): Port[] {
  return node.inputs.filter((candidate) => candidate.id !== WRITE_PATH_PORT);
}

/** The input that says *where* to write rather than *what*. */
const WRITE_PATH_PORT = 'path';

/** The holding node's ports, as the graph inside it describes them. */
export function boundaryPorts(graph: Graph, elements: Runners): { inputs: Port[]; outputs: Port[] } {
  // `any` throughout: of the data types only `file_path` means anything to the
  // engine, and it would mean the wrong thing here -- a path that crosses this
  // boundary is a path, not a file to read on the way in.
  const named = (node: GraphNode): string => node.label || node.id;
  return {
    inputs: boundaryInputs(graph, elements)
      .map((node) => port(node.id, named(node), 'input', 'any', false, node.description)),
    // A list in there is a list out here: what an output node collects is what
    // its port says it collects, and a port that lied about it would stop the
    // node after this one from fanning out over what it is handed.
    outputs: boundaryOutputs(graph, elements)
      .map((node) => port(node.id, named(node), 'output', 'any', valuePorts(node)[0]?.multi === true, node.description)),
  };
}
