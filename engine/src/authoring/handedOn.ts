// What a graph carries when it leaves the person's project: to a deployed
// tool, to the page a served tool draws, in a run the editor posts, in an
// answer over MCP, and to a model asked to change the whole graph.
//
// A node keeps some things only for writing it: its history.md -- every
// prompt and reply, with the start of the files its author gave ✨ -- the ✨
// prompts it changed, and the files its ✨ Input and ✨ Output were given.
// Nothing a run reads is among them. They stay with the project, where they
// are the node's own record; a bundle carried up to half a
// megabyte of them per node, to whoever it was handed. What comes back from
// a change of the whole graph takes them from the graph that was sent
// (`generateGraph`), so leaving them out loses none of them.

import type { Graph } from '../graph.ts';
import type { Runners } from '../elements/NodeRunner.ts';
import { registry } from '../elements/registry.ts';

/** A node's settings that only writing it needs. */
export const AUTHORING_KEYS = ['history', 'prompts', 'input_files', 'output_files'] as const;

/** A copy of *graph* without what only writing it needs (`AUTHORING_KEYS`), in the graphs its nodes hold too. */
export function withoutAuthoring(graph: Graph, elements: Runners = registry): Graph {
  const copy = JSON.parse(JSON.stringify(graph)) as Graph;
  for (const node of copy.nodes) {
    const config = node.config as Record<string, unknown>;
    for (const key of AUTHORING_KEYS) delete config[key];
    const element = elements.node(node.node_type);
    const inside = element?.nestedGraph(node);
    if (inside) element!.setNestedGraph(node, withoutAuthoring(inside, elements));
  }
  return copy;
}
