// The graph's types, as every editor file imports them.
//
// `graphModel.ts` holds the documents themselves; what is added here is only
// what exists because of the canvas -- the data ReactFlow carries per node.
export * from './graphModel';

import type { ExecutionStatus, GraphNode } from './graphModel';

// ReactFlow-compatible types
export interface RFNodeData {
  graphNode: GraphNode;
  onEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onPortEdit: (nodeId: string, portId: string) => void;
  executionStatus?: ExecutionStatus;
  executionOutput?: Record<string, unknown>;
}

