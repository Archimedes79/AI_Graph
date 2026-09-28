/** A box on screen, in pixels: where it starts and how big it is. */
interface Box { x: number; y: number; width: number; height: number }

/**
 * What the view still owes the canvas: a fit of the whole graph, and a node
 * to bring into sight -- each done once the canvas is on screen and what it
 * is about is drawn and measured.
 */
export interface ViewDue {
  /** The document it was last told of (`graphStore.document`), its node count, and the node whose panel was open. */
  document: number;
  count: number;
  open: string | null;
  fit: boolean;
  show: string | null;
  /** *show* is a node just added: the graph is shown whole where it fits readably (`READABLE_ZOOM`). */
  added: boolean;
}

/**
 * The least zoom the whole graph is shown at when a node is added. Brought
 * into sight alone, the new node pushed the first ones out of it -- the data
 * node under the palette after a code node and a page card were added.
 */
export const READABLE_ZOOM = 0.6;

/**
 * *due* after the canvas changed to *now*. Another graph -- New, Open, a
 * level in or out -- is fitted whole: the view the last one was left at put a
 * new node at x -100 and a page card off the screen. One node more -- from the
 * palette, or the page a first block made while the canvas was hidden -- is
 * brought into sight, and so is a node whose panel opens, which narrows the
 * canvas under it.
 */
export function viewDue(due: ViewDue, now: { document: number; ids: string[]; open: string | null }): ViewDue {
  if (now.document !== due.document) return { document: now.document, count: now.ids.length, open: now.open, fit: true, show: null, added: false };
  let { show, added } = due;
  if (now.ids.length === due.count + 1) {
    show = now.ids[now.ids.length - 1];
    added = true;
  }
  if (now.open && now.open !== due.open && now.open !== show) {
    show = now.open;
    added = false;
  }
  return { ...due, count: now.ids.length, open: now.open, show, added };
}

/** Whether every one of *boxes* is in *view*, *margin* from its edges: nothing to move for. */
export function allInView(boxes: Box[], view: Box, margin = 24): boolean {
  return boxes.every((box) => {
    const { dx, dy } = panToShow(box, view, margin);
    return !dx && !dy;
  });
}

/**
 * How far to move the canvas so *node* is in *view*, *margin* from its edges
 * -- by as little as that takes, and not at all when it already is. When the
 * node is bigger than the view, its top left corner is what is shown.
 *
 * A node clicked near the right edge was covered by its own panel the moment
 * the panel opened beside it: the canvas got narrower under it.
 */
export function panToShow(node: Box, view: Box, margin = 24): { dx: number; dy: number } {
  const along = (start: number, size: number, from: number, room: number): number => {
    const low = from + margin;
    const high = from + room - margin;
    if (start + size > high) return Math.max(high - (start + size), low - start);
    if (start < low) return low - start;
    return 0;
  };
  return {
    dx: along(node.x, node.width, view.x, view.width),
    dy: along(node.y, node.height, view.y, view.height),
  };
}
