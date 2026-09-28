// A node's panel, as its changes reach the graph.
//
// There is no Save and no Cancel. What is changed in the panel is the node it
// shows at once, and is written into the graph a moment later (`write`) -- as
// one undo step with what was typed into the same field just before
// (`graphStore.commit`), so a word typed is one step and not one per keystroke.
// A field is what was typed into, not the setting it writes: ✨ Input's prompt
// and ✨ Output's are both the node's prompts (`UndoStep`). What is not
// typing -- a file dropped in, what ✨ wrote, a box ticked -- is a step of its
// own, written at once after what was typed before it. Undo takes it back, and
// the panel shows what Undo left. Closing it writes what is still waiting:
// nothing is lost, and nothing asks.
//
// What cannot be stored yet -- data that is not JSON, a port name another port
// has -- is never handed to it: the field holds what was typed and says why
// (`useTyped`).
//
// Plain functions, and a hook around them: what the panel does with a change
// is what a test does with one (`masterExamples.test.ts`).

import { useEffect, useReducer, useState } from 'react';
import type { GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { trackPorts } from '@/store/portRenames';
import { ONCE, type UndoStep } from '@/elements/NodeGuiBuilder';
import { saveDraft, withSetting } from './nodeDraft';

/** How long after the last change the panel writes it into the graph. */
export const WRITE_AFTER_MS = 400;

/** The fields in which two versions of a node differ: `label`, `description`, `ports`, and `config.<key>` for each setting. */
export function changedFields(before: GraphNode, after: GraphNode): string[] {
  const fields: string[] = [];
  if (before.label !== after.label) fields.push('label');
  if (before.description !== after.description) fields.push('description');
  if (JSON.stringify([before.inputs, before.outputs]) !== JSON.stringify([after.inputs, after.outputs])) fields.push('ports');
  const was = before.config as Record<string, unknown>;
  const now = after.config as Record<string, unknown>;
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[key]) !== JSON.stringify(now[key])) fields.push(`config.${key}`);
  }
  return fields;
}

/**
 * *base* -- the node as the graph holds it now -- with *fields* taken from
 * *edited*: what was changed in the panel and not written yet, on top of
 * whatever changed in the graph meanwhile (a run's kept shape, a file changed
 * on disk), which it does not undo.
 */
export function overlay(base: GraphNode, edited: GraphNode, fields: Iterable<string>): GraphNode {
  let node = base;
  for (const field of fields) {
    if (field === 'label' || field === 'description') node = { ...node, [field]: edited[field] };
    else if (field === 'ports') node = { ...node, inputs: edited.inputs, outputs: edited.outputs };
    else {
      const key = field.slice('config.'.length);
      node = { ...node, config: { ...node.config, [key]: (edited.config as Record<string, unknown>)[key] } as GraphNode['config'] };
    }
  }
  return node;
}

interface NodePanel {
  /** The node as the panel shows it: the graph's, with what was changed and not yet written on top. Undefined once it is gone. */
  node(): GraphNode | undefined;
  /**
   * Change it, as the undo step *step* says: typed into a field -- the fields
   * it changes, unless *step* names the one -- written a moment later, or with
   * the next `write`; or `ONCE`, written now as a step of its own.
   */
  change(edit: (node: GraphNode) => GraphNode, step?: UndoStep): void;
  /** Change one setting (`withSetting`): *value* may be a function of the setting as it is when the change lands. */
  setConfig(key: string, value: unknown, step?: UndoStep): void;
  /**
   * Write what is waiting into the graph now: one undo step with what was
   * typed into the same fields just before it -- or, *own*, a step of its own,
   * for what is not typing: what ✨ wrote.
   */
  write(own?: boolean): void;
  /**
   * Follow the graph for a panel on screen: *onChange* after each change, and
   * a write when the panel is closed -- ✕, Esc, going into the node's graph.
   * Returns the end of it, which writes too.
   */
  watch(onChange: () => void): () => void;
}

