/** A box on screen, in pixels: where it starts and how big it is. */
interface Box { x: number; y: number; width: number; height: number }

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
