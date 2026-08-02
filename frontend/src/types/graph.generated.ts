/* eslint-disable */
/**
 * AUTO-GENERATED -- DO NOT EDIT BY HAND.
 *
 * Generated from backend/app/models/graph.py via
 * backend/scripts/export_graph_schema.py + frontend/scripts/genTypes.mjs.
 * Run `npm run gen:types` after changing the backend Graph DSL models.
 */

/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "GuiWidgetKind".
 */
export type GuiWidgetKind =
  'file_open' | 'directory_open' | 'input_picker' | 'text_window' | 'chat_window' | 'text_io' | 'plot_window';
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "PortKind".
 */
export type PortKind = 'input' | 'output';
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "NodeType".
 */
export type NodeType =
  'text_input' | 'file_input' | 'directory_input' | 'input' | 'ai' | 'code' | 'output' | 'text_output' | 'gui';
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "AIProvider".
 */
export type AIProvider = 'ollama' | 'openai' | 'openai_compatible' | 'anthropic' | 'lmstudio';
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "DataType".
 */
export type DataType = 'text' | 'file_path' | 'binary' | 'json' | 'list' | 'any';
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "ExecutionStatus".
 */
export type ExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

/**
 * Top-level graph document – this is the Graph DSL schema.
 * Serialised to / from JSON for storage, execution, and deployment.
 */
export interface Graph {
  edges: GraphEdge[];
  metadata: GraphMetadata;
  nodes: GraphNode[];
}
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "GraphEdge".
 */
export interface GraphEdge {
  deferred?: boolean;
  id: string;
  initial_value?: unknown;
  source_node_id: string;
  source_port_id: string;
  target_node_id: string;
  target_port_id: string;
}
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "GraphMetadata".
 */
export interface GraphMetadata {
  author: string;
  created_at?: string | null;
  description: string;
  name: string;
  tags: string[];
  updated_at?: string | null;
  version: string;
}
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "GraphNode".
 */
export interface GraphNode {
  config: NodeConfig;
  description: string;
  height?: number | null;
  id: string;
  inputs: Port[];
  label: string;
  node_type: NodeType;
  outputs: Port[];
  position: NodePosition;
  width?: number | null;
}
/**
 * Extra configuration that depends on node_type.
 *
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "NodeConfig".
 */
export interface NodeConfig {
  ai_model: string;
  ai_provider: 'ollama' | 'openai' | 'openai_compatible' | 'anthropic' | 'lmstudio';
  batch_mode: 'per_item' | 'whole_list';
  code: string;
  code_prompt: string;
  example_path: string;
  extra: {
    [k: string]: unknown;
  };
  gui_widgets: GuiWidget[];
  input_mode: 'text' | 'file' | 'directory';
  language: string;
  output_format: 'text' | 'json' | 'csv' | 'csv_list' | 'custom';
  output_format_prompt: string;
  output_label: string;
  parse_code: string;
  parse_format: 'text' | 'json' | 'csv' | 'csv_list' | 'custom';
  prompt_at_runtime: boolean;
  read_file_inputs: boolean;
  select_all_files: boolean;
  selector_code: string;
  selector_prompt: string;
  system_prompt: string;
  temperature: number;
  value?: string | null;
  write_mode: 'none' | 'file' | 'directory' | 'window';
}
/**
 * One element inside a GUI node. Ports are never edited by hand: they are
 * always regenerated from this list (see `sync_gui_node_ports`), so a
 * widget's `id` must stay stable once assigned -- it is the only thing
 * that keeps existing edges attached across GUI edits.
 *
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "GuiWidget".
 */
export interface GuiWidget {
  code?: string;
  extensions: string;
  h?: number;
  id: string;
  kind: GuiWidgetKind;
  label: string;
  language?: 'python' | 'javascript';
  mode?: string;
  size: 'small' | 'medium' | 'large';
  value?: string | null;
  w?: number;
  x?: number | null;
  y?: number | null;
}
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "Port".
 */
export interface Port {
  data_type: 'text' | 'file_path' | 'binary' | 'json' | 'list' | 'any';
  debug_directory?: string | null;
  description: string;
  format?: string | null;
  id: string;
  kind: PortKind;
  multi: boolean;
  name: string;
  required: boolean;
}
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "NodePosition".
 */
export interface NodePosition {
  x: number;
  y: number;
}
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "ExecutionResult".
 */
export interface ExecutionResult {
  duration_ms?: number | null;
  error?: string | null;
  final_outputs: {
    [k: string]: unknown;
  };
  graph_id?: string | null;
  node_results: NodeResult[];
  status: ExecutionStatus;
}
/**
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "NodeResult".
 */
export interface NodeResult {
  duration_ms?: number | null;
  error?: string | null;
  inputs: {
    [k: string]: unknown;
  };
  node_id: string;
  outputs: {
    [k: string]: unknown;
  };
  status: ExecutionStatus;
}
/**
 * A file/directory path that must be supplied before the graph can run.
 *
 * This interface was referenced by `Graph`'s JSON-Schema
 * via the `definition` "RuntimeRequirement".
 */
export interface RuntimeRequirement {
  current_value: string;
  direction: 'input' | 'output';
  kind: 'text' | 'file' | 'directory';
  label: string;
  node_id: string;
  widget_id?: string | null;
}
