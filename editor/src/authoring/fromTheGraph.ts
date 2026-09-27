// "⟳ From the graph": what really arrives at a node, or at a block on a page.

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
 *
 * *pick* turns what arrives on the node's ports into the example, or into
 * nothing when what is asked for did not arrive: every input, for a node; one
 * port, handed on as `{value}`, for a block on a page (`blockFromTheGraph`).
 * *what* is how the message names it: "this", "this block".
 */
export async function fromTheGraph(
  nodeId: string,
  executionResult: ExecutionResult | null,
  graph: () => Graph,
  pick: (inputs: Record<string, unknown>) => Record<string, unknown> | undefined = everyInput,
  what = 'this',
): Promise<{ values: Record<string, unknown>; said: string }> {
  const last = pick(lastRunInputs(nodeId, executionResult) ?? {});
  if (last) return { values: last, said: 'What arrived here on the last run.' };
  const got = await call('nodeInputs', { ...graph(), node_id: nodeId });
  if (got.error) throw new Error(`Upstream: ${got.error}`);
  const values = pick(got.inputs);
  if (!values) throw new Error(`Nothing is wired into ${what} yet, so the graph has nothing to deliver here.`);
  return { values, said: `What the nodes that feed ${what === 'this' ? 'this one' : what} delivered, run just now.` };
}
