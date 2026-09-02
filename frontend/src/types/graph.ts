// Graph DSL types as the editor sees them.
//
// `graph.generated.ts` was once derived from a Python model; the engine's
// `graph.ts` is the DSL's home now, and this file is the editor's typed view of
// it (every element's config field in one type -- an open question, see
// TODO.md). Only genuinely editor-only types (ReactFlow node data) belong here.
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

