// The runtime registry: every element a deployed tool can run.
//
// One list, built from the element classes themselves. The editor keeps its own
// registry of subclasses that add the config panels — this one is what a bundle
// imports, and it is the reason a bundle contains no editor.

import type { NodeElement, WidgetElement } from './element.js';
import type { NodeType, WidgetKind } from './graph.js';
import { AiElement } from './elements/ai.js';
import { CodeElement } from './elements/code.js';
import { DataElement } from './elements/data.js';
import { GuiElement } from './elements/gui.js';
import { InputElement, OutputElement } from './elements/io.js';
import { WIDGET_ELEMENTS } from './elements/widgets.js';

export const NODE_ELEMENTS: NodeElement<unknown>[] = [
  new InputElement(),
  new AiElement(),
  new CodeElement(),
  new DataElement(),
  new OutputElement(),
  new GuiElement(),
] as NodeElement<unknown>[];

const NODES_BY_TYPE = new Map<string, NodeElement<unknown>>(
  NODE_ELEMENTS.map((element) => [element.nodeType, element]),
);

const WIDGETS_BY_KIND = new Map<string, WidgetElement<unknown>>(
  WIDGET_ELEMENTS.map((element) => [element.widgetKind, element as WidgetElement<unknown>]),
);

/** The registry the executor asks. An unknown type is a missing element, not a crash. */
export const registry = {
  node(type: NodeType | string): NodeElement<unknown> | undefined {
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
