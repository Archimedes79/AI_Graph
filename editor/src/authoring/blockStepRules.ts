// What the four steps decide for a block on a page, apart from drawing them:
// the mirror of `nodeStepRules.ts`.
//
// Kept apart from the panels so that what a click does is one function, asked
// the same way by the block editor, by ✨ and by the tests. It reads no
// element registry, so a block's own builder may ask it (see `outputFormat.ts`).

import type { GuiWidget } from '@/graph';
import { call } from '@/api/client';
import { NODE_KINDS } from '@/document/nodeKinds';
import { guiWidgetPorts, syncGuiNodePorts } from '@/document/guiWidgets';
import { useGraphStore } from '@/store/graphStore';
import type { TryResult } from './TryItInline';

/**
 * Why step 1's example of a block cannot be used as it stands, or ''. Empty is
 * fine: it is what the block holds before anything has arrived, and a chart
 * draws that case too.
 */
export function exampleProblem(text: string | undefined): string {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';
  try {
    const value = JSON.parse(trimmed);
    if (value && typeof value === 'object' && !Array.isArray(value)) return '';
  } catch {
    // Said below, the same as a value that parses to something else.
  }
  return 'The example is not an object keyed by what arrives yet, like {"value": …}. It is kept as typed, but nothing can be tried on it.';
}

/**
 * *widget* on a page of its own, run by itself -- nothing else of the graph is
 * sent or run: what the block hands on, made the way a run makes it. A folder
 * picker lists its folder and runs its selector here exactly as it does on the
 * page, through the same element.
 */
export async function runBlockAlone(widget: GuiWidget): Promise<TryResult> {
  const blank = NODE_KINDS.gui.create('page');
  const page = syncGuiNodePorts({ ...blank, config: { ...blank.config, gui_widgets: [widget] } });
  const graph = { metadata: useGraphStore.getState().metadata, nodes: [page], edges: [] };
  const result = await call('runNode', { ...graph, node_id: page.id, inputs: {} });
  return { status: result.status, shown: result.outputs?.[`${widget.id}_out`], error: result.error, messages: result.messages };
}

/**
 * The block run by itself on step 1's *values*, the way a run runs it: what
 * arrives is drawn -- through its code -- by a block that shows, and a block
 * that is a source hands on what it holds. With the graph's metadata, as a
 * run has it: code that asks a model asks the graph's, not the machine's.
 */
export function tryBlock(widget: GuiWidget, values: Record<string, unknown>): Promise<TryResult> {
  if (!guiWidgetPorts(widget).inputs.length) return runBlockAlone(widget);
  return call('runBlock', { widget, value: values.value ?? null, metadata: useGraphStore.getState().metadata });
}
