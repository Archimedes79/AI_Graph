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
import { connectedDataFormatContext } from './data/dataElement';

function makeWidget(kind: GuiWidget['kind']): GuiWidget {
  return {
    id: 'w1', kind, label: '', extensions: '', size: 'medium',
    recursive: false, select_all_files: true, selector_prompt: '', selector_code: '',
    code_prompt: '',
    code_file: '',
    example_file: '',
  };
}

describe.each(Object.entries(NODE_ELEMENTS))('node element: %s', (nodeType, element) => {
  it('create() produces a valid GraphNode shape', () => {
    const node = element.create(`${nodeType}-1`);
    // A few NodeType keys share one element (widget resolves to the gui-style
    // element) -- create() always stamps its own canonical node_type, so assert
    // it round-trips through the registry to this same element rather than
    // requiring an exact string match.
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

  it('declares a generation whose fields exist, or declares none at all', () => {
    const node = element.create(`${nodeType}-gen`);
    const spec = element.generation;
    if (!spec) {
      // Nothing to generate also means nothing to author: the two answers are
      // the same question, which is what stopped image_view's missing button
      // from happening again one level down.
      expect(element.authoredFile?.(node)).toBeFalsy();
      return;
    }
    const fields = spec.promptField === 'description'
      ? { ...(node.config as unknown as Record<string, unknown>), description: node.description }
      : (node.config as unknown as Record<string, unknown>);
    expect(spec.promptField in fields).toBe(true);
    expect(spec.targetField in (node.config as unknown as Record<string, unknown>)).toBe(true);
    expect(spec.guard && spec.success).toBeTruthy();
  });

  it('describes what it emits, or is a node with nothing to say', () => {
    const node = element.create(`${nodeType}-out`);
    // An output node ends the graph, so it has no downstream to describe to.
    const expected = nodeType === 'output' ? undefined : expect.any(String);
    expect(element.describeOutput?.(node)).toEqual(expected);
  });
});

it('describes connected data nodes as source and target generation formats', () => {
  const source = NODE_ELEMENTS.data.create('source');
  source.label = 'Input records';
  source.config.data_format = 'structure';
  source.config.data_format_prompt = 'columns: id integer, name text';
  const processor = NODE_ELEMENTS.code.create('processor');
  const target = NODE_ELEMENTS.data.create('target');
  target.label = 'Result map';
  target.config.data_format = 'structure';

  const context = connectedDataFormatContext('processor', [source, processor, target], [
    { source: 'source', target: 'processor' },
    { source: 'processor', target: 'target' },
  ]);

  expect(context).toContain('Source data format from "Input records": structure: columns: id integer, name text');
  expect(context).toContain('Target data format required by "Result map": structure');
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

  it('declares a generation whose fields exist, or declares none at all', () => {
    const widget = makeWidget(widgetKind as GuiWidget['kind']);
    const spec = element.generation;
    if (!spec) {
      expect(element.authoredFile?.(widget)).toBeFalsy();
      return;
    }
    const flat = widget as unknown as Record<string, unknown>;
    expect(spec.promptField in flat).toBe(true);
    expect(spec.targetField in flat).toBe(true);
    expect(spec.guard && spec.success).toBeTruthy();
  });
});
