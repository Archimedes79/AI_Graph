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
import type { TryResult } from './TryItInline';
import { exampleObject } from './examplePair';
import { runAlone } from './readAsRun';

/**
 * Why step 1's example of a block cannot be used as it stands, or ''. Empty is
 * fine: it is what the block holds before anything has arrived, and a chart
 * draws that case too.
 */
export function exampleProblem(text: string | undefined): string {
  if (!String(text ?? '').trim() || exampleObject(text)) return '';
  return 'The example is not an object keyed by what arrives yet, like {"value": …}. It is kept as typed, but nothing can be tried on it.';
}

/**
 * What ▶ Try it would try now, as text (`TryItInline`'s `of`): the block --
 * which one, and what it runs -- and *example*, what it runs on. Not how it
 * looks, nor the request its code was written from.
 */
export function blockTryKey(widget: GuiWidget, example: Record<string, unknown> | undefined): string {
  const runs: Record<string, unknown> = { ...widget };
  for (const key of ['label', 'tone', 'border', 'background', 'w', 'h', 'example', 'code_prompt']) delete runs[key];
  return JSON.stringify([runs, example ?? null]);
}

/**
 * *widget* on a page of its own, run by itself -- nothing else of the graph is
 * sent or run: what the block hands on, made the way a run makes it. A folder
 * picker lists its folder and runs its selector here exactly as it does on the
 * page, through the same element.
 *
 * A failure is said, not caught: a block told to catch its failures put the
 * reason on its error port and handed on nothing, so a folder that does not
 * exist was listed as "0 files" and handed to ✨ as an empty listing. An input
 * node read for its example is read the same way (`readAsRun`).
 */
export async function runBlockAlone(widget: GuiWidget): Promise<TryResult> {
  const blank = NODE_KINDS.gui.create('page');
  const page = syncGuiNodePorts({ ...blank, config: { ...blank.config, gui_widgets: [{ ...widget, catch_errors: false }] } });
  const result = await runAlone(page);
  return { status: result.status, shown: result.outputs?.[`${widget.id}_out`], error: result.error, messages: result.messages };
}

/**
 * The block run by itself on step 1's *values*, the way a run runs it: what
 * arrives is drawn -- through its code -- by a block that shows, and a block
 * that is a source hands on what it holds.
 */
export function tryBlock(widget: GuiWidget, values: Record<string, unknown>): Promise<TryResult> {
  if (!guiWidgetPorts(widget).inputs.length) return runBlockAlone(widget);
  return call('runBlock', { widget, value: values.value ?? null });
}
