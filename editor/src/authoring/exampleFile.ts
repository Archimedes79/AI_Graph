// The files a node's input definition is written from.
//
// ✨ Input is shown the start of real files -- examples, a spec -- and writes
// the general format of what arrives, and one small example of it, from them:
// so a CSV node's input.js says the columns the file has, not ones a model
// imagined. They are the node's own `input_files` when someone gave it some
// (📂, a drop, ⟳), and otherwise the one the graph hands a file-reading input
// of the node: what the last run brought there, or what the node wired to it
// holds -- a picked file, a typed path.

import type { ExecutionResult, Graph, GraphNode, Wire } from '@/graph';
import { call } from '@/api/client';
import { NODE_BUILDERS } from '@/elements/registry';
import { filesOf } from '@/document/givenFiles';
import { lastRunInputs, readFilePorts } from './generationContext';

/** A path in *value*: a text, or the first text of a list. */
function firstPath(value: unknown): string | undefined {
  const one = Array.isArray(value) ? value.find((item) => typeof item === 'string' && item.trim()) : value;
  return typeof one === 'string' && one.trim() ? one.trim() : undefined;
}

/** The file the graph hands one of *node*'s file-reading inputs, without running anything -- or undefined. */
function graphFileOf(node: GraphNode, nodes: GraphNode[], edges: Wire[], result: ExecutionResult | null): string | undefined {
  const ports = readFilePorts(node);
  const last = lastRunInputs(node.id, result);
  for (const port of ports) {
    const path = firstPath(last?.[port]);
    if (path) return path;
  }
  for (const port of ports) {
    for (const edge of edges) {
      if (edge.target !== node.id || edge.targetHandle !== port || !edge.sourceHandle) continue;
      const source = nodes.find((candidate) => candidate.id === edge.source);
      const path = source && firstPath(NODE_BUILDERS[source.node_type]?.restingValue(source, edge.sourceHandle));
      if (path) return path;
    }
  }
  return undefined;
}

/** The files ✨ Input writes from: the node's own, else the one the graph hands it. */
export function inputFilesOf(node: GraphNode, nodes: GraphNode[], edges: Wire[], result: ExecutionResult | null): string[] {
  const own = filesOf(node, 'input');
  if (own.length) return own;
  const graphs = graphFileOf(node, nodes, edges, result);
  return graphs ? [graphs] : [];
}

/**
 * "⟳ From the graph": the file the graph hands one of *node*'s file-reading
 * inputs -- without running anything where it can say, and otherwise what the
 * nodes that feed it deliver when they are run now (the node itself is not).
 * *graph* is the canvas as the dialog asking holds it.
 */
export async function fileFromTheGraph(
  node: GraphNode, nodes: GraphNode[], edges: Wire[], result: ExecutionResult | null, graph: () => Graph,
): Promise<string | undefined> {
  const known = graphFileOf(node, nodes, edges, result);
  const ports = readFilePorts(node);
  if (known || !ports.length) return known;
  const got = await call('nodeInputs', { ...graph(), node_id: node.id });
  if (got.error) throw new Error(`What feeds it failed: ${got.error}`);
  for (const port of ports) {
    const path = firstPath(got.inputs[port]);
    if (path) return path;
  }
  return undefined;
}
