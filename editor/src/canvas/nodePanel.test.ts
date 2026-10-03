import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, Port } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { useGraphStore } from '@/store/graphStore';
import { ONCE } from '@/elements/NodeGuiBuilder';
import { holdDropped } from '@/elements/nodes/data/DataNodePanel';
import { WRITE_AFTER_MS, changedFields, nodePanel, overlay, writeBeforeKey } from './nodePanel';
import { withPorts } from './nodeDraft';

/**
 * A node's panel with no Save and no Cancel: what is changed is written into
 * the graph a moment later, typing into one field is one undo step, Undo takes
 * it back, and closing the panel loses nothing.
 */

const store = () => useGraphStore.getState();
const stored = (id: string) => store().rfNodes.find((item) => item.id === id)!.data.graphNode as GraphNode;
const rename = (ports: Port[], at: number, id: string) => ports.map((port, i) => (i === at ? { ...port, id, name: id } : port));
/** The node's text typed into its box, as the panel writes it (`NodeEditor`'s `setDescription`). */
const say = (panel: ReturnType<typeof nodePanel>, text: string) =>
  panel.change((node) => ({ ...node, description: text }), { field: 'description' });

beforeEach(() => {
  vi.useFakeTimers();
  const code = NODE_KINDS.code.create('code');
  const out = NODE_KINDS.output.create('out');
  store().loadGraph({
    metadata: { name: 'T', description: '', gui_scheme: 'night' },
    nodes: [code, out, NODE_KINDS.data.create('history')],
    edges: [{ id: 'e', source_node_id: 'code', source_port_id: 'output', target_node_id: 'out', target_port_id: 'value' }],
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('a change in a node\'s panel', () => {
  it('is shown at once, and in the graph a moment later', () => {
    const panel = nodePanel('code');
    say(panel, 'Count the words.');
    expect(panel.node()?.description).toBe('Count the words.');
    expect(stored('code').description).toBe('');
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    expect(stored('code').description).toBe('Count the words.');
  });

  it('typed into one field, is one undo step, and Undo takes it back', () => {
    const panel = nodePanel('code');
    const before = store().past.length;
    for (const text of ['C', 'Co', 'Cou', 'Count']) {
      say(panel, text);
      vi.advanceTimersByTime(WRITE_AFTER_MS);
    }
    expect(stored('code').description).toBe('Count');
    expect(store().past.length).toBe(before + 1);
    store().undo();
    expect(stored('code').description).toBe('');
    expect(panel.node()?.description).toBe('');
  });

  it('written as its own step, is not added to what was typed before it: what ✨ writes is undone alone', () => {
    const panel = nodePanel('code');
    panel.setConfig('code', 'typed');
    panel.write();
    panel.setConfig('code', 'generated');
    panel.write(true);
    store().undo();
    expect(stored('code').config.code).toBe('typed');
  });

  it('keeps what changed in the graph meanwhile -- a file saved in the person\'s own editor -- under what waits to be written', () => {
    const panel = nodePanel('code');
    say(panel, 'Shout it.');
    store().updateNode('code', { config: { ...stored('code').config, code: 'function run(inputs) { return { output: 1 }; }' } });
    expect(panel.node()).toMatchObject({ description: 'Shout it.', config: { code: 'function run(inputs) { return { output: 1 }; }' } });
    panel.write();
    expect(stored('code')).toMatchObject({ description: 'Shout it.', config: { code: 'function run(inputs) { return { output: 1 }; }' } });
  });

  it('takes a renamed port\'s wire along, keystroke by keystroke', () => {
    const panel = nodePanel('code');
    for (const typed of ['r', 're', 'res', 'result']) {
      panel.change((node) => withPorts(node, { inputs: node.inputs, outputs: rename(node.outputs, 0, typed) }));
      vi.advanceTimersByTime(WRITE_AFTER_MS);
    }
    expect(store().rfEdges.map((edge) => edge.sourceHandle)).toEqual(['result']);
  });

  it('is written when the panel is closed, and nothing is lost', () => {
    store().setEditingNode('code');
    const panel = nodePanel('code');
    const stop = panel.watch(() => {});
    say(panel, 'Keep me.');
    store().setEditingNode(null);
    expect(stored('code').description).toBe('Keep me.');
    stop();
  });

  it('never lands in another graph opened meanwhile, which may have a node of the same id', () => {
    const panel = nodePanel('code');
    say(panel, 'Meant for the first graph.');
    store().loadGraph({ metadata: { name: 'Other', description: '', gui_scheme: 'night' }, nodes: [NODE_KINDS.code.create('code')], edges: [] });
    panel.write();
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    expect(stored('code').description).toBe('');
    expect(panel.node()).toBeUndefined();
  });

  it('is written first when the graph is saved with Ctrl+S, so the file holds what the panel shows', () => {
    const panel = nodePanel('code');
    say(panel, 'Saved with it.');
    // The panel hears the key first (capture); the save is the page's, after it.
    writeBeforeKey(panel)({ ctrlKey: true, metaKey: false, key: 's' });
    expect(store().rootGraph().nodes.find((node) => node.id === 'code')?.description).toBe('Saved with it.');
  });
});

describe('what a round shows, landing while a word is typed', () => {
  it('is no edit of the document: the word stays one undo step, and Undo takes back all of it', () => {
    const panel = nodePanel('code');
    const before = store().past.length;
    say(panel, 'C'); vi.advanceTimersByTime(WRITE_AFTER_MS);
    // What the session keeps is its own: the round is shown, and written nowhere.
    store().setExecutionResult({
      status: 'success', outputs: {},
      node_results: [{ node_id: 'history', status: 'success', inputs: {}, outputs: { output: 'turn 1' } }],
    });
    // Well within the moment in which typing into the same field adds to its step.
    say(panel, 'Co'); vi.advanceTimersByTime(WRITE_AFTER_MS);
    expect(store().past.length).toBe(before + 1);
    store().undo();
    expect(stored('code').description).toBe('');
  });
});

describe('what is not typing, written into a field just typed into', () => {
  /** A ✨ prompt box typed into, as the panel writes it: the node keeps only the prompts it changed. */
  const prompt = (panel: ReturnType<typeof nodePanel>, write: 'input' | 'output', text: string) =>
    panel.setConfig('prompts', (current: unknown) => ({ ...(current as Record<string, string> | undefined), [write]: text }), { field: `prompts.${write}` });

  it('a file dropped on a data node\'s box is an undo step of its own, not more of what was typed there', async () => {
    const panel = nodePanel('history');
    panel.setConfig('data_value', 'typed by hand'); vi.advanceTimersByTime(WRITE_AFTER_MS);
    // The drop, as the box takes it.
    await holdDropped({ name: 'state.json', size: 12, text: async () => '{"count": 3}' }, (key, value, step) => panel.setConfig(key, value, step), () => {});
    expect(stored('history').config.data_value).toEqual({ count: 3 });
    store().undo();
    expect(stored('history').config.data_value).toBe('typed by hand');
  });

  it('a file given to ✨ Input is an undo step of its own, after a prompt typed a moment before', () => {
    const panel = nodePanel('code');
    prompt(panel, 'input', 'Read the columns.');
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    panel.setConfig('input_files', (current: unknown) => [...((current as string[] | undefined) ?? []), 'data/people.csv'], ONCE);
    store().undo();
    expect(stored('code').config.input_files).toBeUndefined();
    expect(stored('code').config.prompts).toEqual({ input: 'Read the columns.' });
  });

  it('two prompt boxes are two fields, two undo steps, though both are the node\'s prompts', () => {
    const panel = nodePanel('code');
    prompt(panel, 'input', 'Mine.');
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    prompt(panel, 'output', 'Mine too.');
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    store().undo();
    expect(stored('code').config.prompts).toEqual({ input: 'Mine.' });
  });
});

describe('what a change touched', () => {
  it('is named by field, so a word typed into one is one step and the next field another', () => {
    const node = NODE_KINDS.code.create('c');
    const edited = { ...node, label: 'L', config: { ...node.config, code: 'x' } };
    expect(changedFields(node, edited)).toEqual(['label', 'config.code']);
    expect(changedFields(node, { ...node, inputs: [] })).toEqual(['ports']);
    expect(overlay(node, edited, ['config.code'])).toMatchObject({ label: node.label, config: { code: 'x' } });
  });
});
