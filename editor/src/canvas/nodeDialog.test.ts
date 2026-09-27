import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, Port } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { useGraphStore } from '@/store/graphStore';
import { WRITE_AFTER_MS, changedFields, nodeDialog, overlay } from './nodeDialog';
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
    nodes: [code, out],
    edges: [{ id: 'e', source_node_id: 'code', source_port_id: 'output', target_node_id: 'out', target_port_id: 'value' }],
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('a change in a node\'s dialog', () => {
  it('is shown at once, and in the graph a moment later', () => {
    const dialog = nodeDialog('code');
    dialog.setConfig('code_prompt', 'Count the words.');
    expect(dialog.node()?.config.code_prompt).toBe('Count the words.');
    expect(stored('code').config.code_prompt).toBe('');
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    expect(stored('code').config.code_prompt).toBe('Count the words.');
    // What it is asked to do is what it publishes, as a Save did.
    expect(stored('code').description).toBe('Count the words.');
  });

  it('typed into one field, is one undo step, and Undo takes it back', () => {
    const dialog = nodeDialog('code');
    const before = store().past.length;
    for (const text of ['C', 'Co', 'Cou', 'Count']) {
      dialog.setConfig('code_prompt', text);
      vi.advanceTimersByTime(WRITE_AFTER_MS);
    }
    expect(stored('code').config.code_prompt).toBe('Count');
    expect(store().past.length).toBe(before + 1);
    store().undo();
    expect(stored('code').config.code_prompt).toBe('');
    expect(dialog.node()?.config.code_prompt).toBe('');
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
    dialog.setConfig('code_prompt', 'Shout it.');
    store().updateNode('code', { config: { ...stored('code').config, output_schema: { type: 'object' } } });
    expect(dialog.node()?.config).toMatchObject({ code_prompt: 'Shout it.', output_schema: { type: 'object' } });
    dialog.write();
    expect(stored('code').config).toMatchObject({ code_prompt: 'Shout it.', output_schema: { type: 'object' } });
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
    dialog.setConfig('code_prompt', 'Keep me.');
    store().setEditingNode(null);
    expect(stored('code').config.code_prompt).toBe('Keep me.');
    stop();
  });

  it('never lands in another graph opened meanwhile, which may have a node of the same id', () => {
    const dialog = nodeDialog('code');
    dialog.setConfig('code_prompt', 'Meant for the first graph.');
    store().loadGraph({ metadata: { name: 'Other', description: '', gui_scheme: 'night' }, nodes: [NODE_KINDS.code.create('code')], edges: [] });
    dialog.write();
    vi.advanceTimersByTime(WRITE_AFTER_MS);
    expect(stored('code').config.code_prompt).toBe('');
    expect(dialog.node()).toBeUndefined();
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
