import { describe, it, expect } from 'vitest';
import { PlotWindowWidgetRunner } from './PlotWindowWidgetRunner.ts';

/**
 * A chart is the one block a run does not draw.
 *
 * Its body is run by the page, on every redraw, because what it needs -- the
 * block's size and the page's colour scheme -- exists there and nowhere else.
 * Two things follow, and both are easy to break from the engine side without
 * noticing, because the drawing itself is a browser away.
 */
const element = new PlotWindowWidgetRunner();

describe('a chart, from the engine', () => {
  it('says the page runs its body, so a run hands the page what arrived', () => {
    expect(element.bodyDrawsOnThePage).toBe(true);
  });

  describe('the body as the probe must run it', () => {
    const probeWith = element.generation().probeWith!;

    it('wraps a draw() into the run() the sandbox calls', () => {
      const wrapped = probeWith('function draw(data, window) { return [1, 2, 3]; }');
      expect(wrapped).toContain('function run(inputs)');
      expect(wrapped).toContain('draw(inputs.value, window)');
      // A window of some plausible size, since there is no block to measure.
      expect(wrapped).toMatch(/width: \d+/);
      expect(wrapped).toMatch(/height: \d+/);
    });

    it('leaves a body that still defines run() exactly as it is', () => {
      // Every chart written before this one defines `run`. A wrapper appended
      // to it would declare a second `run` and quietly win.
      const old = 'function run(inputs) { return { value: inputs.value }; }';
      expect(probeWith(old)).toBe(old);
      const assigned = 'const run = (inputs) => ({ value: inputs.value });';
      expect(probeWith(assigned)).toBe(assigned);
    });

    it('unwraps either shape a draw may answer with', () => {
      // `draw` may return the value, or `{ value }` as a transform did.
      const bare = new Function(`${probeWith('function draw(d) { return [1]; }')}\nreturn run({ value: null });`)();
      expect(bare).toEqual({ value: [1] });
      const wrapped = new Function(`${probeWith('function draw(d) { return { value: [2] }; }')}\nreturn run({ value: null });`)();
      expect(wrapped).toEqual({ value: [2] });
    });
  });

  describe('what the contract asks for', () => {
    const contract = element.generation().contract ?? '';

    it('asks for draw(data, window) and says what window holds', () => {
      expect(contract).toContain('draw(data, window)');
      for (const field of ['width', 'height', 'scheme', 'dark']) expect(contract).toContain(field);
    });

    it('asks the body to draw the empty case, because that is the same function', () => {
      expect(contract).toMatch(/null before anything has/);
    });

    it('no longer teaches a fixed frame, which was only ever a way round not knowing', () => {
      expect(contract).not.toMatch(/viewBox="0 0 \d+ \d+"/);
    });
  });
});
