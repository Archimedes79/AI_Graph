// Pure grid-layout resolution for the GUI runtime window and the GUI designer.
// Presentational only: never touches ports, wiring, or execution.
import type { GuiWidget } from '../../types/graph';

// Fallback background column count for graphs saved before gui_grid_columns
// existed on NodeConfig (see baseNodeConfig.ts). Row height is fixed and not
// user-configurable -- only the column count varies per node.
export const GUI_GRID_COLUMNS = 12;
export const GUI_GRID_ROW_HEIGHT = 56;

/** Cell footprint a widget gets when the designer has not sized it yet. */
const DEFAULT_SPAN: Record<GuiWidget['size'], { w: number; h: number }> = {
  small: { w: 4, h: 2 },
  medium: { w: 6, h: 3 },
  large: { w: 12, h: 5 },
};

export interface WidgetPlacement {
  widget: GuiWidget;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function defaultSpan(widget: GuiWidget): { w: number; h: number } {
  return DEFAULT_SPAN[widget.size] ?? DEFAULT_SPAN.medium;
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
    const span = defaultSpan(widget);
    const w = clamp(Math.round(widget.w ?? span.w), 1, columns);
    const h = Math.max(1, Math.round(widget.h ?? span.h));
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
