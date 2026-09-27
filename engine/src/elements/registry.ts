// The runtime registry: every element a deployed tool can run.
//
// One list, built from the element classes themselves. The editor keeps its own
// registry of subclasses that add the config panels — this one is what a bundle
// imports, and it is the reason a bundle contains no editor.

import type { NodeRunner } from './NodeRunner.ts';
import type { WidgetRunner } from './WidgetRunner.ts';
import type { NodeType, WidgetKind } from '../graph.ts';
import { AiNodeRunner } from './nodes/ai/AiNodeRunner.ts';
import { CodeNodeRunner } from './nodes/code/CodeNodeRunner.ts';
import { DataNodeRunner } from './nodes/data/DataNodeRunner.ts';
import { GuiNodeRunner } from './nodes/gui/GuiNodeRunner.ts';
import { InputNodeRunner } from './nodes/input/InputNodeRunner.ts';
import { OutputNodeRunner } from './nodes/output/OutputNodeRunner.ts';
import { SubgraphNodeRunner } from './nodes/subgraph/SubgraphNodeRunner.ts';
import { TriggerNodeRunner } from './nodes/trigger/TriggerNodeRunner.ts';
import { WIDGETS } from './widgets/roster.ts';

export const NODES: NodeRunner<unknown>[] = [
  new InputNodeRunner(),
  new AiNodeRunner(),
  new CodeNodeRunner(),
  new DataNodeRunner(),
  new OutputNodeRunner(),
  new GuiNodeRunner(),
  // Last, so that the list a person or a model is shown keeps the order they
  // already know, with the newcomer after it.
  new SubgraphNodeRunner(),
  new TriggerNodeRunner(),
] as NodeRunner<unknown>[];

const NODES_BY_TYPE = new Map<string, NodeRunner<unknown>>(
  NODES.map((element) => [element.nodeType, element]),
);

const WIDGETS_BY_KIND = new Map<string, WidgetRunner<unknown>>(
  WIDGETS.map((element) => [element.widgetKind, element as WidgetRunner<unknown>]),
);

/** The registry the executor asks. An unknown type is a missing element, not a crash. */
export const registry = {
  node(type: NodeType | string): NodeRunner<unknown> | undefined {
    return NODES_BY_TYPE.get(type);
  },
  widget(kind: WidgetKind | string): WidgetRunner<unknown> | undefined {
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
