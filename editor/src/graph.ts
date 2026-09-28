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

/** What a run said: about one node, or about the whole run. */
export type ExecutionStatus = NodeResult['status'] | ExecutionResult['status'];

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
  /** code, ai and subgraph only (`NodeRunner.fansOut`): how many items of a fan-out run at once, 0 for the run's default. */
  batch_concurrency: number;
  /** code, ai and subgraph only: run once per item. */
  batch_mode: 'per_item' | 'whole_list';
  catch_errors: boolean;
  code: string;
  /**
   * An ai node's instructions, with {Node Description} and {Output Definition}
   * filled in when it runs: `prompt.md` in a project. Empty: the standard ones.
   */
  prompt: string;
  /** What one call of a code or ai node is handed: `input.js`, a JSDoc typedef and one example. See engine `authoring/definition.ts`. */
  input_definition?: string;
  /** What one call of a code or ai node returns: `output.js`. Its example's keys are the outputs. */
  output_definition?: string;
  /** Every exchange with the model about the node: `history.md`. See engine `authoring/history.ts`. */
  history?: string;
  /** The ✨ prompts someone changed, by what they write; the others are the standard ones (`authoring/prompts.ts`). */
  prompts?: Partial<Record<'input' | 'output' | 'body', string>>;
  /** The files ✨ Input writes a code or ai node's input definition from -- examples, a spec; none: the one the graph hands it. */
  input_files?: string[];
  /** The files ✨ Output writes its output definition from, where it is given some. */
  output_files?: string[];
  /** A data node: what kind of value it holds. */
  data_format: 'text' | 'structure';
  /** A data node: the value it holds, and hands on until something arrives. */
  data_value?: unknown;
  extensions: string;
  gui_widgets: GuiWidget[];
  input_mode: 'text' | 'directory';
  /** Tool servers an ai node may call, one per line: a URL, or a name this machine configured. */
  mcp_servers?: string;
  /** A trigger node: fire when the tool starts, and again this often (`5m`). */
  trigger_on_start: boolean;
  trigger_every: string;
  /** The graph a subgraph node holds: its own project folder on disk. */
  subgraph?: unknown;
  prompt_at_runtime: boolean;
  recursive: boolean;
  send_images: boolean;
  /** Unset: the model's own default -- current Claude models refuse one at all. */
  temperature?: number;
  value?: string | null;
  /** An output node: also write the run's result to a file, or one file per value into a folder. */
  write_mode: 'none' | 'file' | 'directory';
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
