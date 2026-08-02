// Graph DSL types – mirror the backend Pydantic models

export type NodeType =
  | 'text_input'
  | 'file_input'
  | 'directory_input'
  | 'ai'
  | 'code'
  | 'output'
  | 'text_output'
  | 'merge'
  | 'split';

export type PortKind = 'input' | 'output';
export type DataType = 'text' | 'file_path' | 'binary' | 'json' | 'list' | 'any';
export type AIProvider = 'ollama' | 'openai' | 'openai_compatible' | 'anthropic' | 'lmstudio';
export type ExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface Port {
  id: string;
  name: string;
  kind: PortKind;
  data_type: DataType;
  multi: boolean;
  required: boolean;
  description: string;
  format?: string;
  debug_directory?: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeConfig {
  value?: string;
  prompt_at_runtime: boolean;
  select_all_files: boolean;
  selector_prompt: string;
  selector_code: string;
  ai_provider: AIProvider;
  ai_model: string;
  system_prompt: string;
  temperature: number;
  language: string;
  code: string;
  output_label: string;
  write_mode: 'none' | 'file' | 'directory';
  batch_mode: 'per_item' | 'whole_list';
  separator: string;
  merge_mode: 'concat' | 'sum' | 'count' | 'json_list';
  read_file_inputs: boolean;
  extra: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  node_type: NodeType;
  label: string;
  description: string;
  position: NodePosition;
  inputs: Port[];
  outputs: Port[];
  config: NodeConfig;
}

export interface GraphEdge {
  id: string;
  source_node_id: string;
  source_port_id: string;
  target_node_id: string;
  target_port_id: string;
}

export interface GraphMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  created_at?: string;
  updated_at?: string;
}

export interface Graph {
  metadata: GraphMetadata;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RuntimeRequirement {
  node_id: string;
  label: string;
  kind: 'text' | 'file' | 'directory';
  direction: 'input' | 'output';
  current_value: string;
}

export interface NodeResult {
  node_id: string;
  status: ExecutionStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error?: string;
  duration_ms?: number;
}

export interface ExecutionResult {
  graph_id?: string;
  status: ExecutionStatus;
  node_results: NodeResult[];
  final_outputs: Record<string, unknown>;
  error?: string;
  duration_ms?: number;
}

// ReactFlow-compatible types
export interface RFNodeData {
  graphNode: GraphNode;
  onEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onPortEdit: (nodeId: string, portId: string) => void;
  executionStatus?: ExecutionStatus;
  executionOutput?: Record<string, unknown>;
}
