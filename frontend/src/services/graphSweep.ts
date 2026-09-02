// Generating a whole graph, front to back.
//
// One ✨ button generates one element against whatever its neighbours happen to
// declare. That is fine for a node added to a working graph and useless for a
// graph that is empty: every node is generated against a guess, because the
// node it reads from has not been written yet.
//
// So the order matters, and it is the *execution* order — asked of the engine
// (`topologicalLevels`) rather than derived again here, so a graph is generated
// in the order it will run, including the memory-feedback rule that keeps
// `gui → ai → gui` from looking like a cycle.
//
// What travels forward is what the run produced: each node is generated, then
// actually run against its predecessor's data by the verify pass the backend
// already does, and what it returned becomes the contract the next node is
// generated against. A small local model guesses badly from a description and
// well from three lines of real data, and from the second node on there is real
// data to be had.

import { memoryFeedbackEdges, topologicalLevels } from '@engine/executor.ts';
import { registry } from '@engine/registry.ts';
import type { GraphEdge, GraphNode } from '../types/graph';

/** What happened to one node. */
export type SweepStatus =
  /** Written. */
  | 'generated'
  /** Nothing to generate here — an output node, a divider, a node already written. */
  | 'skipped'
  /** Could be generated, but something is missing: usually the request itself. */
  | 'blocked'
  /** The generation itself failed. The sweep stops here. */
  | 'failed';

export interface SweepStep {
  nodeId: string;
  label: string;
  status: SweepStatus;
  message: string;
}

/**
 * One node's generation, already assembled by the caller.
 *
 * The same three parts `useGenerate` runs for a single button — so a sweep and
 * a button generate through one code path, and a change to how a request is
 * built cannot apply to only one of them.
 */
export interface SweepUnit<T = unknown> {
  guard?: () => string | undefined;
  run: () => Promise<T>;
  apply: (result: T) => void;
}

export interface SweepDeps<T = unknown> {
  /** The unit for this node, or undefined when it generates nothing. */
  unitFor: (node: GraphNode) => SweepUnit<T> | undefined;
  /** Asked before each node, so a long sweep can be stopped from the toolbar. */
  stopped?: () => boolean;
}

/**
 * The nodes in the order they would run.
 *
 * Flattened: a stage's nodes are independent of each other, so any order within
 * one is as good as another, and a flat list is what a progress line shows.
 *
 * Throws on a cycle the memory rule cannot absolve — the engine's own refusal,
 * raised here rather than worked around. A graph that cannot run has no order to
 * generate in, and inventing one would write every node against a guess while
 * looking like it worked.
 */
export function generationOrder(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // The engine's own registry decides which nodes remember, exactly as it does
  // when the graph runs: a cycle closing into one of those is not a cycle.
  const feedback = memoryFeedbackEdges(nodes as never, edges as never, registry);
  const ordered: GraphNode[] = [];
  for (const level of topologicalLevels(nodes as never, edges as never, feedback)) {
    for (const id of level) {
      const node = byId.get(id);
      if (node) ordered.push(node);
    }
  }
  return ordered;
}

/**
 * Generate every node that has something to generate, in order.
 *
 * Yields one step per node so the caller can show progress as it happens rather
 * than a frozen button and a list at the end.
 *
 * A blocked node does not stop the sweep — a node with no request of its own may
 * still have a body that works, and the nodes after it are worth writing. A
 * *failed* one does stop it: everything downstream would be generated against a
 * contract that was never produced, which is a worse outcome than stopping with
 * half a graph written.
 */
export async function* sweep<T>(
  nodes: GraphNode[],
  edges: GraphEdge[],
  deps: SweepDeps<T>,
): AsyncGenerator<SweepStep> {
  for (const node of generationOrder(nodes, edges)) {
    if (deps.stopped?.()) return;

    const label = node.label || node.id;
    const unit = deps.unitFor(node);
    if (!unit) {
      yield { nodeId: node.id, label, status: 'skipped', message: 'nothing to generate' };
      continue;
    }

    const blocked = unit.guard?.();
    if (blocked) {
      yield { nodeId: node.id, label, status: 'blocked', message: blocked };
      continue;
    }

    try {
      const result = await unit.run();
      unit.apply(result);
      yield { nodeId: node.id, label, status: 'generated', message: 'written' };
    } catch (error) {
      yield {
        nodeId: node.id,
        label,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
      return;
    }
  }
}

/**
 * The nodes a sweep would have to guess at, before it starts.
 *
 * A node at the head of the graph has no predecessor to describe its data, so
 * it has to say what it holds: an attached sample (the strong form — the model
 * sees the real thing) or a stated contract (the weak one). With neither, the
 * first generation is written against nothing and the mistake is carried the
 * whole way down. Saying so before ten model calls start is cheaper than
 * reading it in the results.
 */
export function missingExamples(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const fed = new Set(edges.map((edge) => edge.target_node_id));
  return nodes.filter((node) => {
    if (fed.has(node.id)) return false;
    if (node.node_type !== 'input') return false;
    const mode = String(node.config.input_mode ?? 'text');
    if (mode === 'text') return false;                 // its value IS the example
    return !String(node.config.example_file ?? '').trim()
      && !String(node.config.output_format_prompt ?? '').trim();
  });
}
