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
// What travels forward is each node's output definition: a node is written
// whole -- its input.js, its output.js, its body -- before the next one is
// started, and the next one's input definition is written from what the node
// wired into it defines (`generationContext.inputSources`).
//
// Only nodes are written. A block on a page has no body: it shows or hands on
// what it holds.

import { memoryFeedbackEdges, topologicalLevels } from '@engine/execution/executor.ts';
import { registry } from '@engine/elements/registry.ts';
import type { GraphEdge, GraphNode } from '@/graph';
import { NODE_BUILDERS } from '@/elements/registry';

/** What happened to one node. */
type SweepStatus =
  /** Written. */
  | 'generated'
  /** Nothing to generate here — an output node, a page, a node already written. */
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
 * One node's writing, already assembled by the caller: what ✨ writes of it,
 * through the same request a button sends, each file written in as it comes.
 */
export interface SweepUnit {
  guard?: () => string | undefined;
  write: () => Promise<void>;
}

interface SweepDeps {
  /** The unit for this node, or undefined when it has nothing to write. */
  unitFor: (node: GraphNode) => SweepUnit | undefined;
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
  const feedback = memoryFeedbackEdges(nodes, edges, registry);
  return topologicalLevels(nodes, edges, feedback).flat()
    .map((id) => byId.get(id))
    .filter((node): node is GraphNode => node !== undefined);
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
export async function* sweep(
  nodes: GraphNode[],
  edges: GraphEdge[],
  deps: SweepDeps,
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
      await unit.write();
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
 * it has to have something real to read: a default file or folder, which the
 * nodes after it are then shown. Without one, the first generation is written
 * against nothing and the mistake is carried the whole way down. Saying so
 * before ten model calls start is cheaper than reading it in the results.
 */
export function missingExamples(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const fed = new Set(edges.map((edge) => edge.target_node_id));
  // Which nodes are sources, and what describes them, is each element's answer
  // (`NodeGuiBuilder.missingExample`): an input listing a folder, a page's file picker.
  return nodes.filter((node) => NODE_BUILDERS[node.node_type]?.missingExample(node, fed.has(node.id)) ?? false);
}
