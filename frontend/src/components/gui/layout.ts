// Pure grid-layout resolution for the GUI runtime window and the GUI designer.
// Presentational only: never touches ports, wiring, or execution.
import type { GuiWidget } from '../../types/graph';

// Fallback background column count for graphs saved before gui_grid_columns
// existed on NodeConfig (see baseNodeConfig.ts). Row height is fixed and not
// user-configurable -- only the column count varies per node.
export const GUI_GRID_COLUMNS = 12;
export const GUI_GRID_ROW_HEIGHT = 56;

/**
 * Cells a widget occupies when it has no size of its own yet.
 *
 * There used to be a `size` preset (small/medium/large) mapped onto w/h, which
 * meant one widget could be described two ways and disagree. The preset is
 * gone; a widget is created at this footprint and resized by dragging it.
 */
export const DEFAULT_WIDGET_SPAN = { w: 6, h: 4 };

export interface WidgetPlacement {
  widget: GuiWidget;
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Resolve every widget to a concrete grid cell. Widgets carrying designer
 * coordinates (`x` and `y` both set) keep them; unplaced widgets are stacked
 * below in list order, so a graph built before the designer existed still
 * renders top-to-bottom exactly as its widget list reads.
 */
export function resolveWidgetLayout(widgets: GuiWidget[], columns: number = GUI_GRID_COLUMNS): WidgetPlacement[] {
  const placements: WidgetPlacement[] = [];
  let flowY = 0;

  for (const widget of widgets) {
    const w = clamp(Math.round(widget.w ?? DEFAULT_WIDGET_SPAN.w), 1, columns);
    const h = Math.max(1, Math.round(widget.h ?? DEFAULT_WIDGET_SPAN.h));
    const isPlaced = widget.x !== undefined && widget.y !== undefined;

    if (isPlaced) {
      const x = clamp(Math.round(widget.x as number), 0, columns - w);
      const y = Math.max(0, Math.round(widget.y as number));
      placements.push({ widget, x, y, w, h });
      flowY = Math.max(flowY, y + h);
    } else {
      placements.push({ widget, x: 0, y: flowY, w, h });
      flowY += h;
    }
  }

  return placements.sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

/** Total grid rows a layout occupies (minimum 1). */
export function layoutRowCount(placements: WidgetPlacement[]): number {
  return Math.max(1, ...placements.map((p) => p.y + p.h));
}
