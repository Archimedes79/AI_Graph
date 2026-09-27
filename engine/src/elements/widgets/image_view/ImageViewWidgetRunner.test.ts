import { describe, expect, it } from 'vitest';
import { imageMediaType } from '../../../execution/images.ts';
import { ImageViewWidgetRunner } from './ImageViewWidgetRunner.ts';
import { PlotWindowWidgetRunner } from '../plot_window/PlotWindowWidgetRunner.ts';
import { TableWidgetRunner } from '../table/TableWidgetRunner.ts';

describe('what a drawing block says it draws', () => {
  it('names only picture formats a run can read', () => {
    // The block's dialog said SVG as well, and a run refused an .svg path as
    // "Not a recognised image file".
    const named = new ImageViewWidgetRunner().draws().match(/([A-Za-z, ]+) are recognised/)![1]
      .split(/, | and /).map((format) => format.trim().toLowerCase());
    expect(named.length).toBeGreaterThan(0);
    for (const format of named) expect(imageMediaType(`picture.${format}`), format).not.toBeNull();
  });

  it('reads what arrives as a path in an image only', () => {
    expect(new ImageViewWidgetRunner().readsPaths).toBe(true);
    expect(new TableWidgetRunner().readsPaths).toBe(false);
    expect(new PlotWindowWidgetRunner().readsPaths).toBe(false);
  });
});
