import { describe, it, expect, vi, beforeEach } from 'vitest';

// The server, as far as saving goes: each write waits until the test lets it
// finish, so the test can edit the graph while it is on its way.
const writes: { path: string; finish: () => void; fail: (error: Error) => void }[] = [];
vi.mock('@/api/client', async (actual) => ({
  ...(await actual<typeof import('@/api/client')>()),
  call: vi.fn((route: string, body: { path: string }) => {
    if (route !== 'saveGraph') throw new Error(`not expected here: ${route}`);
    return new Promise((resolve, reject) => {
      writes.push({
        path: body.path,
        finish: () => resolve({ path: `/abs/${body.path}`, graph: {}, project: true }),
        fail: reject,
      });
    });
  }),
}));

const { useGraphStore } = await import('./graphStore');
const store = () => useGraphStore.getState();

describe('saving the document', () => {
  beforeEach(() => {
    writes.length = 0;
    store().newGraph();
  });

  it('counts as saved what was sent, not what is there when the write comes back', async () => {
    store().addNode('code', { x: 0, y: 0 });
    const saving = store().save('graph');
    // An edit made while the write is on its way is not on disk.
    store().addNode('output', { x: 300, y: 0 });
    writes[0].finish();
    await saving;
    expect(store().isDirty()).toBe(true);
  });

  it('is at the path it was written to, and clean', async () => {
    store().addNode('code', { x: 0, y: 0 });
    const saving = store().save('graph');
    writes[0].finish();
    expect(await saving).toEqual({ path: '/abs/graph' });
    expect(store().currentFilePath).toBe('/abs/graph');
    expect(store().isProject).toBe(true);
    expect(store().isDirty()).toBe(false);

    // Saved again, it goes where it was saved to.
    store().addNode('output', { x: 300, y: 0 });
    const again = store().save();
    expect(writes[1].path).toBe('/abs/graph');
    writes[1].finish();
    await again;
    expect(store().isDirty()).toBe(false);
  });

  it('marks nothing saved when the write fails', async () => {
    store().addNode('code', { x: 0, y: 0 });
    const saving = store().save('graph');
    writes[0].fail(new Error('disk full'));
    await expect(saving).rejects.toThrow('disk full');
    expect(store().isDirty()).toBe(true);
    expect(store().currentFilePath).toBeNull();
  });

  it('asks for a path when the graph has none', async () => {
    await expect(store().save()).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });
});
