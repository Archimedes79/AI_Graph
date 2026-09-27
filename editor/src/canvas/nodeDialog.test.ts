import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, Port } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { COALESCE_MS, useGraphStore } from '@/store/graphStore';
import { ONCE } from '@/elements/NodeGuiBuilder';
import { holdDropped } from '@/elements/nodes/data/DataNodePanel';
import { readPair, withExpect, withInput, withJudge } from '@/authoring/examplePair';
import { exampleFor, keptExpect } from '@/authoring/nodeStepRules';
import { WRITE_AFTER_MS, changedFields, nodeDialog, overlay, writeBeforeKey } from './nodeDialog';
import { withPorts } from './nodeDraft';

/**
 * A node's dialog with no Save and no Cancel: what is changed is written into
 * the graph a moment later, typing into one field is one undo step, Undo takes
 * it back, and closing the dialog loses nothing.
 */

const store = () => useGraphStore.getState();
const stored = (id: string) => store().rfNodes.find((item) => item.id === id)!.data.graphNode as GraphNode;
const rename = (ports: Port[], at: number, id: string) => ports.map((port, i) => (i === at ? { ...port, id, name: id } : port));

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

describe('a change in a node\'s dialog', () => {
  it('is shown at once, and in the graph a moment later', () => {
    const dialog = nodeDialog('code');
    dialog.setConfig('prompt', 'Count the words.');
    expect(dialog.node()?.config.prompt).toBe('Count the words.');
    expect(stored('code').config.prompt).toBe('');
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    expect(stored('code').config.prompt).toBe('Count the words.');
    // What it is asked to do is what it publishes, as a Save did.
    expect(stored('code').description).toBe('Count the words.');
  });

  it('typed into one field, is one undo step, and Undo takes it back', () => {
    const dialog = nodeDialog('code');
    const before = store().past.length;
    for (const text of ['C', 'Co', 'Cou', 'Count']) {
      dialog.setConfig('prompt', text);
      vi.advanceTimersByTime(WRITE_AFTER_MS);
    }
    expect(stored('code').config.prompt).toBe('Count');
    expect(store().past.length).toBe(before + 1);
    store().undo();
    expect(stored('code').config.prompt).toBe('');
    expect(dialog.node()?.config.prompt).toBe('');
  });

  it('written as its own step, is not added to what was typed before it: what ✨ writes is undone alone', () => {
    const dialog = nodeDialog('code');
    dialog.setConfig('code', 'typed');
    dialog.write();
    dialog.setConfig('code', 'generated');
    dialog.write(true);
    store().undo();
    expect(stored('code').config.code).toBe('typed');
  });

  it('keeps what changed in the graph meanwhile -- a shape a run kept -- under what waits to be written', () => {
    const dialog = nodeDialog('code');
    dialog.setConfig('prompt', 'Shout it.');
    store().updateNode('code', { config: { ...stored('code').config, output_schema: { type: 'object' } } });
    expect(dialog.node()?.config).toMatchObject({ prompt: 'Shout it.', output_schema: { type: 'object' } });
    dialog.write();
    expect(stored('code').config).toMatchObject({ prompt: 'Shout it.', output_schema: { type: 'object' } });
  });

  it('takes a renamed port\'s wire along, keystroke by keystroke', () => {
    const dialog = nodeDialog('code');
    for (const typed of ['r', 're', 'res', 'result']) {
      dialog.change((node) => withPorts(node, { inputs: node.inputs, outputs: rename(node.outputs, 0, typed) }));
      vi.advanceTimersByTime(WRITE_AFTER_MS);
    }
    expect(store().rfEdges.map((edge) => edge.sourceHandle)).toEqual(['result']);
  });

  it('is written when the dialog is closed, and nothing is lost', () => {
    store().setEditingNode('code');
    const dialog = nodeDialog('code');
    const stop = dialog.watch(() => {});
    dialog.setConfig('prompt', 'Keep me.');
    store().setEditingNode(null);
    expect(stored('code').config.prompt).toBe('Keep me.');
    stop();
  });

  it('never lands in another graph opened meanwhile, which may have a node of the same id', () => {
    const dialog = nodeDialog('code');
    dialog.setConfig('prompt', 'Meant for the first graph.');
    store().loadGraph({ metadata: { name: 'Other', description: '', gui_scheme: 'night' }, nodes: [NODE_KINDS.code.create('code')], edges: [] });
    dialog.write();
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    expect(stored('code').config.prompt).toBe('');
    expect(dialog.node()).toBeUndefined();
  });

  it('is written first when the graph is saved with Ctrl+S, so the file holds what the dialog shows', () => {
    const dialog = nodeDialog('code');
    dialog.setConfig('prompt', 'Saved with it.');
    // The dialog hears the key first (capture); the save is the page's, after it.
    writeBeforeKey(dialog)({ ctrlKey: true, metaKey: false, key: 's' });
    expect(store().rootGraph().nodes.find((node) => node.id === 'code')?.config.prompt).toBe('Saved with it.');
  });
});

