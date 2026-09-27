import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, watchGeneration, type AICall } from './client';

/**
 * What a generation has sent so far is asked for while it runs, under the id
 * it is handed, and no longer once it is over. The node dialogs and ✨ Generate
 * Graph each wrote this poll out.
 */
describe('a watched generation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('hands on what has gone out while it runs, and stops asking when it ends', async () => {
    vi.useFakeTimers();
    const sent = [{ provider: 'p', model: 'm' }] as AICall[];
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ calls: sent }), { headers: { 'Content-Type': 'application/json' } });
    }));
    const seen: AICall[][] = [];
    let finish: (value: string) => void = () => {};
    let id = '';
    const watching = watchGeneration((progressId) => {
      id = progressId;
      return new Promise<string>((resolve) => { finish = resolve; });
    }, (calls) => seen.push(calls));

    await vi.advanceTimersByTimeAsync(1100);
    expect(asked).toHaveLength(2);
    expect(asked.every((url) => url.includes(id))).toBe(true);
    expect(seen).toEqual([sent, sent]);

    finish('done');
    expect(await watching).toBe('done');
    await vi.advanceTimersByTimeAsync(2000);
    expect(asked).toHaveLength(2);
  });
});

/**
 * A download is named once, by the engine (`routes.ts` bundle, sent as
 * Content-Disposition). The page used to work the name out again, lowercased
 * and with only spaces replaced, so "My Graph!" saved as `my_graph!_bundle.zip`
 * while the engine said `My_Graph_bundle.zip`.
 */
describe('a download', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('comes back as a file carrying the name the server gave it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([80, 75]), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="My_Graph_bundle.zip"' },
    })));
    const zip = await call('bundle', { nodes: [], edges: [] } as never);
    expect(zip).toBeInstanceOf(File);
    expect(zip.name).toBe('My_Graph_bundle.zip');
    expect(zip.size).toBe(2);
  });
});
