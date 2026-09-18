// What ReactFlow carries per node on the canvas: the graph node, and what the canvas needs to act on it.

import type { ExecutionStatus, GraphNode } from '@/graph';

export interface RFNodeData {
  graphNode: GraphNode;
  onEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onPortEdit: (nodeId: string, portId: string) => void;
  executionStatus?: ExecutionStatus;
  executionOutput?: Record<string, unknown>;
}
