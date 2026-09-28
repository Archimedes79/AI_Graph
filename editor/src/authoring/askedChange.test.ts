// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '@/graph';

/**
 * "Say what to change", asked of a node from the bar under the canvas
 * (`pendingChange`): the node's open panel changes its body as said -- one
 * ✨, asked with the change -- and the request is taken, once.
 */

// ✨'s server: what each generation was asked, answered at once -- a code
// node's body, or what a data node holds, each with its text restated.
const asked = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/api/client', async (actual) => ({
  ...(await actual<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, body: Record<string, unknown>) => {
    if (route === 'generationProgress') return { calls: [] };
    if (route !== 'generate') throw new Error(`not expected here: ${route}`);
    asked.push(body);
    const probe = { status: 'skipped', error: '', problems: [] };
    if ((body.node as GraphNode).node_type === 'data') {
      return { result: '{"cities": ["Berlin", "Paris"]}', description: 'Keeps two capitals: Berlin and Paris.', probe, calls: [] };
    }
    return {
      result: 'function run(inputs) { return { output: String(inputs.input).toUpperCase() }; }',
      description: 'Shouts the text it is given.',
      probe: { ...probe, status: 'ok' },
      calls: [],
    };
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useGraphStore } = await import('@/store/graphStore');
const { default: NodeEditor } = await import('@/canvas/NodeEditor');

const store = () => useGraphStore.getState();
const nodeOf = (id: string) => store().rfNodes.find((item) => item.id === id)!.data.graphNode as GraphNode;
let root: Root;
let page: HTMLElement;
let nodeId: string;

beforeEach(async () => {
  asked.length = 0;
  store().newGraph();
  nodeId = store().addNode('code', { x: 0, y: 0 });
  store().updateNode(nodeId, {
    description: 'Passes the text on.',
    config: {
      ...nodeOf(nodeId).config,
      input_definition: 'module.exports = { "input": "hello" };',
      output_definition: 'module.exports = { "output": "hello" };',
      code: 'function run(inputs) { return { output: inputs.input }; }',
    },
  });
  page = document.createElement('div');
  document.body.appendChild(page);
  root = createRoot(page);
  await open(nodeId);
});

/** *id*'s panel, drawn as the app draws it, one per node -- and loaded, which it is when first drawn. */
async function open(id: string): Promise<void> {
  await act(async () => { root.render(createElement(NodeEditor, { key: id, nodeId: id, onClose: () => {} })); });
  for (let tries = 0; tries < 50 && !page.querySelector('[aria-label="What it should do"]'); tries += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

/** Until ✨ has been asked. */
async function answered(): Promise<void> {
  for (let tries = 0; tries < 50 && !asked.length; tries += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

afterEach(async () => {
  await act(async () => { root.unmount(); });
  page.remove();
});

describe('a change asked of a node whose panel is open', () => {
  it('changes its body as said, with the text restated -- and is taken once', async () => {
    await act(async () => { store().askChange(nodeId, 'shout it'); });
    await answered();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ write: 'body', refine: { change: 'shout it' } });
    expect(store().pendingChange).toBeNull();
    await act(async () => { root.unmount(); });
    root = createRoot(page);
    expect(nodeOf(nodeId).config.code).toContain('toUpperCase');
    expect(nodeOf(nodeId).description).toBe('Shouts the text it is given.');
    expect(String(nodeOf(nodeId).config.history)).toContain('Change: shout it');
  });

  it('changes what a data node holds as said, with its text restated', async () => {
    const data = store().addNode('data', { x: 0, y: 200 });
    store().updateNode(data, {
      description: 'Keeps a capital.',
      config: { ...nodeOf(data).config, data_format: 'structure', data_value: { cities: ['Berlin'] } },
    });
    await open(data);
    await act(async () => { store().askChange(data, 'add Paris'); });
    await answered();
    expect(asked[0]).toMatchObject({ write: 'body', refine: { change: 'add Paris' } });
    await act(async () => { root.unmount(); });
    root = createRoot(page);
    expect(nodeOf(data).config.data_value).toEqual({ cities: ['Berlin', 'Paris'] });
    expect(nodeOf(data).description).toBe('Keeps two capitals: Berlin and Paris.');
    expect(String(nodeOf(data).config.history)).toContain('Change: add Paris');
  });

  it('is not this panel\'s when it is asked of another node', async () => {
    await act(async () => { store().askChange('elsewhere', 'shout it'); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(asked).toHaveLength(0);
    expect(store().pendingChange).toMatchObject({ nodeId: 'elsewhere' });
  });
});
