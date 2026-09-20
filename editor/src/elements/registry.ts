// Every element's GuiBuilder, by the name the file format gives it: the mirror of
// `engine/src/elements/registry.ts`. The shells ask these and never switch on a
// node type or a widget kind themselves.

import type { NodeType } from '@/graph';
import type { NodeGuiBuilder } from './NodeGuiBuilder';
import { InputNodeGuiBuilder } from './nodes/input/InputNodeGuiBuilder';
import { AiNodeGuiBuilder } from './nodes/ai/AiNodeGuiBuilder';
import { CodeNodeGuiBuilder } from './nodes/code/CodeNodeGuiBuilder';
import { DataNodeGuiBuilder } from './nodes/data/DataNodeGuiBuilder';
import { OutputNodeGuiBuilder } from './nodes/output/OutputNodeGuiBuilder';
import { GuiNodeGuiBuilder } from './nodes/gui/GuiNodeGuiBuilder';
import { SubgraphNodeGuiBuilder } from './nodes/subgraph/SubgraphNodeGuiBuilder';
import { TriggerNodeGuiBuilder } from './nodes/trigger/TriggerNodeGuiBuilder';

/** Every node type's GuiBuilder, by type. */
export const NODE_BUILDERS: Record<NodeType, NodeGuiBuilder> = {
  input: new InputNodeGuiBuilder(),
  ai: new AiNodeGuiBuilder(),
  code: new CodeNodeGuiBuilder(),
  data: new DataNodeGuiBuilder(),
  output: new OutputNodeGuiBuilder(),
  gui: new GuiNodeGuiBuilder(),
  subgraph: new SubgraphNodeGuiBuilder(),
  trigger: new TriggerNodeGuiBuilder(),
};

export { WIDGET_BUILDERS } from './widgets/roster';
