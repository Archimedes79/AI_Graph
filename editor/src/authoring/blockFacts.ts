// What ✨ Generate is told about a block on a page: the mirror of `nodeFacts`.
// And what the graph around the block says it is handed: its step 1.

import type { ExecutionResult, Graph, GraphNode, GuiWidget, Wire } from '@/graph';
import { call } from '@/api/client';
import { guiWidgetPorts } from '@/document/guiWidgets';
import { describeScheme } from '@/ui/scheme';
import type { GenerationRequest } from './generation';
import { inputOrigins, inputSources, lastRunWidgetInput } from './generationContext';

/** What is wired into the block, in words -- `"Rows" (port "rows")` -- or '' while nothing is. */
export function blockFeeds(nodeId: string, widget: GuiWidget, nodes: GraphNode[], edges: Wire[]): string {
  const port = guiWidgetPorts(widget).inputs[0]?.id;
  return (port && inputSources(nodeId, nodes, edges)[port]) || '';
}

/**
 * ⟳ From the graph, for a block: what arrived at it on the last run, or --
 * before any run, or when the last run did not reach it -- what the nodes
 * that feed its page deliver when they are run now. *graph* is the canvas as
 * it stands; the page itself is not run.
 */
export async function blockFromTheGraph(
  nodeId: string,
  widget: GuiWidget,
  executionResult: ExecutionResult | null,
  graph: () => Graph,
): Promise<{ values: Record<string, unknown>; said: string }> {
  const last = lastRunWidgetInput(nodeId, widget.id, executionResult);
  if (last) return { values: last, said: 'What arrived here on the last run.' };
  const port = guiWidgetPorts(widget).inputs[0]?.id;
  const got = await call('nodeInputs', { ...graph(), node_id: nodeId });
  if (got.error) throw new Error(`Upstream: ${got.error}`);
  const arrived = port ? got.inputs[port] : undefined;
  if (arrived === undefined) throw new Error('Nothing is wired into this block yet, so the graph has nothing to deliver here.');
  return { values: { value: arrived }, said: 'What the nodes that feed this block delivered, run just now.' };
}

/**
 * A block's example input as it is kept (`example`, the text of step 1): an
 * object keyed by the port its code is handed, `{"value": …}` -- or undefined
 * while it is empty, or is not one yet.
 */
export function blockExample(widget: GuiWidget): Record<string, unknown> | undefined {
  const text = String(widget.example ?? '').trim();
  if (!text) return undefined;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Everything a block on the page *nodeId* says that ✨ writes its code from,
 * beside its own request -- asked the same way by the block's ✨ button, by
 * "what ✨ sends" and by the graph sweep, so that none of them tells the model
 * less than the others. The sweep told a chart nothing of the page's scheme,
 * and no caller said where the sample came from, so a value typed to try a
 * block on was sent as "the last run".
 *
 *     what feeds it   the node wired into the block, and what that node says
 *                     it hands on -- in the context, because the engine
 *                     leaves the wiring out for code whose ports the
 *                     element fixes
 *     the sample      step 1's example; else what arrived on the last run
 *     the page        its colour scheme, which the code cannot see
 *
 * An example file the 📎 of an older version attached is not a second sample
 * beside these, as it is not for a node (`nodeFacts`): it was only ever pasted
 * into the prompt as text, never tried the code on. Step 1 offers to take it
 * in as the example, and then it is both.
 */
export function blockFacts(
  nodeId: string,
  widget: GuiWidget,
  nodes: GraphNode[],
  edges: Wire[],
  executionResult: ExecutionResult | null,
  scheme: string | undefined,
): Pick<GenerationRequest<GuiWidget>, 'graphContext' | 'sampleInputs' | 'sampleOrigin'> {
  const example = blockExample(widget);
  const observed = lastRunWidgetInput(nodeId, widget.id, executionResult);
  const sample = example ? { values: example, origin: 'the example in step 1' }
    : observed ? { values: observed, origin: 'the last run' } : undefined;
  const port = guiWidgetPorts(widget).inputs[0]?.id;
  const feeds = port ? inputOrigins(nodeId, nodes, edges)[port] : undefined;
  return {
    graphContext: [
      feeds ? `What arrives at this block -- its "value" -- comes from ${feeds}.` : '',
      // What a block shows is seen on this page, in this scheme -- and the
      // model writing it cannot see either. Said, not enforced: see `describeScheme`.
      describeScheme(scheme),
    ].filter(Boolean).join('\n\n'),
    sampleInputs: sample?.values,
    sampleOrigin: sample?.origin,
  };
}
