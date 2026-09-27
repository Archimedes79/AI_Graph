import { describe, it, expect } from 'vitest';
import type { GuiWidget } from '@/graph';
import { DEFAULT_WIDGET_SPAN, GUI_GAP, GUI_GRID_COLUMNS, GUI_MAX_CELL, GUI_MAX_WIDTH, blockSize, cellSize, cellsFromDrag, resolveWidgetLayout } from './layout';

function widget(id: string, w?: number, h?: number): GuiWidget {
  return { id, kind: 'text_io', label: id, w: w as number, h: h as number } as GuiWidget;
}

describe('resolveWidgetLayout', () => {
  it('keeps list order, because the order is the position', () => {
    const widgets = [widget('a'), widget('b'), widget('c')];
    expect(resolveWidgetLayout(widgets).map((p) => p.widget.id)).toEqual(['a', 'b', 'c']);
  });

  it('computes no coordinates at all — CSS grid places and wraps the blocks', () => {
    const [placement] = resolveWidgetLayout([widget('a', 4, 2)]);
    expect(placement).toEqual({ widget: placement.widget, w: 4, h: 2 });
    expect('x' in placement).toBe(false);
    expect('y' in placement).toBe(false);
  });

  it('clamps a span to the grid instead of letting a block overflow the page', () => {
    const [wide] = resolveWidgetLayout([widget('a', 99, 3)]);
    expect(wide.w).toBe(GUI_GRID_COLUMNS);
    const [thin] = resolveWidgetLayout([widget('b', 0, 0)]);
    expect(thin.w).toBe(1);
    expect(thin.h).toBe(1);
  });

  it('falls back to the default span for a widget that has none', () => {
    const [placement] = resolveWidgetLayout([{ id: 'a', kind: 'text_io' } as GuiWidget]);
    expect(placement.w).toBeGreaterThan(0);
    expect(placement.h).toBeGreaterThan(0);
  });
});

describe('cellSize', () => {
  it('is square and capped, so a wide screen does not inflate the page', () => {
    expect(cellSize(4000)).toBe(GUI_MAX_CELL);
    expect(GUI_MAX_WIDTH).toBe(GUI_GRID_COLUMNS * GUI_MAX_CELL + (GUI_GRID_COLUMNS - 1) * GUI_GAP);
  });

  it('shrinks with a narrow container, so the same page just gets smaller', () => {
    const narrow = cellSize(400);
    expect(narrow).toBeLessThan(GUI_MAX_CELL);
    expect(narrow).toBeGreaterThan(0);
    // 16 cells plus their gaps still fit the container they were measured for.
    expect(narrow * GUI_GRID_COLUMNS + (GUI_GRID_COLUMNS - 1) * GUI_GAP).toBeLessThanOrEqual(400.001);
  });

  it('never returns something unusable for a container with no width yet', () => {
    expect(cellSize(0)).toBeGreaterThan(0);
  });
});

describe('blockSize', () => {
  it('is its cells and the gaps between them, at the page\'s full width', () => {
    expect(blockSize(widget('a', 16, 9))).toEqual({ w: 16, h: 9, width: 1106, height: 616 });
    // A block across the whole page is the page's whole width.
    expect(blockSize(widget('a', GUI_GRID_COLUMNS, 1)).width).toBe(GUI_MAX_WIDTH);
    // One cell has no gap inside it.
    expect(blockSize(widget('a', 1, 1))).toEqual({ w: 1, h: 1, width: GUI_MAX_CELL, height: GUI_MAX_CELL });
  });

  it('is the default span for a block with no size of its own, and the grid\'s clamp for one too wide', () => {
    expect(blockSize({ id: 'a', kind: 'plot_window' } as GuiWidget))
      .toEqual(blockSize(widget('b', DEFAULT_WIDGET_SPAN.w, DEFAULT_WIDGET_SPAN.h)));
    expect(blockSize(widget('a', 99, 2)).w).toBe(GUI_GRID_COLUMNS);
  });
});

describe('cellsFromDrag', () => {
  it('counts the gap as part of a cell of travel', () => {
    // The pitch of the grid is cell + gap. Measuring in bare cells is what made
    // a resize lag behind the pointer, and lag further the further you dragged.
    const cell = 35;
    expect(cellsFromDrag(cell + GUI_GAP, cell)).toBe(1);
    expect(cellsFromDrag(3 * (cell + GUI_GAP), cell)).toBe(3);
    expect(cellsFromDrag(5 * (cell + GUI_GAP), cell)).toBe(5);
  });

  it('rounds to the nearest cell, and counts backwards', () => {
    const cell = 56;
    expect(cellsFromDrag(0, cell)).toBe(0);
    expect(cellsFromDrag(30, cell)).toBe(0);
    expect(cellsFromDrag(-(2 * (cell + GUI_GAP)), cell)).toBe(-2);
  });
});
