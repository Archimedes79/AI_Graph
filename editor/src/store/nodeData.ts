// What ReactFlow carries per node on the canvas: the graph node. What the canvas
// does with it -- edit it, delete it -- it asks the store for, so no copy of
// those actions is kept in every node's data and rebuilt on every load.

import type { GraphNode } from '@/graph';

export interface RFNodeData {
  graphNode: GraphNode;
}
