// Pure grid-layout resolution for the GUI runtime window and the GUI designer.
// Presentational only: never touches ports, wiring, or execution.
import type { GuiWidget } from '../../types/graph';

// Fallback background column count for graphs saved before gui_grid_columns
// existed on NodeConfig (see baseNodeConfig.ts). Row height is fixed and not
// user-configurable -- only the column count varies per node.
export const GUI_GRID_COLUMNS = 12;
export const GUI_GRID_ROW_HEIGHT = 56;

/**
 * Cell footprint for a widget size. The single source of truth: `createGuiWidget`
 * and the size dropdown stamp these onto new/resized widgets (via `sizeToGrid` in
 * utils/guiWidgets.ts, which re-exports this), and `defaultSpan` below uses the
 * same table for widgets the designer never placed. Two tables lived here before
 * and disagreed on three of six numbers, so the same "medium" widget rendered at
 * a different height depending on whether it had ever been sized.
 */
export const SIZE_SPAN: Record<GuiWidget['size'], { w: number; h: number }> = {
  small: { w: 3, h: 2 },
  medium: { w: 6, h: 4 },
  large: { w: 12, h: 6 },
};

export function sizeToGrid(size: GuiWidget['size']): { w: number; h: number } {
  return SIZE_SPAN[size] ?? SIZE_SPAN.medium;
}

export interface WidgetPlacement {
  widget: GuiWidget;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function defaultSpan(widget: GuiWidget): { w: number; h: number } {
  return sizeToGrid(widget.size);
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