/** The panel of node *nodeId*, in the graph open now: nothing it holds is written into another. */
export function nodePanel(nodeId: string): NodePanel {
  const store = () => useGraphStore.getState();
  const opened = store().document;
  let edited: GraphNode | null = null;
  // What waits to be written: the node's fields that changed (`overlay`),
  // and the fields typed into, which name its undo step.
  const waiting = new Set<string>();
  const typed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tracked: { of: GraphNode; node: GraphNode } | null = null;
  let changed = () => {};

  const stored = (): GraphNode | undefined => (store().document === opened
    ? store().rfNodes.find((item) => item.id === nodeId)?.data.graphNode
    : undefined);
  // Its ports marked with the ids they have (`trackPorts`), once per version
  // of the node: the marks are how a port renamed here keeps its wires.
  const base = (node: GraphNode): GraphNode => {
    if (tracked?.of !== node) tracked = { of: node, node: trackPorts(node) };
    return tracked.node;
  };
  const node = (): GraphNode | undefined => {
    const now = stored();
    if (!now) return undefined;
    return edited && waiting.size ? overlay(base(now), edited, waiting) : base(now);
  };
  const write = (own = false): void => {
    clearTimeout(timer);
    const before = stored();
    const draft = node();
    const changes = waiting.size;
    const step = `${nodeId}: ${[...typed].sort().join(', ')}`;
    waiting.clear();
    typed.clear();
    edited = null;
    if (!before || !draft || !changes) return;
    saveDraft(nodeId, before, draft, own ? undefined : step);
  };

  const panel: NodePanel = {
    node,
    write,
    change(edit, step) {
      // Not typing: what was typed before it is a step of its own, and so is this.
      if (step === ONCE) write();
      const now = node();
      if (!now) return;
      const next = edit(now);
      const fields = changedFields(now, next);
      for (const field of fields) waiting.add(field);
      for (const field of step && step !== ONCE ? [step.field] : fields) typed.add(field);
      edited = next;
      if (step === ONCE) write(true);
      else {
        clearTimeout(timer);
        timer = setTimeout(() => write(), WRITE_AFTER_MS);
      }
      changed();
    },
    setConfig(key, value, step) {
      panel.change((now) => withSetting(now, key, value), step);
    },
    watch(onChange) {
      changed = onChange;
      const off = useGraphStore.subscribe((state, before) => {
        // Closed while the graph stays: what waits is written into it now. A
        // graph replaced in the same moment -- another document, a level in
        // or out -- is not the one it was typed for.
        if (before.editingNodeId === nodeId && state.editingNodeId !== nodeId && state.rfNodes === before.rfNodes) write();
      });
      return () => {
        off();
        changed = () => {};
        write();
      };
    },
  };
  return panel;
}

/**
 * What a key pressed while the panel is open does first, before whatever the
 * key is for hears it: Ctrl+Z and Ctrl+Y write what is waiting, so Undo takes
 * back what was just typed rather than the step before it -- and Ctrl+S, so
 * the file holds what the panel shows. It saved without the last moment of
 * typing.
 */
export function writeBeforeKey(panel: Pick<NodePanel, 'write'>): (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>) => void {
  return (event) => {
    if ((event.ctrlKey || event.metaKey) && /^[zys]$/i.test(event.key)) panel.write();
  };
}

/** The panel of node *nodeId*, drawn anew whenever its node changes -- here or in the graph. */
export function useNodePanel(nodeId: string): NodePanel {
  const [panel] = useState(() => nodePanel(nodeId));
  const [, render] = useReducer((count: number) => count + 1, 0);
  useGraphStore((s) => s.rfNodes.find((item) => item.id === nodeId)?.data.graphNode);
  useEffect(() => panel.watch(render), [panel]);
  useEffect(() => {
    // Heard first, in the capture phase: the shortcuts themselves are the page's.
    const onKey = writeBeforeKey(panel);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panel]);
  return panel;
}
