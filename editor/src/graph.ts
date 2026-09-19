// The graph as the editor sees it.
//
// The engine's `graph.ts` is the format's home, and everything the *graph
// file* means comes from there: ports, edges, node types, block kinds, a run's
// result. What this adds is one view the engine deliberately does not have:
// every element's settings spelled out in `NodeConfig`, because a config panel
// reads `node.config.temperature` and wants a type there, while the engine
// treats a config as opaque and lets each element read its own.
//
// That is the only difference, and it is a narrowing: an editor graph *is* an
// engine graph (it is sent as one), and an engine graph read back is taken as
// the editor's view in one place, `api/client.ts`.

import type {
  DataType, ExecutionResult, Graph as EngineGraph, GraphEdge, GraphMetadata as EngineMetadata,
  GraphNode as EngineNode, NodeResult, NodeType, Port, PortKind, WidgetKind,
} from '@engine/graph.ts';

export type { DataType, EngineGraph, ExecutionResult, GraphEdge, NodeResult, NodeType, Port, PortKind, WidgetKind };

export type AIProvider =
  'default' | 'ollama' | 'openai' | 'openai_compatible' | 'anthropic' | 'lmstudio' | 'google' | 'github_copilot';

/** A node's state on the canvas: what a run said about it, or that one is under way. */
export type ExecutionStatus = NodeResult['status'] | ExecutionResult['status'] | 'pending' | 'running';

export interface Graph {
  metadata: GraphMetadata;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphMetadata extends EngineMetadata {
  /**
   * The graph's own answer to "which AI should my `default` AI nodes use?".
   * The lowest-priority source: the environment, an `ai-settings.json` beside
   * a deployed tool, or a CLI flag override it at run time.
   */
  ai_defaults: { provider: AIProvider; model: string };
  gui_scheme: 'night' | 'paper' | 'office' | 'graphite' | 'anthracite';
}

export interface GraphNode extends Omit<EngineNode, 'config'> {
  config: NodeConfig;
}

/**
 * Every element's settings, in one type. A type, not an interface, so an
 * editor node is assignable to the engine's `Record<string, unknown>` config.
 */
export type NodeConfig = {
  ai_model: string;
  ai_provider: AIProvider;
  batch_concurrency: number;
  batch_mode: 'per_item' | 'whole_list';
  catch_errors?: boolean;
  code: string;
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
  /** A code node's output interface (JSON Schema), set from a run: `output.schema.json` in a project. */
  output_schema?: unknown;
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
};

/**
 * One block on a page. Ports are never edited by hand: they are derived from
 * this list by the engine (`GuiNodeElement.derivedPorts`), so a block's `id` must
 * stay stable once assigned -- it is what keeps edges attached across edits.
 */
export type GuiWidget = {
  code?: string;
  code_prompt: string;
  example_file: string;
  extensions: string;
  h?: number;
  id: string;
  kind: WidgetKind;
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
};
