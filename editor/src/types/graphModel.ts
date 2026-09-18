// The graph as the editor sees it.
//
// Written by hand. It was once generated from a Python model, and said so at
// the top long after that model was gone -- "DO NOT EDIT" over a file that could
// only be edited. The engine's `graph.ts` is the format's home; this is the
// editor's view of the same documents: every element's settings in one
// `NodeConfig`, because a config panel reads `node.config.temperature` and
// wants a type there. That the engine treats a config as opaque and the editor
// spells it out is a real difference between the two, not drift -- what must
// not differ is anything the *graph file* means, which is why the shared parts
// (`DataType`, the run's result) come from the engine rather than being
// written down twice.

import type { DataType as EngineDataType } from '@engine/graph.ts';

export type GuiWidgetKind =
  'input_picker' | 'text_io' | 'plot_window' | 'image_view' | 'table' | 'text' | 'divider' | 'spacer'
  | 'select'
  | 'slider'
  | 'button'
  | 'chat';
export type PortKind = 'input' | 'output';
export type NodeType = 'input' | 'ai' | 'code' | 'data' | 'output' | 'gui';
export type AIProvider =
  'default' | 'ollama' | 'openai' | 'openai_compatible' | 'anthropic' | 'lmstudio' | 'google' | 'github_copilot';
/** What a port carries. The engine's list: two lists had already drifted apart. */
export type DataType = EngineDataType;
export type ExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'partial' | 'cancelled';

/**
 * Top-level graph document – this is the Graph DSL schema.
 * Serialised to / from JSON for storage, execution, and deployment.
 */
export interface Graph {
  edges: GraphEdge[];
  metadata: GraphMetadata;
  nodes: GraphNode[];
}
export interface GraphEdge {
  id: string;
  source_node_id: string;
  source_port_id: string;
  target_node_id: string;
  target_port_id: string;
}
export interface GraphMetadata {
  ai_defaults: AIDefaults;
  author: string;
  created_at?: string | null;
  description: string;
  gui_scheme: 'night' | 'paper' | 'office' | 'graphite' | 'anthracite';
  name: string;
  tags: string[];
  /** What starts this graph without being asked: when the tool opens, and on a clock. */
  triggers?: { on_start?: boolean; every?: string };
  updated_at?: string | null;
  version: string;
}
/**
 * The graph's own answer to "which AI should my `default` AI nodes use?",
 * set once in the editor instead of once per node. It is the lowest-priority
 * source: an AI_GRAPH_AI_PROVIDER environment variable, an ai-settings.json
 * beside the deployed tool, or a CLI flag all override it at run time, which
 * is how the same shipped graph runs against a local model on one machine
 * and a hosted endpoint on another. See app.services.ai_settings.
 */
export interface AIDefaults {
  model: string;
  provider:
    'default' | 'ollama' | 'openai' | 'openai_compatible' | 'anthropic' | 'lmstudio' | 'google' | 'github_copilot';
}
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
 */
export interface NodeConfig {
  ai_model: string;
  ai_provider:
    'default' | 'ollama' | 'openai' | 'openai_compatible' | 'anthropic' | 'lmstudio' | 'google' | 'github_copilot';
  batch_concurrency: number;
  batch_mode: 'per_item' | 'whole_list';
  catch_errors?: boolean;
  code: string;
  code_file: string;
  code_prompt: string;
  data_format: 'text' | 'structure';
  data_format_prompt: string;
  data_prompt: string;
  data_value?: unknown;
  example_file: string;
  extensions: string;
  gui_widgets: GuiWidget[];
  input_mode: 'text' | 'file' | 'directory';
  output_format: 'text' | 'json' | 'csv' | 'csv_list' | 'custom' | 'example';
  output_format_prompt: string;
  /** An answer to imitate, recorded from a test run (`output_format: 'example'`). */
  output_example?: string;
  /** The message an ai node sends, with `{{port}}` where a port's value goes. Empty: send what arrived. */
  prompt_template?: string;
  /** Tool servers an ai node may call, one per line: a URL, or a name this machine configured. */
  mcp_servers?: string;
  output_label: string;
  prompt_at_runtime: boolean;
  read_file_inputs: boolean;
  recursive: boolean;
  select_all_files: boolean;
  selector_code: string;
  selector_prompt: string;
  send_images: boolean;
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
 */
export interface GuiWidget {
  code?: string;
  code_file: string;
  code_prompt: string;
  example_file: string;
  extensions: string;
  h?: number;
  id: string;
  kind: GuiWidgetKind;
  label: string;
  mode?: string;
  recursive: boolean;
  select_all_files: boolean;
  selector_code: string;
  selector_prompt: string;
  tone: 'plain' | 'raised' | 'sunken' | 'accent';
  /** Draw a frame regardless of the tone; unset lets the tone decide. */
  border?: boolean;
  /** A background colour of your own; empty lets the tone decide. */
  background?: string;
  /** Turn a failure in this block into an error port instead of ending the run. */
  catch_errors?: boolean;
  /** Using this block starts the graph at whatever it is wired to. */
  run_on_change?: boolean;
  /** `select`: its choices, one per line. */
  options?: string;
  /** `slider`: the range and increment it moves in. */
  min?: number;
  max?: number;
  step?: number;
  value?: unknown;
  w?: number;
}
export interface Port {
  data_type: DataType;
  debug_directory?: string | null;
  description: string;
  format?: string | null;
  id: string;
  kind: PortKind;
  multi: boolean;
  name: string;
  required: boolean;
}
export interface NodePosition {
  x: number;
  y: number;
}
export interface ExecutionResult {
  duration_ms?: number | null;
  error?: string | null;
  outputs: {
    [k: string]: unknown;
  };
  graph_id?: string | null;
  node_results: NodeResult[];
  /** What memory nodes kept from this run, to be replayed into the editor's copy of the graph. */
  memory?: { node_id: string; port_id: string; value: unknown }[];
  status: ExecutionStatus;
}
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
  /** What a page node shows, per block id: what arrived, through the block's own transform. */
  display?: { [k: string]: unknown };
  /** Why a node was left alone: nothing arrived that it needs, or the run was stopped. */
  messages?: string[];
  status: ExecutionStatus;
}
/**
 * A file/directory path that must be supplied before the graph can run.
 */
export interface RuntimeRequirement {
  current_value: string;
  direction: 'input' | 'output';
  kind: 'text' | 'file' | 'directory';
  label: string;
  node_id: string;
  widget_id?: string | null;
}
