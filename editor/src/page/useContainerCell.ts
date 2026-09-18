import { useEffect, useRef, useState } from 'react';
import { cellSize, GUI_MAX_CELL } from './layout';

/**
 * The current square-cell size for whatever element this ref is on.
 *
 * The cell is `contentWidth / 16`, capped — so the same page renders identically
 * in the editor panel, the runtime window and a deployed bundle, only smaller.
 * That needs the real width, which only the browser knows, hence the observer.
 *
 * One hook for both surfaces: the designer and the runtime window must never
 * disagree about how big a cell is, or designing would stop predicting running.
 */
export function useContainerCell() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [cell, setCell] = useState(GUI_MAX_CELL);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setCell(cellSize(node.clientWidth));
    update();
    // ResizeObserver rather than a window listener: the panel resizes when the
    // node is resized or a sidebar opens, without the window changing at all.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, cell };
}
