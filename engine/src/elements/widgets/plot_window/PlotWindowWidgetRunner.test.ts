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

    /** The wrapped body, run the way the sandbox runs one: `run(inputs, node)`, with a node that could ask a model. */
    const probe = (body: string, value: unknown) => new Function(`${probeWith(body)}\nreturn run({ value: ${JSON.stringify(value)} }, { llm: async () => 'asked' });`)() as Promise<unknown>;

    it('calls a body that still defines run() as the page does: with the value and a window, never the node', async () => {
      // Every chart written before draw() defines `run`, and the page calls it
      // `run({ value }, window)`. Left as it was, the probe handed it a node
      // that could ask a model, and a body asking `node.llm` passed here and
      // failed on every page.
      await expect(probe('function run(inputs, window) { return { value: [inputs.value, window.width > 0] }; }', 3))
        .resolves.toEqual({ value: [3, true] });
      await expect(probe('const run = (inputs) => ({ value: inputs.value });', [4])).resolves.toEqual({ value: [4] });
      await expect(probe('async function run(inputs, node) { return { value: await node.llm({ prompt: "x" }) }; }', 1))
        .rejects.toThrow(/node\.llm is not a function/);
    });

    it('has no require, as a worker has none', async () => {
      await expect(probe('function draw() { return [require("node:fs") ? 1 : 0]; }', null)).rejects.toThrow(/require is not a function/);
    });

    it('says so when the body defines neither function', async () => {
      await expect(probe('const points = [1];', null)).rejects.toThrow(/defines neither draw\(data, window\) nor run\(inputs\)/);
    });

    it('unwraps either shape a draw may answer with', async () => {
      // `draw` may return the value, or `{ value }` as a transform did.
      await expect(probe('function draw(d) { return [1]; }', null)).resolves.toEqual({ value: [1] });
      await expect(probe('function draw(d) { return { value: [2] }; }', null)).resolves.toEqual({ value: [2] });
      await expect(probe('function draw(d) { return { kind: "line", title: "T", points: [3] }; }', null))
        .resolves.toEqual({ value: { kind: 'line', title: 'T', points: [3] } });
    });
  });

  it('never asks a bundle for a model: its body runs in the page, which has none to ask', () => {
    const asking = { id: 'c', kind: 'plot_window', label: '', w: 8, h: 4, tone: 'plain', config: { code: 'async function run(i, node) { return node.llm({}); }' } } as const;
    expect(element.deployNeeds(asking as never).asksAi).toBe(false);
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

    it('is the whole frame the body is written in: the function, and a worker with neither Node nor a model', () => {
      // The generator puts it where the function goes, in place of a node's
      // run(inputs) skeleton and Node's rules, which contradicted it.
      expect(contract).toMatch(/^Complete this function\. Keep its name and its two parameters/);
      expect(contract).toContain('function draw(data, window) {');
      expect(contract).toContain('no `require`');
      expect(contract).toContain('no `node.llm`');
    });
  });
});
