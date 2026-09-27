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

/**
 * An edge as the canvas holds it, which port of which node feeds which: the
 * loose shape a ReactFlow edge satisfies, handles possibly null. Not the saved
 * `GraphEdge`, whose fields are named for the file.
 */
export type Wire = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };

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
  /** code and ai only (`NodeRunner.fansOut`): how many items of a fan-out run at once, 0 for the run's default. */
  batch_concurrency: number;
  /** code and ai only: run once per item. */
  batch_mode: 'per_item' | 'whole_list';
  catch_errors: boolean;
  code: string;
  code_prompt: string;
  data_format: 'text' | 'structure';
  data_format_prompt: string;
  data_prompt: string;
  data_value?: unknown;
  extensions: string;
  gui_widgets: GuiWidget[];
  input_mode: 'text' | 'file' | 'directory';
  /** The output format in words: `output.md` in a project. */
  output_format_prompt: string;
  /** The message an ai node sends, with `{{port}}` where a port's value goes. Empty: send what arrived. */
  prompt_template?: string;
  /** An ai node's `run.js` when somebody changed it; absent or empty for the standard one. */
  run_code?: string;
  /** Inputs and what must come out, as Markdown: `examples.md` in a project. See engine `execution/examples.ts`. */
  examples?: string;
  /** A code node's output interface (JSON Schema), set from a run: in its `interface.json` in a project. */
  output_schema?: unknown;
  /** Tool servers an ai node may call, one per line: a URL, or a name this machine configured. */
  mcp_servers?: string;
  /** A trigger node: fire when the tool starts, and again this often (`5m`). */
  trigger_on_start: boolean;
  trigger_every: string;
  /** The graph a subgraph node holds: its own project folder on disk. */
  subgraph?: unknown;
  /** What a node is meant to do, written before it is filled in: `task.md` in a project. */
  task: string;
  output_label: string;
  prompt_at_runtime: boolean;
  recursive: boolean;
  send_images: boolean;
  system_prompt: string;
  /** Unset: the model's own default -- current Claude models refuse one at all. */
  temperature?: number;
  value?: string | null;
  write_mode: 'none' | 'file' | 'directory' | 'window';
};

/**
 * One block on a page. Ports are never edited by hand: they are derived from
 * this list by the engine (`GuiNodeRunner.derivedPorts`), so a block's `id` must
 * stay stable once assigned -- it is what keeps edges attached across edits.
 *
 * Beyond who it is and how it is drawn, a block holds only its own kind's
 * settings, so they are optional here: a divider has no options, and a block
 * written by hand, by ✨ or over MCP leaves out what it does not set. Read one
 * the way its runner does -- `recursive` missing means only the folder itself.
 */
export type GuiWidget = {
  /** `input_picker`: the file types a folder's listing keeps. */
  extensions?: string;
  h?: number;
  id: string;
  kind: WidgetKind;
  label: string;
  mode?: string;
  /** `input_picker`: a folder's listing looks into its subfolders too. */
  recursive?: boolean;
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
