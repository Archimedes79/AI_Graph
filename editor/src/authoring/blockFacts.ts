// What ✨ Generate is told about a block on a page: the mirror of `nodeFacts`.

import type { ExecutionResult, GraphNode, GuiWidget } from '@/graph';
import { guiWidgetPorts } from '@/document/guiWidgets';
import { describeScheme } from '@/ui/scheme';
import type { GenerationRequest } from './generation';
import { inputOrigins, lastRunWidgetInput } from './generationContext';

type Wire = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };

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
 */
export function blockFacts(
  nodeId: string,
  widget: GuiWidget,
  nodes: GraphNode[],
  edges: Wire[],
  executionResult: ExecutionResult | null,
  scheme: string | undefined,
): Pick<GenerationRequest<GuiWidget>, 'exampleFile' | 'graphContext' | 'sampleInputs' | 'sampleOrigin'> {
  const example = blockExample(widget);
  const observed = lastRunWidgetInput(nodeId, widget.id, executionResult);
  const sample = example ? { values: example, origin: 'the example in step 1' }
    : observed ? { values: observed, origin: 'the last run' } : undefined;
  const port = guiWidgetPorts(widget).inputs[0]?.id;
  const feeds = port ? inputOrigins(nodeId, nodes, edges)[port] : undefined;
  return {
    // A file attached by an older version of the block editor, while there is
    // no example to have taken it in yet: see step 1's "Use the example file from before".
    exampleFile: example ? undefined : String(widget.example_file ?? '').trim() || undefined,
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
