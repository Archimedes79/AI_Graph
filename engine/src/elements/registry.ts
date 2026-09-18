// The runtime registry: every element a deployed tool can run.
//
// One list, built from the element classes themselves. The editor keeps its own
// registry of subclasses that add the config panels — this one is what a bundle
// imports, and it is the reason a bundle contains no editor.

import type { GraphNodeElement } from './GraphNodeElement.ts';
import type { WidgetElement } from './WidgetElement.ts';
import type { NodeType, WidgetKind } from '../graph.ts';
import { AiNode } from './nodes/ai/AiNode.ts';
import { CodeNode } from './nodes/code/CodeNode.ts';
import { DataNode } from './nodes/data/DataNode.ts';
import { GuiNode } from './nodes/gui/GuiNode.ts';
import { InputNode } from './nodes/input/InputNode.ts';
import { OutputNode } from './nodes/output/OutputNode.ts';
import { WIDGETS } from './widgets/roster.ts';

export const NODE_UIS: GraphNodeElement<unknown>[] = [
  new InputNode(),
  new AiNode(),
  new CodeNode(),
  new DataNode(),
  new OutputNode(),
  new GuiNode(),
] as GraphNodeElement<unknown>[];

const NODES_BY_TYPE = new Map<string, GraphNodeElement<unknown>>(
  NODE_UIS.map((element) => [element.nodeType, element]),
);

const WIDGETS_BY_KIND = new Map<string, WidgetElement<unknown>>(
  WIDGETS.map((element) => [element.widgetKind, element as WidgetElement<unknown>]),
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

export { WIDGETS };
