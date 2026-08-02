// Graph DSL types – re-exported from the generated types (see AGENTS.md's
// "Shared contracts" section). `graph.generated.ts` is produced from
// `backend/app/models/graph.py` via `npm run gen:types`; do not hand-edit it.
// Only genuinely frontend-only types (no backend model, e.g. ReactFlow node
// data) belong in this file.
export * from './graph.generated';

import type { ExecutionStatus, GraphNode } from './graph.generated';

// ReactFlow-compatible types
export interface RFNodeData {
  graphNode: GraphNode;
  onEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onPortEdit: (nodeId: string, portId: string) => void;
  executionStatus?: ExecutionStatus;
  executionOutput?: Record<string, unknown>;
}

