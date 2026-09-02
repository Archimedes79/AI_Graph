// The graph as it is stored and as the engine sees it.
//
// One difference from the Python model this replaces, and it is the point of
// the rewrite: **a node's config is opaque here.** It used to be a record of 32
// fields shared by six node types, and a widget's a record of 18 shared by
// eight kinds, so a divider carried a file-selector prompt and a data node
// carried twenty-eight fields it never read. Which fields belonged to whom was
// written down separately, as `config_fields`, and enforced by a test that
// parsed each element's source code — a lint doing a type system's job.
//
// Here the element owns its config type (see `element.ts`). This file knows a
// config is an object; only the element knows what is in it.


export type NodeType = 'input' | 'ai' | 'code' | 'data' | 'output' | 'gui';

export type WidgetKind =
  | 'input_picker' | 'text_io' | 'plot_window' | 'image_view'
  | 'table' | 'text' | 'divider' | 'spacer'
  | 'select' | 'slider' | 'button';

export type PortKind = 'input' | 'output';

export type DataType =
  | 'text' | 'number' | 'boolean' | 'json' | 'file_path' | 'image' | 'any';

export interface Port {
  id: string;
  name: string;
  kind: PortKind;
  data_type: DataType;
  /** Accepts (or emits) a list rather than one value. */
  multi: boolean;
  required: boolean;
  description: string;
  /** How a wired file is read, when the element reads files at all. */
  format?: string | null;
}

/** An element's stored settings. Its own element narrows this; nothing else may. */
export type RawConfig = Record<string, unknown>;

export interface GraphNode {
  id: string;
  node_type: NodeType;
  label: string;
  description: string;
  position: { x: number; y: number };
  inputs: Port[];
  outputs: Port[];
  config: RawConfig;
  width?: number | null;
  height?: number | null;
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
  ai_defaults: { provider: string; model: string };
  created_at?: string | null;
  updated_at?: string | null;
  gui_scheme: string;
}

export interface Graph {
  metadata: GraphMetadata;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type NodeStatus = 'success' | 'error' | 'partial' | 'skipped';

export interface NodeResult {
  node_id: string;
  status: NodeStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error?: string | null;
  messages?: string[];
}

export interface ExecutionResult {
  status: 'success' | 'error' | 'partial';
  node_results: NodeResult[];
  outputs: Record<string, unknown>;
  error?: string | null;
}

/** A port a widget contributes, named after the widget so ids stay unique. */
export function widgetPortId(widgetId: string, kind: PortKind): string {
  return `${widgetId}_${kind === 'input' ? 'in' : 'out'}`;
}

const DEFAULT_METADATA: GraphMetadata = {
  name: 'Untitled Graph',
  version: '1.0.0',
  description: '',
  author: '',
  tags: [],
  ai_defaults: { provider: 'default', model: '' },
  gui_scheme: 'night',
};

/**
 * Read a graph from parsed JSON, filling in what an older file omits.
 *
 * Deliberately forgiving about *shape* and strict about *identity*: a file
 * missing `metadata.tags` is a file from last month, while a node without an
 * id is not a graph. Per-field migrations belong to the element that owns the
 * field, not here — that is what stopped `graph.py` from accumulating a
 * `_migrate_…` function per historical mistake.
 */
export function parseGraph(raw: unknown): Graph {
  if (!raw || typeof raw !== 'object') throw new Error('Not a graph: expected an object.');
  const source = raw as Record<string, unknown>;
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const edges = Array.isArray(source.edges) ? source.edges : [];

  return {
    metadata: { ...DEFAULT_METADATA, ...(source.metadata as object ?? {}) },
    nodes: nodes.map(parseNode),
    edges: edges.map(parseEdge),
  };
}

function parseNode(raw: unknown): GraphNode {
  const n = raw as Record<string, unknown>;
  if (typeof n?.id !== 'string' || typeof n?.node_type !== 'string') {
    throw new Error('Not a node: every node needs an id and a node_type.');
  }
  return {
    id: n.id,
    node_type: n.node_type as NodeType,
    label: String(n.label ?? n.id),
    description: String(n.description ?? ''),
    position: (n.position as GraphNode['position']) ?? { x: 0, y: 0 },
    inputs: (n.inputs as Port[]) ?? [],
    outputs: (n.outputs as Port[]) ?? [],
    config: (n.config as RawConfig) ?? {},
    width: (n.width as number) ?? null,
    height: (n.height as number) ?? null,
  };
}

function parseEdge(raw: unknown): GraphEdge {
  const e = raw as Record<string, unknown>;
  for (const field of ['id', 'source_node_id', 'source_port_id', 'target_node_id', 'target_port_id']) {
    if (typeof e?.[field] !== 'string') throw new Error(`Not an edge: ${field} is missing.`);
  }
  return e as unknown as GraphEdge;
}
