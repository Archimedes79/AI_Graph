import { describe, it, expect } from 'vitest';
import { resolveWidgetLayout } from './layout';
import { createGuiWidget } from '../../utils/guiWidgets';

describe('resolveWidgetLayout', () => {
  it('stacks unplaced widgets in list order', () => {
    const a = createGuiWidget('file_open', 'A');
    const b = createGuiWidget('text_window', 'B');

    const placements = resolveWidgetLayout([a, b]);

    expect(placements.map((p) => p.widget.id)).toEqual([a.id, b.id]);
    expect(placements[0].y).toBe(0);
    expect(placements[1].y).toBe(placements[0].h);
    expect(placements.every((p) => p.x === 0)).toBe(true);
  });

  it('honors designer coordinates and orders by row then column', () => {
    const a = { ...createGuiWidget('file_open', 'A'), x: 6, y: 2, w: 6, h: 2 };
    const b = { ...createGuiWidget('text_window', 'B'), x: 0, y: 2, w: 6, h: 2 };

    const placements = resolveWidgetLayout([a, b]);

    expect(placements.map((p) => p.widget.id)).toEqual([b.id, a.id]);
    expect(placements.map((p) => [p.x, p.y, p.w, p.h])).toEqual([[0, 2, 6, 2], [6, 2, 6, 2]]);
  });

  it('flows unplaced widgets below placed ones and clamps to the grid', () => {
    const placed = { ...createGuiWidget('plot_window', 'P'), x: 20, y: 0, w: 20, h: 3 };
    const unplaced = createGuiWidget('text_window', 'U');

    const placements = resolveWidgetLayout([placed, unplaced]);

    expect(placements[0]).toMatchObject({ x: 0, y: 0, w: 12 });
    expect(placements[1].y).toBe(3);
  });
});
