import { NodeElement } from '../../NodeElement.ts';
import type { TextFile } from '../../Element.ts';
import { type Runtime } from '../../Runtime.ts';
import { parseGraph, type Graph, type GraphNode } from '../../../graph.ts';
import { port } from '../../port.ts';
import { boundaryInputs, boundaryOutputs, boundaryPorts, handedUp } from './boundary.ts';

export interface SubgraphConfig {
  /** The graph this node holds. An empty one for a node nobody has filled in yet. */
  graph: Graph | null;
  /** What it is meant to do, for a person and for the day an AI fills it in. */
  task: string;
}

/** What this keeps in files of its own in a project folder: see `Element.texts`. */
const SUBGRAPH_TEXTS: readonly TextFile[] = [
  { field: 'task', file: 'task.md' },
];

/**
 * A node that holds a graph.
 *
 * **A subgraph is an ordinary graph**, and almost nothing here exists to make
 * that true -- the same `executeGraph` runs it, the same project folder stores
 * it, the same `check` checks it, the same editor edits it. What is left for
 * this file is the dictionary at the boundary: which values arrive on which
 * inner node, and which inner node's value leaves by which port. That is
 * `boundary.ts`, and it is twenty lines.
 *
 * Two consequences worth stating, because both are asked about:
 *
 * - An input node inside that nothing is wired to still uses its own value.
 *   That is not a special case for subgraphs; it is what an input node with
 *   nothing wired into it has always done.
 * - The graph inside can be run, checked and deployed on its own -- its folder
 *   is a project folder like any other. A subgraph that only works while
 *   enclosed would be a second kind of graph, and there is only one kind.
 */
export class SubgraphNodeElement extends NodeElement<SubgraphConfig> {
  readonly nodeType = 'subgraph' as const;

  override texts(): readonly TextFile[] {
    return SUBGRAPH_TEXTS;
  }

  config(node: GraphNode): SubgraphConfig {
    return { graph: readGraph(node.config.subgraph), task: String(node.config.task ?? '') };
  }

  /**
   * A copy, always. The executor may run this node several times at once (a
   * per-item fan-out is one node object and many calls), and a run that
   * settled memory or answered an input node inside a shared graph would be
   * two runs writing over each other -- and would write into what the editor
   * holds and the folder saves, besides.
   */
  override nestedGraph(node: GraphNode): Graph | null {
    return readGraph(node.config.subgraph);
  }

  override derivedPorts(node: GraphNode) {
    const graph = this.nestedGraph(node);
    // Not readable as a graph: no ports rather than an exception. `check` is
    // where an unreadable graph is reported; a node drawn on a canvas is not.
    if (!graph) return { inputs: [], outputs: [] };
    const ports = boundaryPorts(graph);
    if (!this.catchesErrors(node)) return ports;
    return {
      inputs: ports.inputs,
      outputs: [...ports.outputs, port('error', 'Error', 'output', 'text', false, 'Set when the graph inside failed')],
    };
  }

  /** A path that arrives here is a path: what to do with it is the inner graph's business. */
  override readsFileInputs(): boolean {
    return false;
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const graph = this.nestedGraph(node);
    if (!graph) throw new Error('This node holds no graph that can be read.');
    if (!runtime.subgraph) throw new Error('A graph inside a node can only be run by the engine that runs graphs.');

    // The graph this node sits in has already had its AI default applied to
    // the runtime; the inner graph's own default would otherwise override it
    // from below, which is backwards -- a graph pasted in as a subgraph should
    // follow the tool it became part of.
    graph.metadata.ai_defaults = { provider: 'default', model: '' };

    const given: Record<string, Record<string, unknown>> = {};
    for (const boundary of boundaryInputs(graph)) {
      // A port nothing is wired to is not answered, and the node inside runs
      // as it is configured.
      if (!(boundary.id in inputs)) continue;
      given[boundary.id] = { output: inputs[boundary.id] };
    }

    const run = await runtime.subgraph.run(graph, given);
    // Any failure inside is this node's failure -- `error` is set exactly when
    // a node in there failed or could not run because of one. A run that ended
    // half-done would hand nulls out of ports that nobody could explain, and
    // the reason would stay in a report nobody is looking at.
    if (run.error) throw new Error(`Inside "${node.label || node.id}": ${run.error}`);

    const produced: Record<string, unknown> = {};
    for (const boundary of boundaryOutputs(graph)) {
      const arrived = run.node_results.find((result) => result.node_id === boundary.id)?.inputs ?? {};
      produced[boundary.id] = handedUp(boundary, arrived);
    }
    return produced;
  }
}

/** The stored graph, or null when there is nothing readable there. */
function readGraph(stored: unknown): Graph | null {
  if (!stored || typeof stored !== 'object') return null;
  try {
    return parseGraph(structuredClone(stored));
  } catch {
    return null;
  }
}
