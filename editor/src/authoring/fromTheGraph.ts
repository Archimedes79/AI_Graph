// "⟳ From the graph": what really arrives at a node.

import type { ExecutionResult, Graph } from '@/graph';
import { call } from '@/api/client';
import { lastRunInputs } from './generationContext';

/** A node's inputs as its example: all of them, or nothing while none arrived. */
const everyInput = (inputs: Record<string, unknown>): Record<string, unknown> | undefined =>
  (Object.keys(inputs).length ? inputs : undefined);

/**
 * What arrives at the node *nodeId*: what did on the last run, or -- before
 * any run, or for a node the last run did not reach -- what the nodes that
 * feed it deliver when they are run now (the node itself is not). *graph* is
 * the canvas as the dialog asking holds it.
 */
export async function fromTheGraph(
  nodeId: string,
  executionResult: ExecutionResult | null,
  graph: () => Graph,
): Promise<{ values: Record<string, unknown>; said: string }> {
  const last = everyInput(lastRunInputs(nodeId, executionResult) ?? {});
  if (last) return { values: last, said: 'What arrived here on the last run.' };
  const got = await call('nodeInputs', { ...graph(), node_id: nodeId });
  if (got.error) throw new Error(`Upstream: ${got.error}`);
  const values = everyInput(got.inputs);
  if (!values) throw new Error('Nothing is wired into this yet, so the graph has nothing to deliver here.');
  return { values, said: 'What the nodes that feed this one delivered, run just now.' };
}
