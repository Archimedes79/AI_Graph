// The runtime registry: every element a deployed tool can run.
//
// One list, built from the element classes themselves. The editor keeps its own
// registry of subclasses that add the config panels — this one is what a bundle
// imports, and it is the reason a bundle contains no editor.

import type { NodeElement } from './NodeElement.ts';
import type { WidgetElement } from './WidgetElement.ts';
import type { NodeType, WidgetKind } from '../graph.ts';
import { AiNodeElement } from './nodes/ai/AiNodeElement.ts';
import { CodeNodeElement } from './nodes/code/CodeNodeElement.ts';
import { DataNodeElement } from './nodes/data/DataNodeElement.ts';
import { GuiNodeElement } from './nodes/gui/GuiNodeElement.ts';
import { InputNodeElement } from './nodes/input/InputNodeElement.ts';
import { OutputNodeElement } from './nodes/output/OutputNodeElement.ts';
import { WIDGETS } from './widgets/roster.ts';

export const NODES: NodeElement<unknown>[] = [
  new InputNodeElement(),
  new AiNodeElement(),
  new CodeNodeElement(),
  new DataNodeElement(),
  new OutputNodeElement(),
  new GuiNodeElement(),
] as NodeElement<unknown>[];

const NODES_BY_TYPE = new Map<string, NodeElement<unknown>>(
  NODES.map((element) => [element.nodeType, element]),
);

const WIDGETS_BY_KIND = new Map<string, WidgetElement<unknown>>(
  WIDGETS.map((element) => [element.widgetKind, element as WidgetElement<unknown>]),
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

export { WIDGETS };