describe('what a run keeps, landing while a word is typed', () => {
  const ranWithMemory = () => store().setExecutionResult({
    status: 'success', outputs: {}, node_results: [],
    memory: [{ node_id: 'history', port_id: 'input', value: 'turn 1' }],
  } as never);

  it('ends the word\'s undo step: Undo takes back what was typed after it, and leaves what the run kept', () => {
    const dialog = nodeDialog('code');
    dialog.setConfig('prompt', 'C'); vi.advanceTimersByTime(WRITE_AFTER_MS);
    ranWithMemory();
    // Well within the moment in which typing into the same field adds to its step.
    dialog.setConfig('prompt', 'Co'); vi.advanceTimersByTime(WRITE_AFTER_MS);
    store().undo();
    expect(stored('code').config.prompt).toBe('C');
    expect(stored('history').config.data_value).toBe('turn 1');
  });
});

describe('what is not typing, written into a field just typed into', () => {
  const examples = (dialog: ReturnType<typeof nodeDialog>) => (change: (current: string) => string, step: Parameters<typeof dialog.setConfig>[2]) =>
    dialog.setConfig('examples', (current: unknown) => change(String(current ?? '')), step);

  it('a file dropped on a data node\'s box is an undo step of its own, not more of what was typed there', async () => {
    const dialog = nodeDialog('history');
    dialog.setConfig('data_value', 'typed by hand'); vi.advanceTimersByTime(WRITE_AFTER_MS);
    // The drop, as the box takes it.
    await holdDropped({ name: 'state.json', size: 12, text: async () => '{"count": 3}' }, (key, value, step) => dialog.setConfig(key, value, step), () => {});
    expect(stored('history').config.data_value).toEqual({ count: 3 });
    store().undo();
    expect(stored('history').config.data_value).toBe('typed by hand');
  });

  it('"Keep" is an undo step of its own, after the judge\'s sentence typed a moment before', () => {
    const edit = examples(nodeDialog('code'));
    edit((current) => withInput(current, '{"input": "a"}'), { field: 'example' });
    vi.advanceTimersByTime(COALESCE_MS + WRITE_AFTER_MS);
    edit((current) => withJudge(exampleFor(stored('code'), current), 'Upper case.'), { field: 'judge' });
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    edit((current) => withExpect(exampleFor(stored('code'), current), keptExpect({ output: 'A' })), ONCE);
    store().undo();
    expect(readPair(stored('code').config.examples)).toMatchObject({ judge: 'Upper case.', input: { input: 'a' } });
    expect(readPair(stored('code').config.examples).expect).toBeUndefined();
  });

  it('the example and the judge\'s sentence are two fields, two undo steps, though both are the node\'s examples', () => {
    const edit = examples(nodeDialog('code'));
    edit((current) => withInput(current, '{"input": "a"}'), { field: 'example' });
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    edit((current) => withJudge(exampleFor(stored('code'), current), 'Upper case.'), { field: 'judge' });
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    store().undo();
    expect(readPair(stored('code').config.examples)).toMatchObject({ input: { input: 'a' } });
    expect(readPair(stored('code').config.examples).judge).toBeUndefined();
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
