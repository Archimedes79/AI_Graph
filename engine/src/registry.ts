// The runtime registry: every element a deployed tool can run.
//
// One list, built from the element classes themselves. The editor keeps its own
// registry of subclasses that add the config panels — this one is what a bundle
// imports, and it is the reason a bundle contains no editor.

import type { GraphNodeElement, WidgetElement } from './element.ts';
import type { NodeType, WidgetKind } from './graph.ts';
import { AiElement } from './elements/ai/element.ts';
import { CodeElement } from './elements/code/element.ts';
import { DataElement } from './elements/data/element.ts';
import { GuiElement } from './elements/gui/element.ts';
import { InputElement } from './elements/input/element.ts';
import { OutputElement } from './elements/output/element.ts';
import { WIDGET_ELEMENTS } from './elements/gui/children/index.ts';

export const NODE_ELEMENTS: GraphNodeElement<unknown>[] = [
  new InputElement(),
  new AiElement(),
  new CodeElement(),
  new DataElement(),
  new OutputElement(),
  new GuiElement(),
] as GraphNodeElement<unknown>[];

const NODES_BY_TYPE = new Map<string, GraphNodeElement<unknown>>(
  NODE_ELEMENTS.map((element) => [element.nodeType, element]),
);

const WIDGETS_BY_KIND = new Map<string, WidgetElement<unknown>>(
  WIDGET_ELEMENTS.map((element) => [element.widgetKind, element as WidgetElement<unknown>]),
);

/** The registry the executor asks. An unknown type is a missing element, not a crash. */
export const registry = {
  node(type: NodeType | string): GraphNodeElement<unknown> | undefined {
    return NODES_BY_TYPE.get(type);
  },
  widget(kind: WidgetKind | string): WidgetElement<unknown> | undefined {
    return WIDGETS_BY_KIND.get(kind);
  },
  nodeTypes(): string[] {
    return [...NODES_BY_TYPE.keys()];
  },
  widgetKinds(): string[] {
    return [...WIDGETS_BY_KIND.keys()];
  },
};

export { WIDGET_ELEMENTS };
