import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Lifecycle, untilStopped } from './lifecycle.ts';

const wait = (ms: number) => new Promise((wake) => setTimeout(wake, ms));

describe('Lifecycle', () => {
  it('stops what it was given in the order it was started, waiting for each', async () => {
    const order: string[] = [];
    const lifecycle = new Lifecycle();
    lifecycle.own('clock', async () => { await wait(20); order.push('clock'); });
    lifecycle.own('runs', () => { order.push('runs'); });
    lifecycle.own('http', async () => { order.push('http'); });
    expect(lifecycle.stopping).toBe(false);
    expect(await lifecycle.shutdown()).toEqual([]);
    expect(order).toEqual(['clock', 'runs', 'http']);
    expect(lifecycle.stopping).toBe(true);
  });

  it('stops once, however often it is asked', async () => {
    let stops = 0;
    const lifecycle = new Lifecycle();
    lifecycle.own('runs', async () => { await wait(10); stops += 1; });
    await Promise.all([lifecycle.shutdown(), lifecycle.shutdown(), lifecycle.shutdown()]);
    await lifecycle.shutdown();
    expect(stops).toBe(1);
  });

  it('names what threw or hung, and still stops the rest', async () => {
    const stopped: string[] = [];
    const lifecycle = new Lifecycle();
    lifecycle.own('broken', () => { throw new Error('no'); });
    lifecycle.own('hung', () => new Promise(() => {}));
    lifecycle.own('http', () => { stopped.push('http'); });
    const began = Date.now();
    expect(await lifecycle.shutdown(80)).toEqual(['broken', 'hung']);
    expect(stopped).toEqual(['http']);
    expect(Date.now() - began).toBeLessThan(1000);
  });
});

describe('untilStopped', () => {
  it('waits for a signal, shuts down, and answers 0', async () => {
    const signals = new EventEmitter();
    const log: string[] = [];
    let shut = 0;
    const code = untilStopped(async () => { shut += 1; return []; }, { signals, force: () => {}, log: (line) => log.push(line) });
    await wait(10);
    expect(shut).toBe(0);
    signals.emit('SIGTERM');
    expect(await code).toBe(0);
    expect(shut).toBe(1);
    expect(log[0]).toMatch(/Stopping/);
    expect(signals.listenerCount('SIGTERM')).toBe(0);            // it lets go of the process, too
  });

  it('answers 1 and says what would not stop', async () => {
    const signals = new EventEmitter();
    const log: string[] = [];
    const code = untilStopped(async () => ['runs in flight'], { signals, force: () => {}, log: (line) => log.push(line) });
    signals.emit('SIGINT');
    expect(await code).toBe(1);
    expect(log.join('\n')).toContain('Did not stop in time: runs in flight.');
  });

  it('takes a second signal to mean now', async () => {
    const signals = new EventEmitter();
    const forced: number[] = [];
    void untilStopped(() => new Promise(() => {}), { signals, force: (code) => forced.push(code), log: () => {} });
    signals.emit('SIGINT');
    expect(forced).toEqual([]);
    signals.emit('SIGINT');
    expect(forced).toEqual([130]);
  });
});
