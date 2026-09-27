// `flow.json`: which nodes a graph has, and every wire -- nothing about any node.
//
//     {
//       "name": "Population plotter",
//       "nodes": { "page": "gui", "chart": "code" },
//       "wires": [
//         "page.file_out -> chart.csv",
//         "chart.figure -> page.plot_in"
//       ]
//     }
//
// The one file that says how a graph runs, read in one glance. Everything a
// node is -- its name, its settings, its ports -- is in its own folder, and a
// graph is put together here from the two: the flow, and what each node's
// folder says. No file system: `folder.ts` reads the files, and so can a test
// or a page that already has their contents.

import { parseGraph, type Graph, type GraphEdge, type GraphMetadata } from '../graph.ts';
import { registry } from '../elements/registry.ts';
import { NotAGraph } from '../errors.ts';
import { interfaceFrom } from './interfaceFile.ts';

export const FLOW_FILE = 'flow.json';

/** A wire, as the flow writes it: `from.port -> to.port`. It is also the edge's id. */
export function wireOf(edge: GraphEdge): string {
  return `${edge.source_node_id}.${edge.source_port_id} -> ${edge.target_node_id}.${edge.target_port_id}`;
}

function edgeOf(wire: unknown, path: string): GraphEdge {
  const text = String(wire);
  const sides = text.split('->').map((side) => side.trim());
  const end = (side: string | undefined): [string, string] | null => {
    const dot = side ? side.indexOf('.') : -1;
    return side && dot > 0 && dot < side.length - 1 ? [side.slice(0, dot), side.slice(dot + 1)] : null;
  };
  const from = end(sides[0]);
  const to = end(sides[1]);
  if (sides.length !== 2 || !from || !to) {
    throw new NotAGraph(`${path}: "${text}" is not a wire. Write it as "node.port -> node.port".`);
  }
  const edge = { id: '', source_node_id: from[0], source_port_id: from[1], target_node_id: to[0], target_port_id: to[1] };
  return { ...edge, id: wireOf(edge) };
}

/** Keys in one order, so saving an unchanged graph changes nothing. */
function sorted<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]])) as T;
}

/** The graph's settings, with every one still at its default left out: the flow says what is particular. */
function particular(metadata: GraphMetadata): Record<string, unknown> {
  const plain = parseGraph({ nodes: [], edges: [] }).metadata as unknown as Record<string, unknown>;
  const given = metadata as unknown as Record<string, unknown>;
  const { name, description, ...rest } = given;
  const differs = (key: string): boolean => JSON.stringify(given[key]) !== JSON.stringify(plain[key]);
  return {
    name,
    ...(description ? { description } : {}),
    ...sorted(Object.fromEntries(Object.keys(rest).filter(differs).map((key) => [key, rest[key]]))),
  };
}

/** What `flow.json` says for *graph*. */
export function flowOf(graph: Graph): Record<string, unknown> {
  for (const node of graph.nodes) {
    if (node.id.includes('.')) {
      throw new NotAGraph(`The node id "${node.id}" has a "." in it, so a wire could not say where the node ends and its port begins. Rename it.`);
    }
  }
  return {
    ...particular(graph.metadata),
    nodes: Object.fromEntries(graph.nodes.map((node) => [node.id, node.node_type])),
    wires: graph.edges.map(wireOf),
  };
}

/** What one node's folder says: its `node.json` and its `interface.json`, as parsed JSON, either missing. */
export interface NodeFiles {
  about?: unknown;
  ports?: unknown;
}

/**
 * The graph a flow and its nodes' folders describe -- without the writing
 * (code, prompts), which is in files of its own and read in afterwards.
 *
 * *filesOf* answers for each node the flow lists; *path* names the flow in a
 * message about what is wrong with it.
 */
export function graphFrom(flow: unknown, filesOf: (id: string) => NodeFiles, path: string): Graph {
  const given = (flow ?? {}) as Record<string, unknown>;
  const listed = given.nodes;
  if (!listed || typeof listed !== 'object' || Array.isArray(listed)) {
    throw new NotAGraph(`${path} is not a flow: "nodes" must say each node's type by its id, { "count": "code" }.`);
  }
  const { nodes: _nodes, wires = [], ...metadata } = given;
  if (!Array.isArray(wires)) throw new NotAGraph(`${path}: "wires" must be a list, one "node.port -> node.port" each.`);

  const kept = new Map<string, unknown>();
  const nodes = Object.entries(listed as Record<string, unknown>).map(([id, type]) => {
    const { about, ports } = filesOf(id);
    const node = (about ?? {}) as Record<string, unknown>;
    const faces = interfaceFrom(ports, `${path}: node "${id}", interface.json`);
    if (faces.outputSchema !== undefined) kept.set(id, faces.outputSchema);
    return {
      id, node_type: String(type), label: node.label, description: node.description,
      config: node.config, inputs: faces.inputs, outputs: faces.outputs,
    };
  });

  let graph: Graph;
  try {
    graph = parseGraph({ metadata, nodes, edges: wires.map((wire) => edgeOf(wire, path)) });
  } catch (error) {
    if (error instanceof NotAGraph) throw error;
    throw new NotAGraph(`${path} is not a graph: ${(error as Error).message}`);
  }
  for (const node of graph.nodes) {
    if (kept.has(node.id)) registry.node(node.node_type)?.setOutputInterface(node, kept.get(node.id));
  }
  return graph;
}
