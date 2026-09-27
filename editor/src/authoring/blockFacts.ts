// What ✨ Generate is told about a block on a page: the mirror of `nodeFacts`.
// And what the graph around the block says it is handed: its step 1.

import type { ExecutionResult, Graph, GraphNode, GuiWidget, Wire } from '@/graph';
import { guiWidgetPorts } from '@/document/guiWidgets';
import { describeScheme } from '@/ui/scheme';
import type { GenerationRequest } from './generation';
import { inputSources, lastRunInputs } from './generationContext';
import { fromTheGraph } from './fromTheGraph';
import { exampleObject } from './examplePair';

/** What is wired into the block, in words -- `"Rows" (port "rows")` -- or '' while nothing is. */
export function blockFeeds(nodeId: string, widget: GuiWidget, nodes: GraphNode[], edges: Wire[]): string {
  const port = guiWidgetPorts(widget).inputs[0]?.id;
  return (port && inputSources(nodeId, nodes, edges)[port]) || '';
}

/**
 * What arrived at the page *on its ports*, as the block's code is handed it:
 * `{value: …}` from the block's own input port, or undefined while nothing
 * arrived there -- whatever arrived for the page's other blocks.
 */
function blockInput(widget: GuiWidget, inputs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const port = guiWidgetPorts(widget).inputs[0]?.id;
  const arrived = port ? inputs?.[port] : undefined;
  return arrived === undefined ? undefined : { value: arrived };
}

/**
 * ⟳ From the graph, for a block: what arrived at it on the last run, or --
 * before any run, or when the last run did not reach it -- what the nodes
 * that feed its page deliver when they are run now. *graph* is the canvas as
 * it stands; the page itself is not run.
 */
export function blockFromTheGraph(
  nodeId: string,
  widget: GuiWidget,
  executionResult: ExecutionResult | null,
  graph: () => Graph,
): Promise<{ values: Record<string, unknown>; said: string }> {
  return fromTheGraph(nodeId, executionResult, graph, (inputs) => blockInput(widget, inputs), 'this block');
}

/**
 * A block's example input as it is kept (`example`, the text of step 1): an
 * object keyed by the port its code is handed, `{"value": …}` -- or undefined
 * while it is empty, or is not one yet.
 */
export function blockExample(widget: GuiWidget): Record<string, unknown> | undefined {
  return exampleObject(widget.example);
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
  const observed = blockInput(widget, lastRunInputs(nodeId, executionResult));
  const sample = example ? { values: example, origin: 'the example in step 1' }
    : observed ? { values: observed, origin: 'the last run' } : undefined;
  const port = guiWidgetPorts(widget).inputs[0]?.id;
  const feeds = port ? inputSources(nodeId, nodes, edges, true)[port] : undefined;
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
