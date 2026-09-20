// Every element's Ui, by the name the file format gives it: the mirror of
// `engine/src/elements/registry.ts`. The shells ask these and never switch on a
// node type or a widget kind themselves.

import type { NodeType } from '@/graph';
import type { NodeUi } from './NodeUi';
import { InputNodeUi } from './nodes/input/InputNodeUi';
import { AiNodeUi } from './nodes/ai/AiNodeUi';
import { CodeNodeUi } from './nodes/code/CodeNodeUi';
import { DataNodeUi } from './nodes/data/DataNodeUi';
import { OutputNodeUi } from './nodes/output/OutputNodeUi';
import { GuiNodeUi } from './nodes/gui/GuiNodeUi';
import { SubgraphNodeUi } from './nodes/subgraph/SubgraphNodeUi';
import { TriggerNodeUi } from './nodes/trigger/TriggerNodeUi';

/** Every node type's Ui, by type. */
export const NODE_UIS: Record<NodeType, NodeUi> = {
  input: new InputNodeUi(),
  ai: new AiNodeUi(),
  code: new CodeNodeUi(),
  data: new DataNodeUi(),
  output: new OutputNodeUi(),
  gui: new GuiNodeUi(),
  subgraph: new SubgraphNodeUi(),
  trigger: new TriggerNodeUi(),
};

export { WIDGET_UIS } from './widgets/roster';
