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
// Here the element owns its config type (see `elements/ElementRunner.ts`). This file knows a
// config is an object; only the element knows what is in it.

export type NodeType = 'input' | 'ai' | 'code' | 'data' | 'output' | 'gui' | 'subgraph' | 'trigger';

export type WidgetKind =
  | 'input_picker' | 'text_io' | 'plot_window' | 'image_view'
  | 'table' | 'text' | 'divider' | 'spacer'
  | 'select' | 'slider' | 'button' | 'chat';

export type PortKind = 'input' | 'output';

/**
 * What a port carries. A label for people and for generation, with one
 * exception the engine acts on: a `file_path` input is what `read_file_inputs`
 * reads. One list, used by the editor too.
 */
export type DataType =
  | 'text' | 'number' | 'boolean' | 'json' | 'list' | 'file_path' | 'image' | 'binary' | 'any';

export interface Port {
  id: string;
  name: string;
  kind: PortKind;
  data_type: DataType;
  /** Accepts (or emits) a list rather than one value. */
  multi: boolean;
  required: boolean;
  description: string;
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

/**
 * A graph's own settings. Keys an older file carries beside these -- a
 * `version`, an `author`, `tags` -- are nobody's to read, and are kept as the
 * file wrote them.
 */
export interface GraphMetadata {
  name: string;
  description: string;
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
  /** What came off the wires: paths rather than file contents, raw rather than reshaped. */
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  /**
   * What a node with an interface shows, per block id -- after the block's own
   * transform, which is why it is not `inputs`: those say what arrived, this
   * says what is on the screen.
   */
  display?: Record<string, unknown>;
  error?: string | null;
  messages?: string[];
  /**
   * The node did not run this round -- its ◆ stayed shut, or nothing new
   * reached it -- and `outputs` is what it was left holding from an earlier one.
   */
  held?: boolean;
}

/** One value a memory node kept from a run: which node, arriving on which port. */
export interface MemoryWrite {
  node_id: string;
  port_id: string;
  value: unknown;
}

export interface ExecutionResult {
  status: 'success' | 'error' | 'partial' | 'cancelled';
  node_results: NodeResult[];
  outputs: Record<string, unknown>;
  /**
   * Everything memory nodes kept, in order. The run settled its own copy of the
   * graph; whoever holds another copy replays this into it (`applyMemory`).
   */
  memory?: MemoryWrite[];
  error?: string | null;
}

/**
 * Put what a run remembered into another copy of the graph.
 *
 * The one way memory travels: the engine decides what was kept, each element
 * decides where it keeps it, and a holder of the graph -- the editor's store, a
 * served page, the scheduler between rounds -- only replays.
 */
export function applyMemory(
  nodes: GraphNode[],
  memory: MemoryWrite[] | undefined,
  settle: (node: GraphNode, portId: string, value: unknown) => void,
): void {
  for (const write of memory ?? []) {
    const node = nodes.find((candidate) => candidate.id === write.node_id);
    if (node) settle(node, write.port_id, write.value);
  }
}

/**
 * A graph's settings when nothing says otherwise: a new graph's, and what an
 * older file that leaves one out means. The one statement of them -- the
 * editor starts a new graph from it, and `flow.json` leaves out what equals
 * it. A fresh object each call, so no two graphs share one.
 *
 * Which AI a graph calls is not among them: that is the machine's one AI
 * setting (`ai/settings.ts`), or a node's own pin.
 */
export function defaultMetadata(): GraphMetadata {
  return {
    name: 'Untitled Graph',
    description: '',
    gui_scheme: 'night',
  };
}

/**
 * Read a graph from parsed JSON, filling in what an older file omits.
 *
 * Deliberately forgiving about *shape* and strict about *identity*: a file
 * missing `metadata.gui_scheme` is a file from last month, while a node without an
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
    metadata: { ...defaultMetadata(), ...(source.metadata as object ?? {}) },
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
