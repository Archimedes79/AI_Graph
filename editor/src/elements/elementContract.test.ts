/**
 * What every element's browser half must satisfy.
 *
 * Walks every registered `NodeUi` and `WidgetUi` (`registry.ts`) and asserts
 * the handful of properties each must have. A new node type or widget kind is
 * held to them by being registered; what it does when a graph runs is the
 * engine's to test, beside the element (`engine/src/elements/`).
 */
import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/nodeKinds';
import { BLOCKS } from '@/page/blocks';
import { guiWidgetPorts } from './nodes/gui/guiWidgets';
import { NODE_UIS, WIDGET_UIS } from './registry';
import type { GraphNode, GuiWidget } from '@/graph';
import { nodeLogic, widgetLogic } from '@/authoring/logic';

/**
 * A widget as the app really creates one, with a fixed id so assertions can name
 * it. This was a hand-written literal -- a second definition of "a new widget"
 * that drifted from `WIDGET_UIS.create` and left optional fields out, which made
 * the contract test below pass for the wrong reason.
 */
function makeWidget(kind: GuiWidget['kind']): GuiWidget {
  return { ...WIDGET_UIS[kind].create(''), id: 'w1' };
}

/** The blocks that carry no settings at all -- page furniture, not fields. */
const STATIC_KINDS_WITHOUT_SETTINGS = ['divider', 'spacer', 'button', 'chat'];

/** A component registered with `lazy()`: its code is a chunk of its own, fetched when first drawn. */
function isLazy(component: unknown): boolean {
  return (component as { $$typeof?: symbol } | undefined)?.$$typeof === Symbol.for('react.lazy');
}

describe.each(Object.entries(NODE_UIS))('node element: %s', (nodeType, element) => {
  const kind = NODE_KINDS[nodeType as GraphNode['node_type']];
  it('create() produces a valid GraphNode shape', () => {
    const node = kind.create(`${nodeType}-1`);
    // A few NodeType keys share one element (widget resolves to the gui-style
    // element) -- create() always stamps its own canonical node_type, so assert
    // it round-trips through the registry to this same element rather than
    // requiring an exact string match.
    expect(NODE_UIS[node.node_type as GraphNode['node_type']]).toBe(element);
    expect(node.id).toBe(`${nodeType}-1`);
    expect(node.config).toBeTruthy();
    expect(Array.isArray(node.inputs)).toBe(true);
    expect(Array.isArray(node.outputs)).toBe(true);
  });

  it('can be removed from a node list, leaving the rest intact', () => {
    const node = kind.create(`${nodeType}-1`);
    const other = kind.create(`${nodeType}-2`);
    const nodes: GraphNode[] = [node, other];
    const remaining = nodes.filter((n) => n.id !== node.id);
    expect(remaining).toEqual([other]);
  });

  it('declares default inputs/outputs without throwing', () => {
    expect(() => kind.create(`${nodeType}-ports`)).not.toThrow();
    const node = kind.create(`${nodeType}-ports`);
    expect(Array.isArray(node.inputs)).toBe(true);
    expect(Array.isArray(node.outputs)).toBe(true);
  });

  it('has a Panel, loaded only when the node is opened', () => {
    // Every node type has settings; only page furniture does not (see the
    // widget suite below). Lazy, so that a deployed tool, which draws pages
    // and never edits them, never loads a panel.
    expect(isLazy(element.Panel)).toBe(true);
    if (element.AdvancedPanel) expect(isLazy(element.AdvancedPanel)).toBe(true);
  });

  it('declares a generation whose fields exist, or declares none at all', () => {
    const node = kind.create(`${nodeType}-gen`);
    const spec = element.generation;
    if (!spec) {
      // Nothing to generate also means nothing to author: the two answers are
      // the same question, which is what stopped image_view's missing button
      // from happening again one level down.
      expect(nodeLogic(node)).toBeFalsy();
      return;
    }
    const fields = spec.promptField === 'description'
      ? { ...(node.config as unknown as Record<string, unknown>), description: node.description }
      : (node.config as unknown as Record<string, unknown>);
    expect(spec.promptField in fields).toBe(true);
    expect(spec.targetField in (node.config as unknown as Record<string, unknown>)).toBe(true);
    expect(spec.guard && spec.success).toBeTruthy();

    // The button writes into the field the *engine* says holds the body. Two
    // answers here means ✨ Generate filling a config key nothing ever runs,
    // which is the one failure this pair of declarations can produce and
    // nothing else would notice. Offered and authored are the same question,
    // so they are asserted to agree even when the answer is "not for this node".
    const logic = nodeLogic(node);
    const offered = spec.available?.(node) ?? true;
    expect(Boolean(logic)).toBe(offered);
    if (logic) {
      expect(logic.fields.body).toBe(spec.targetField);
      expect(logic.fields.prompt).toBe(spec.promptField);
    }
  });

  it('describes what it emits, or is a node with nothing to say', () => {
    const node = kind.create(`${nodeType}-out`);
    // An output node ends the graph, so it has no downstream to describe to.
    const expected = nodeType === 'output' ? undefined : expect.any(String);
    expect(element.describeOutput?.(node)).toEqual(expected);
  });
});

describe.each(Object.entries(WIDGET_UIS))('gui widget element: %s', (widgetKind, element) => {
  it('can be added to and removed from a widget list', () => {
    const widget = makeWidget(widgetKind as GuiWidget['kind']);
    const widgets: GuiWidget[] = [widget, { ...widget, id: 'w2' }];
    const remaining = widgets.filter((w) => w.id !== widget.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('w2');
  });

  it('contributes ports through the engine, which is the only place they exist', () => {
    // Not `element.ports`: the editor kept its own copy of that until the two
    // disagreed about whether a text box accepts anything or only text. The
    // shapes themselves are asserted in engine/src/elements/ports.test.ts.
    const widget = makeWidget(widgetKind as GuiWidget['kind']);
    const { inputs, outputs } = guiWidgetPorts(widget);
    expect(Array.isArray(inputs)).toBe(true);
    expect(Array.isArray(outputs)).toBe(true);
  });

  it('has a defined View component', () => {
    expect(BLOCKS[widgetKind as GuiWidget['kind']]?.View).toBeDefined();
  });

  it('has a config editor, or genuinely nothing to configure', () => {
    // Optional: a rule and a spacer have no settings of their own, and a
    // component whose whole body says so is worse than its absence. What must
    // hold is that an element with settings draws them itself -- the shells
    // still know no widget kind.
    if (element.Panel === undefined) {
      expect(STATIC_KINDS_WITHOUT_SETTINGS).toContain(widgetKind);
      return;
    }
    expect(isLazy(element.Panel)).toBe(true);
  });

  it('declares a generation whose fields exist, or declares none at all', () => {
    const widget = makeWidget(widgetKind as GuiWidget['kind']);
    const spec = element.generation;
    if (!spec) {
      expect(widgetLogic(widget)).toBeFalsy();
      return;
    }
    const flat = widget as unknown as Record<string, unknown>;
    expect(spec.promptField in flat).toBe(true);
    expect(spec.targetField in flat).toBe(true);
    expect(spec.guard && spec.success).toBeTruthy();

    // Same agreement one level down (see the node case above).
    const logic = widgetLogic(widget);
    const offered = spec.available?.(widget) ?? true;
    expect(Boolean(logic)).toBe(offered);
    if (logic) {
      expect(logic.fields.body).toBe(spec.targetField);
      expect(logic.fields.prompt).toBe(spec.promptField);
    }
  });
});
