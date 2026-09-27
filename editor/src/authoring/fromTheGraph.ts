// "⟳ From the graph": what really arrives at a node.

import type { ExecutionResult, Graph, GraphNode } from '@/graph';
import { call } from '@/api/client';
import { lastRunInputs } from './generationContext';

/**
 * What arrives at *node*: what did on the last run, or -- before any run, or
 * for a node the last run did not reach -- what the nodes that feed it
 * deliver when they are run now (the node itself is not). *graph* is the
 * canvas with the node as the dialog holds it.
 */
export async function fromTheGraph(
  node: GraphNode,
  executionResult: ExecutionResult | null,
  graph: () => Graph,
): Promise<{ values: Record<string, unknown>; said: string }> {
  const last = lastRunInputs(node.id, executionResult);
  if (last) return { values: last, said: 'What arrived here on the last run.' };
  const got = await call('nodeInputs', { ...graph(), node_id: node.id });
  if (got.error) throw new Error(`Upstream: ${got.error}`);
  if (!Object.keys(got.inputs).length) throw new Error('Nothing is wired into this yet, so the graph has nothing to deliver here.');
  return { values: got.inputs, said: 'What the nodes that feed this one delivered, run just now.' };
}
