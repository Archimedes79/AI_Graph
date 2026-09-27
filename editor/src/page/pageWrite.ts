// Changing the page: the one way a block is added, changed, moved or removed.
//
// The page is one node's list of blocks -- a graph has one page -- and every
// edit on it ends here.
//
// Each edit reads the page from the store when it lands, never from what a
// component drew. A box that grows as it is typed into changes its block twice
// in one keystroke -- the text, then the height -- and the second change,
// made on the page as it was drawn, put back the text from before the first:
// the character that made the box grow was lost. A ✨ result accepted a minute
// after it was asked for did the same to every edit made meanwhile.
//
// The designer's surface, its side panel, a block used on the page -- in the
// designer, the preview and a delivered tool alike (`usePageEvents`) -- and
// `masterExamples.test.ts`, which builds the examples the way a person does,
// all call these functions.
import type { GraphNode, GuiWidget } from '@/graph';
import { besideTheRest, useGraphStore } from '@/store/graphStore';
import { pageOf, syncGuiNodePorts } from '@/document/guiWidgets';

/** The page as the store holds it now. */
function pageNow(): GraphNode | undefined {
  return pageOf(useGraphStore.getState().rfNodes.map((n) => n.data.graphNode as GraphNode)).page;
}

/** *page* holding *widgets*, its ports following them. */
function withBlocks(page: GraphNode, widgets: GuiWidget[]): GraphNode {
  return syncGuiNodePorts({ ...page, config: { ...page.config, gui_widgets: widgets } });
}

/**
 * The page's blocks as the store holds them now, rewritten by *edit* and
 * stored back, its ports following. Nothing, when the edit changed nothing:
 * no undo step, and no "unsaved".
 *
 * A page is its blocks: the last one taken off takes the node with it, as the
 * first one made it. A page node left with none was a page to a delivered tool
 * and to a bundle, which drew nothing on it -- not even the run's result.
 */
function rewrite(edit: (widgets: GuiWidget[]) => GuiWidget[]): void {
  const page = pageNow();
  if (!page) return;
  const widgets = edit(page.config.gui_widgets);
  if (JSON.stringify(widgets) === JSON.stringify(page.config.gui_widgets)) return;
  const store = useGraphStore.getState();
  if (widgets.length) store.updateNode(page.id, withBlocks(page, widgets));
  else store.deleteNode(page.id);
}

/** Give block *widgetId* *patch*. Nothing, when the block is no longer there. */
export function patchBlock(widgetId: string, patch: Partial<GuiWidget>): void {
  rewrite((widgets) => widgets.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)));
}

/**
 * Put block *widgetId* at place *to* on the page -- or, *to* being a block's
 * id, where that block stands now, which is what a drag onto it means.
 * Nothing, for a place that is not there.
 */
export function moveBlock(widgetId: string, to: number | string): void {
  rewrite((widgets) => {
    const from = widgets.findIndex((w) => w.id === widgetId);
    const at = typeof to === 'string' ? widgets.findIndex((w) => w.id === to) : to;
    if (from === -1 || at < 0 || at >= widgets.length || from === at) return widgets;
    const next = [...widgets];
    const [moved] = next.splice(from, 1);
    next.splice(at, 0, moved);
    return next;
  });
}

/** Take block *widgetId* off the page. */
export function removeBlock(widgetId: string): void {
  rewrite((widgets) => widgets.filter((w) => w.id !== widgetId));
}

/**
 * Put *widget* on the page at place *at*, at the end without one -- the order
 * is the position. With no page in the graph yet, its first block makes it,
 * in the block's own undo step: the page is the thing being built, and that
 * it needs a node behind it is bookkeeping. The node goes beside what is on
 * the canvas, not on top of the first node there.
 */
export function insertBlock(widget: GuiWidget, at?: number): void {
  const store = useGraphStore.getState();
  if (!pageNow()) {
    store.addNode('gui', besideTheRest(store.rfNodes), (page) => withBlocks(page, [widget]));
    return;
  }
  rewrite((widgets) => {
    const next = [...widgets];
    next.splice(at ?? next.length, 0, widget);
    return next;
  });
}
