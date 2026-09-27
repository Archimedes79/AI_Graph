import { afterEach, describe, expect, it, vi } from 'vitest';
import { call } from './client';

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
