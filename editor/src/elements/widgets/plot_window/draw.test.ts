import { describe, it, expect } from 'vitest';
import { draw, type DrawWindow } from './draw';

/**
 * Running a chart's body where the chart is drawn.
 *
 * jsdom has no `Worker`, which is the case this file can cover honestly: a
 * chart with no body, and a chart in a browser too old or a test too small to
 * run one, must still draw *something* rather than nothing. The worker path
 * itself is exercised in a real browser, where it belongs — see the end-to-end
 * run in the session notes.
 */
const WINDOW: DrawWindow = { width: 640, height: 360, scheme: 'night', dark: true };

describe('drawing a chart', () => {
  it('shows what arrived when there is no body: an empty box is not a transform', () => {
    // The commonest chart of all -- points wired straight in, nothing written.
    return expect(draw('', [1, 2, 3], WINDOW)).resolves.toEqual({ value: [1, 2, 3] });
  });

  it('shows what arrived when a body cannot be run here', async () => {
    // No Worker in jsdom. A chart that went blank in a browser without one
    // would be a chart that went blank for no reason the person can see.
    expect(typeof Worker).toBe('undefined');
    await expect(draw('function draw(d) { return []; }', [4], WINDOW)).resolves.toEqual({ value: [4] });
  });

  it('never rejects: a chart that cannot be drawn is a message, not a failure', async () => {
    // Whatever happens in here must not reach the page around it. A display
    // block's failure has always been cosmetic, and moving where the body runs
    // does not change who pays for it.
    await expect(draw('this is not javascript', null, WINDOW)).resolves.toBeTruthy();
  });
});
