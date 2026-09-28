/**
 * What every element's browser half must satisfy.
 *
 * Walks every registered `NodeGuiBuilder` and `WidgetGuiBuilder` (`registry.ts`) and asserts
 * the handful of properties each must have. A new node type or widget kind is
 * held to them by being registered; what it does when a graph runs is the
 * engine's to test, beside the element (`engine/src/elements/`).
 */
import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { BLOCKS } from '@/page/blocks';
import { guiWidgetPorts, showsPage } from '@/document/guiWidgets';
import { NODE_BUILDERS, WIDGET_BUILDERS } from './registry';
import type { GraphNode, GuiWidget } from '@/graph';
import { bodyOf, hasDefinitions } from '@/authoring/generation';

/**
 * A widget as the app really creates one, with a fixed id so assertions can name
 * it. This was a hand-written literal -- a second definition of "a new widget"
 * that drifted from `WIDGET_BUILDERS.create` and left optional fields out, which made
 * the contract test below pass for the wrong reason.
 */
function makeWidget(kind: GuiWidget['kind']): GuiWidget {
  return WIDGET_BUILDERS[kind].create('w1', '');
}

/** The blocks that carry no settings at all -- page furniture, not fields. */
const STATIC_KINDS_WITHOUT_SETTINGS = ['divider', 'spacer', 'button', 'chat'];

/** A component registered with `lazy()`: its code is a chunk of its own, fetched when first drawn. */
function isLazy(component: unknown): boolean {
  return (component as { $$typeof?: symbol } | undefined)?.$$typeof === Symbol.for('react.lazy');
}

describe.each(Object.entries(NODE_BUILDERS))('node element: %s', (nodeType, element) => {
  const kind = NODE_KINDS[nodeType as GraphNode['node_type']];
  it('create() produces a valid GraphNode shape', () => {
    const node = kind.create(`${nodeType}-1`);
    expect(node.node_type).toBe(nodeType);
    expect(node.id).toBe(`${nodeType}-1`);
    expect(node.config).toBeTruthy();
    expect(Array.isArray(node.inputs)).toBe(true);
    expect(Array.isArray(node.outputs)).toBe(true);
  });

  it('has a Panel, loaded only when the node is opened -- or is a page, and never opened', () => {
    // A page is edited on the Page tab and its panel is never opened
    // (App.tsx), so a panel of its own is one nobody can reach -- which the
    // gui node's was, stale copy and all.
    if (showsPage(nodeType)) {
      expect(element.Panel).toBeUndefined();
      return;
    }
    // Every other node type has settings; only page furniture does not (see
    // the widget suite below). Lazy, so that a deployed tool, which draws
    // pages and never edits them, never loads a panel.
    expect(isLazy(element.Panel)).toBe(true);
    if (element.AdvancedPanel) expect(isLazy(element.AdvancedPanel)).toBe(true);
  });

  it('draws its own text where ✨ writes for it, and defines itself exactly where the engine keeps its definitions', () => {
    const node = kind.create(`${nodeType}-gen`);
    // Its panel draws the text ✨ writes from above the ✨ rows: the side panel's
    // own box above that would be a second text.
    if (bodyOf(node)) expect(element.ownsDescription).toBe(true);
    // Its ports folded away, its input.js and output.js in its panel: the
    // side panel's answer and the engine's are one.
    expect(element.definesItself).toBe(hasDefinitions(node));
  });

  it('describes what it emits', () => {
    const node = kind.create(`${nodeType}-out`);
    // Its declared output by default. An output node ends the graph and is
    // never asked, since nothing is wired out of it; it answers all the same.
    expect(element.describeOutput(node)).toEqual(expect.any(String));
  });
});

describe.each(Object.entries(WIDGET_BUILDERS))('gui widget element: %s', (widgetKind, element) => {
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
});
