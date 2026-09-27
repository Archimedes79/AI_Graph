// What the engine's tests stand a run on when the world it runs in is not
// what they are about.
//
// Beside `src`, not in it: a deploy bundle and the downloadable package copy
// every file of `engine/src` that is not a test, and a helper for tests that
// sat there would ship with them. Nothing here is a test of its own either --
// vitest only runs `*.test.ts` -- so it is imported, and that is all.
import type { Graph, GraphEdge, GraphNode } from '../src/graph.ts';
import type { Runtime } from '../src/elements/Runtime.ts';

/**
 * A runtime with no world attached: an empty disk on which every path is
 * there (`exists`) and reads as nothing, a body that hands back what it was
 * given, and a model that says nothing.
 *
 * *over* replaces what a test is about, member by member -- and inside
 * `files` file operation by file operation, so a disk on which nothing exists
 * is `{ files: { exists: async () => false } }`. Each call is a new object.
 */
export function quietRuntime(over: Partial<Omit<Runtime, 'files'>> & { files?: Partial<Runtime['files']> } = {}): Runtime {
  const { files, ...rest } = over;
  return {
    files: {
      read: async () => '', write: async () => {}, list: async () => [], resolve: (path) => path, exists: async () => true,
      ...files,
    },
    code: { run: async (_body, inputs) => inputs },
    ai: { complete: async () => '' },
    ...rest,
  };
}

/** A wire from port *fromPort* of node *from* to port *toPort* of node *to*. */
export function edge(id: string, from: string, fromPort: string, to: string, toPort: string): GraphEdge {
  return { id, source_node_id: from, source_port_id: fromPort, target_node_id: to, target_port_id: toPort };
}

/** *nodes* and *edges* as a graph with the settings a new one has. */
export function graphOf(nodes: GraphNode[], edges: GraphEdge[] = []): Graph {
  return {
    metadata: { name: 't', description: '', ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night' },
    nodes, edges,
  };
}
