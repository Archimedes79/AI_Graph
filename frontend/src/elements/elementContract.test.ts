/**
 * Consolidated element-contract test.
 *
 * Walks every registered NodeElementDefinition (`registry.ts::NODE_ELEMENTS`)
 * and GuiWidgetElementDefinition (`registry.ts::GUI_WIDGET_ELEMENTS`) and
 * asserts the handful of universal properties every element must satisfy --
 * see AGENTS.md's "Object-oriented element contract". This REPLACES ad-hoc
 * per-element unit tests: when adding a new NodeType/GuiWidgetKind, extend
 * this file instead of adding a new one. The deep execute()-vs-compile()
 * check only makes sense on the backend (see
 * backend/tests/test_element_contract.py) -- only the backend actually
 * compiles and executes a graph.
 */
import { describe, it, expect } from 'vitest';
import { NODE_ELEMENTS, GUI_WIDGET_ELEMENTS } from './registry';
import type { GraphNode, GuiWidget } from '../types/graph';

function makeWidget(kind: GuiWidget['kind']): GuiWidget {
  return { id: 'w1', kind, label: '', extensions: '', size: 'medium' };
}

describe.each(Object.entries(NODE_ELEMENTS))('node element: %s', (nodeType, element) => {
  it('create() produces a valid GraphNode shape', () => {
    const node = element.create(`${nodeType}-1`);
    // Some NodeType keys are legacy aliases sharing one element (e.g. text_input/
    // file_input/directory_input all resolve to inputElement) -- create() always
    // stamps its own canonical node_type, so assert it round-trips through the
    // registry to this same element rather than requiring an exact string match.
    expect(NODE_ELEMENTS[node.node_type]).toBe(element);
    expect(node.id).toBe(`${nodeType}-1`);
    expect(node.config).toBeTruthy();
    expect(Array.isArray(node.inputs)).toBe(true);
    expect(Array.isArray(node.outputs)).toBe(true);
  });

  it('can be removed from a node list, leaving the rest intact', () => {
    const node = element.create(`${nodeType}-1`);
    const other = element.create(`${nodeType}-2`);
    const nodes: GraphNode[] = [node, other];
    const remaining = nodes.filter((n) => n.id !== node.id);
    expect(remaining).toEqual([other]);
  });

  it('declares default inputs/outputs without throwing', () => {
    expect(() => element.create(`${nodeType}-ports`)).not.toThrow();
    const node = element.create(`${nodeType}-ports`);
    expect(Array.isArray(node.inputs)).toBe(true);
    expect(Array.isArray(node.outputs)).toBe(true);
  });

  it('has a defined ConfigEditor component', () => {
    expect(element.ConfigEditor).toBeDefined();
  });
});

describe.each(Object.entries(GUI_WIDGET_ELEMENTS))('gui widget element: %s', (widgetKind, element) => {
  it('can be added to and removed from a widget list', () => {
    const widget = makeWidget(widgetKind as GuiWidget['kind']);
    const widgets: GuiWidget[] = [widget, { ...widget, id: 'w2' }];
    const remaining = widgets.filter((w) => w.id !== widget.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('w2');
  });

  it('ports() returns input/output arrays without throwing', () => {
    const widget = makeWidget(widgetKind as GuiWidget['kind']);
    const { inputs, outputs } = element.ports(widget);
    expect(Array.isArray(inputs)).toBe(true);
    expect(Array.isArray(outputs)).toBe(true);
  });

  it('has a defined RuntimeWidget component', () => {
    expect(element.RuntimeWidget).toBeDefined();
  });

  it('has a defined ConfigEditor component', () => {
    expect(element.ConfigEditor).toBeDefined();
  });
});
