// The page a gui node draws, as a document rather than a canvas.
//
// Widgets used to carry `x`/`y` on a 12-column grid and be dragged into place.
// Free positioning needs a designer's eye; a document flow is decent by default,
// which is why a LaTeX file looks better than a hand-arranged slide. So the
// **order of the widget list is the position** — blocks flow left to right and
// wrap, exactly as text does in a browser — and the only thing anyone sets is
// how large a block is, in cells.
//
// The grid underneath is still a grid: 16 square cells across a capped content
// width, with fixed gaps. It is a substrate, not a control panel. Nobody
// configures it, which is what makes it impossible to configure badly.
//
// Presentational only: never touches ports, wiring, or execution.
import type { GuiWidget } from '../../types/graph';

/** Cells across the page. Square, so `w` and `h` are one unit, not two. */
export const GUI_GRID_COLUMNS = 16;

/**
 * The widest a cell is allowed to get.
 *
 * Without a cap, a square cell on a 4K monitor would be ~250px and every block
 * would inflate with the window. A capped cell means the page has a maximum
 * width and centres, with margins growing instead — a printed page, and the
 * reason a text column stays readable.
 */
export const GUI_MAX_CELL = 56;

/**
 * The gap between blocks, in pixels. One value, everywhere.
 *
 * Equal in both directions on purpose: the cell is square, and a row gap that
 * differed from the column gap would quietly make a 4x4 block non-square. A
 * document needs more air than a dashboard, hence 14 rather than the 8 this
 * started at -- and where a *section* should end, that is what the `spacer`
 * block is for, not a bigger uniform gap.
 */
export const GUI_GAP = 14;

/** The widest the content column ever gets: 16 cells plus their gaps. */
export const GUI_MAX_WIDTH = GUI_GRID_COLUMNS * GUI_MAX_CELL + (GUI_GRID_COLUMNS - 1) * GUI_GAP;

/** Cells a widget occupies when it has none of its own yet. */
export const DEFAULT_WIDGET_SPAN = { w: 8, h: 4 };

export interface WidgetPlacement {
  widget: GuiWidget;
  /** Columns spanned, 1..GUI_GRID_COLUMNS. */
  w: number;
  /** Rows spanned, at least 1. */
  h: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Every widget with a usable span, in list order.
 *
 * No positions are computed: CSS grid places and wraps the blocks itself, which
 * is both less code here and the same algorithm a browser uses for everything
 * else on a page.
 */
export function resolveWidgetLayout(widgets: GuiWidget[]): WidgetPlacement[] {
  return widgets.map((widget) => ({
    widget,
    w: clamp(Math.round(widget.w ?? DEFAULT_WIDGET_SPAN.w), 1, GUI_GRID_COLUMNS),
    h: Math.max(1, Math.round(widget.h ?? DEFAULT_WIDGET_SPAN.h)),
  }));
}

/**
 * The side of one square cell for a container of *containerWidth* pixels.
 *
 * Below the capped width the cells shrink with the container, so the same page
 * looks identical in the editor panel, the runtime window and a deployed
 * bundle — only smaller.
 */
export function cellSize(containerWidth: number): number {
  const usable = Math.max(0, Math.min(containerWidth, GUI_MAX_WIDTH));
  const cell = (usable - (GUI_GRID_COLUMNS - 1) * GUI_GAP) / GUI_GRID_COLUMNS;
  return Math.max(8, Math.min(GUI_MAX_CELL, cell));
}

/** The grid style shared by the designer and the runtime window. */
export function gridStyle(cell: number): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${GUI_GRID_COLUMNS}, 1fr)`,
    gridAutoRows: `${cell}px`,
    gap: GUI_GAP,
    maxWidth: GUI_MAX_WIDTH,
    margin: '0 auto',
  };
}

/** Where one block sits in that grid. Span only — the browser decides the rest. */
export function blockStyle(placement: WidgetPlacement): React.CSSProperties {
  return {
    gridColumn: `span ${placement.w}`,
    gridRow: `span ${placement.h}`,
    minWidth: 0,
    minHeight: 0,
  };
}
