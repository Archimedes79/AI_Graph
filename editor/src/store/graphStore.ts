import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Node, Edge } from 'reactflow';
import type { Graph, GraphNode, GraphEdge, GraphMetadata, ExecutionResult, NodeType } from '@/graph';
import type { RFNodeData } from './nodeData';
import type { PortRenames } from './portRenames';
import { derivedNodePorts, showsPage } from '@/document/guiWidgets';
import { call, type RunTrigger } from '@/api/client';
import { errorText } from '@/api/errorText';
import { ACCENT } from '@/ui/theme';
import { delivered } from './executionStatus';
import { NODE_KINDS, savedNode } from '@/document/nodeKinds';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import { RUN_PORT } from '@engine/execution/triggers.ts';
import type React from 'react';
import { applyMemory, defaultMetadata as engineDefaults } from '@engine/graph.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { parseWidget } from '@engine/elements/nodes/gui/GuiNodeRunner.ts';
import { inferInterface, type Schema } from '@engine/execution/interface.ts';
import type { TextChange } from '@engine/host/api.ts';
import { NESTED_GRAPH_FIELD } from '@engine/project/changes.ts';
import { freeId } from '@/document/ids';
import { graphEdge } from '@/document/wires';
import { wireOf } from '@engine/project/flow.ts';

type RFNode = Node<RFNodeData>;

export interface GraphStore {
  // ReactFlow state
  rfNodes: Node<RFNodeData>[];
  rfEdges: Edge[];

  // Graph metadata
  metadata: GraphMetadata;

  // Absolute server-side path this graph was last loaded from/saved to, or
  // null for an untitled graph -- lets "Save" write back to it directly.
  currentFilePath: string | null;
  /** The path is a project folder: its code and prompts are files that may change outside. */
  isProject: boolean;

  // Execution state
  executionResult: ExecutionResult | null;
  isExecuting: boolean;

  /**
   * The graphs this one is inside, outermost first: one frame per node that
   * was opened, each with the undo history of its own level.
   *
   * One document is open at a time, and going into a node swaps which. That
   * keeps the canvas, the run button and undo exactly as they are, and it is
   * why nothing in here says "subgraph" twice.
   */
  subgraphStack: { nodeId: string; graph: Graph; past: string[]; future: string[] }[];

  /**
   * Which graph is open: one more each time another is loaded, or the canvas
   * goes into a node's graph or back out. Work that takes a while -- a run, a
   * ✨ sweep -- notes it when it starts, and writes nothing into a graph that
   * is not the one it started on: node ids repeat from graph to graph
   * (`code`, `ai_2`), and a result landing by id lands on a stranger.
   */
  document: number;

  // Serialised graph as of the last load/save, for `isDirty`.
  savedSnapshot: string | null;

  // Undo history: serialised graphs, oldest first. `past` holds states before
  // each committed change, `future` the ones an undo stepped back out of.
  past: string[];
  future: string[];

  /** Live progress of the run in flight, or null when nothing is running. */
  runProgress: {
    completed: number;
    total: number;
    label: string;
    itemDone: number;
    itemTotal: number;
    idleSeconds: number | null;
  } | null;
  /** Id of the run in flight, so it can be stopped. */
  currentRunId: string | null;

  // UI state
  editingNodeId: string | null;

  // Actions
  setMetadata: (meta: Partial<GraphMetadata>) => void;
  setCurrentFilePath: (path: string | null, isProject?: boolean) => void;
  /**
   * Add a node and return its id, so a caller can immediately fill it in --
   * or, with *fill*, as it is made, in the same undo step: the page's first
   * block and the page it makes are one change.
   */
  addNode: (nodeType: NodeType, position: { x: number; y: number }, fill?: (node: GraphNode) => GraphNode) => string;
  /**
   * `renamed` maps a port's old id to its new one, per side, so the wires
   * follow the rename instead of being pruned as "a port that vanished" --
   * and to null for a port that was removed, whose wires go even when another
   * port has been given its name since (`portRenames`). `coalesce` makes it
   * one undo step with the change just before it of the same name (`commit`).
   */
  updateNode: (
    nodeId: string,
    updates: Partial<GraphNode>,
    renamed?: PortRenames,
    coalesce?: string,
  ) => void;
  /**
   * Wire one port to another: what dragging from a handle to a handle does.
   * Here and not in the canvas, so that a graph can be built -- and a test can
   * build one -- without a mouse. The same wire twice is one wire.
   */
  connect: (wire: { source: string; sourceHandle: string; target: string; targetHandle: string }) => void;
  deleteNode: (nodeId: string) => void;
  setRFNodes: (nodes: Node<RFNodeData>[]) => void;
  setRFEdges: (edges: Edge[]) => void;
  setEditingNode: (nodeId: string | null) => void;
  /**
   * `ran` is the part of *result* that is new, when a page event re-ran only
   * some nodes and the rest was kept from before. Memory is settled from that
   * part alone: settling a kept result again would add last turn's answer to a
   * conversation a second time.
   */
  setExecutionResult: (result: ExecutionResult | null, ran?: ExecutionResult) => void;
  loadGraph: (graph: Graph) => void;
  /**
   * An empty graph with the engine's default settings, as a document of its
   * own: nothing of the one before it -- its pinned AI, its colour scheme,
   * its undo steps -- carries over.
   */
  newGraph: () => void;
  exportGraph: () => Graph;
  /** Go into the graph a node holds. It becomes the open document. */
  openSubgraph: (nodeId: string) => void;
  /** Come back out one level, putting what was edited back into the node that holds it. */
  closeSubgraph: () => void;
  /**
   * Come back out until *depth* levels are left -- 0 is the graph at the top --
   * or as far as a run in flight allows: a level that will not close ends it,
   * where asking again would ask forever.
   */
  closeSubgraphsTo: (depth: number) => void;
  /**
   * The whole document: what is open, folded back through every node it is
   * inside. What is saved, and what "unsaved" is measured against, whatever
   * level the canvas happens to be showing.
   */
  rootGraph: () => Graph;
  /**
   * Whether the graph differs from the last loaded or saved version.
   *
   * Computed by comparing the exported graph against a snapshot rather than
   * tracked with a flag on every mutation: ReactFlow reports a plain click as a
   * node change, so a flag would mark a freshly opened graph dirty and train
   * the user to click through the confirmations that exist to protect them.
   * Selection is not part of the exported graph, so this cannot fire on it;
   * moving a node, which is a real change, does.
   */
  /**
   * Record the current graph as an undo point, BEFORE the change about to be
   * made. Committing an identical state twice is a no-op, which is what keeps a
   * delete that arrives through two paths (the node's own button and ReactFlow's
   * remove change) from costing two presses of Ctrl+Z.
   *
   * *coalesce* names the change -- a node and the fields a dialog wrote. A
   * change of the same name within a moment of the last one adds to that
   * one's undo step instead of taking one of its own: a word typed into a
   * field is one step, not one per keystroke. Anything else in between -- an
   * unnamed change, an undo, another document -- ends it.
   */
  commit: (coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Internal: replace the graph with a serialised snapshot (used by undo/redo).
   * *keepEditing*: the node dialog stays open when its node is still there --
   * Undo takes back what it changed, and it shows what Undo left.
   */
  applyGraphSnapshot: (json: string, keepEditing?: boolean) => void;
  isDirty: () => boolean;
  /** Record the current graph as saved (after a successful write to disk). */
  markSaved: () => void;
  /**
   * Write the whole document to *path* -- the one it was opened from or last
   * saved to, when none is given -- and be at the path it was written to.
   *
   * What counts as saved is the graph that was sent, not the one there is when
   * the write comes back: an edit made while it was on its way is not on disk,
   * and must still read as unsaved. Save, Save As and both "Open in my editor"
   * buttons each wrote this out, and each marked the later graph saved.
   */
  save: (path?: string) => Promise<{ path: string }>;
  /**
   * Take in code and prompts that changed in the project folder on disk.
   *
   * One undo step, so a change from another editor can be taken back like any
   * other. What is on disk is saved by definition: a graph that was clean stays
   * clean, and one with unsaved edits keeps exactly those.
   */
  /** Returns the nodes whose graph was left on disk because there is unsaved work here. */
  takeDiskChanges: (changes: TextChange[]) => string[];
  /**
   * Execute *graph* and put the whole outcome into the store: the result, the
   * busy flag, and a synthesised error result if the request itself fails.
   *
   * Lives here rather than in a component because the store already owns every
   * piece of state it touches, and because two front-ends need it -- the
   * editor's toolbar and the deployed runtime page. They had a copy each, and
   * the copies had already drifted.
   *
   * One at a time: asked while a run is going, it does nothing. A run that
   * ends after another graph was opened (`document`) is dropped, not shown.
   */
  runGraph: (graph: Graph, trigger?: RunTrigger | null) => Promise<void>;
  /**
   * Empty the boxes whose content was a message rather than a setting, once a
   * run has delivered it. Only for pages that ran, and only when they ran
   * cleanly: a message that reached nobody should still be there to send again.
   * Only what *sent* sent: a box typed into again while the run went on holds
   * the next message, not the one delivered.
   */
  clearSentValues: (result: ExecutionResult, sent: Graph) => void;
  /** Stop the run in flight. Nodes already finished keep their results. */
  stopRun: () => Promise<void>;
}

/**
 * A partial run laid over what the page already showed.
 *
 * The nodes that ran replace their old results; the ones that were not asked
 * keep theirs. A page is the one node that is *partly* re-run -- one of its
 * displays got a new value, the others did not -- so what it received and what
 * it shows are merged block by block rather than replaced.
 */
export function mergeResults(previous: ExecutionResult, fresh: ExecutionResult): ExecutionResult {
  const ran = new Map(fresh.node_results.map((r) => [r.node_id, r]));
  const kept = previous.node_results
    .filter((r) => !ran.has(r.node_id));
  const merged = fresh.node_results.map((r) => {
    const before = previous.node_results.find((old) => old.node_id === r.node_id);
    return before
      ? { ...r, inputs: { ...before.inputs, ...r.inputs }, display: { ...before.display, ...r.display } }
      : r;
  });
  return { ...fresh, node_results: [...kept, ...merged], outputs: { ...previous.outputs, ...fresh.outputs } };
}

/**
 * A wire that carries a value, and one that only says "start here".
 *
 * Drawn differently because they *are* different: a run edge delivers nothing,
 * and a canvas where it looks like data invites the question of what the AI
 * node does with a button's `true`. Dashed and amber reads as a signal.
 */
export function edgeStyle(targetPort: string | null | undefined): React.CSSProperties {
  return targetPort === RUN_PORT
    ? { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 4' }
    : { stroke: ACCENT, strokeWidth: 2 };
}

/**
 * Where a node goes that nobody put anywhere -- a palette click, the page a
 * first block makes: to the right of what is already there, not on top of it.
 * A random spot put the second node on the first more often than not, and a
 * graph reads left to right anyway. The gap is generous because a node widens
 * once it is configured and must not then cover its neighbour.
 */
export function besideTheRest(placed: Node[]): { x: number; y: number } {
  if (!placed.length) return { x: 200, y: 120 };
  const right = Math.max(0, ...placed.map((node) => node.position.x + (node.width ?? 240)));
  return { x: right + 160, y: Math.min(...placed.map((node) => node.position.y)) };
}

let nodeCounter = 1;
function newId(prefix: string) {
  return `${prefix}-${nodeCounter++}-${Date.now()}`;
}

function normalizeMetadata(metadata: Partial<GraphMetadata> | undefined): GraphMetadata {
  return { ...defaultMetadata(), ...(metadata ?? {}) };
}

function normalizeGraphNode(rawNode: Partial<GraphNode>): GraphNode {
  const nodeType = rawNode.node_type ?? 'input';
  const nodeId = rawNode.id ?? newId(nodeType);
  const defaults = NODE_KINDS[nodeType].create(nodeId);

  const node: GraphNode = {
    ...defaults,
    ...rawNode,
    id: nodeId,
    node_type: nodeType,
    position: {
      ...defaults.position,
      ...(rawNode.position ?? {}),
    },
    inputs: Array.isArray(rawNode.inputs) ? rawNode.inputs : defaults.inputs,
    outputs: Array.isArray(rawNode.outputs) ? rawNode.outputs : defaults.outputs,
    // A key the file left out means what the engine reads it as -- its one
    // default -- not what a new node starts with: loading and saving must not
    // change what a graph does.
    config: { ...baseNodeConfig(), ...(rawNode.config ?? {}) },
  };

  // Where the element derives its ports -- a gui node from its blocks, an
  // input node from its mode, a subgraph node from the graph it holds -- they
  // come from the element, never from what a file, an import or a model said.
  // The engine works them out the same way (`portsOf` in `wiring.ts`), and a
  // second answer here is a second answer that can disagree.
  const derived = derivedNodePorts(node);
  return derived ? { ...node, ...derived } : node;
}

/**
 * *outer* with *inner* put back into the node it came out of, and that node's
 * ports derived from it again -- an output node added in there is a port out
 * here, and this is the moment that becomes true.
 */
function withNested(outer: Graph, nodeId: string, inner: Graph): Graph {
  return {
    ...outer,
    nodes: outer.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const held = { ...node, config: { ...node.config } };
      engineRegistry.node(held.node_type)?.setNestedGraph(held as never, inner as never);
      return { ...held, ...(derivedNodePorts(held) ?? {}) };
    }),
  };
}

function normalizeGraph(graph: Graph): Graph {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.map((node) => normalizeGraphNode(node)) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  // A wire is taken as the graph says it (`GraphEdge`); one to a node that is
  // not there is dropped, as the engine's `check` would report it.
  const edges = Array.isArray(graph.edges)
    ? graph.edges.filter((edge) => nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id))
    : [];

  return {
    metadata: normalizeMetadata(graph.metadata),
    nodes,
    edges,
  };
}

/** The engine's defaults (`defaultMetadata`), in the editor's typed view of them. */
const defaultMetadata = (): GraphMetadata => engineDefaults() as GraphMetadata;

// How often a run in flight is polled. Fast enough that the node name keeps up
// with a quick graph, slow enough not to flood a local server during a long one.
const RUN_POLL_INTERVAL_MS = 400;

/** How many undo steps are kept. Each entry is a whole serialised graph. */
const HISTORY_LIMIT = 50;

/** How long after a named change the next one of that name still belongs to its undo step (`commit`). */
export const COALESCE_MS = 2000;

/**
 * The last undo step a named change began or added to, and when -- or null
 * when the last change had no name. Not state anybody draws, so not in the
 * store: a change of the same name within `COALESCE_MS` adds to that step.
 */
let coalescing: { key: string; at: number } | null = null;

/** The size a node was given, if it was given one, as ReactFlow lays it out. */
function sizeStyle(node: GraphNode): { style: { width: number; height: number } } | Record<string, never> {
  return typeof node.width === 'number' && typeof node.height === 'number'
    ? { style: { width: node.width, height: node.height } }
    : {};
}

/**
 * The size someone *set* on a canvas node, as opposed to the one it happens to
 * measure.
 *
 * Only the first is worth keeping. A measurement changes with a border, a
 * font, a longer label, the zoom the canvas was at when it was taken -- so
 * saving it means the file differs from itself between two openings, and the
 * editor says "unsaved" about work nobody did.
 */
function setSize(rfn: Node<RFNodeData>): Pick<GraphNode, 'width' | 'height'> {
  const style = rfn.style as { width?: number | string; height?: number | string } | undefined;
  const asked = (value: number | string | undefined) => (typeof value === 'number' ? value : undefined);
  return {
    width: asked(style?.width) ?? rfn.data.graphNode.width,
    height: asked(style?.height) ?? rfn.data.graphNode.height,
  };
}

/**
 * Build the ReactFlow node/edge arrays for a graph. Shared by `loadGraph` and by
 * undo/redo's `applyGraphSnapshot`, so restoring a snapshot can never drift from
 * loading a file -- they were the same twenty lines twice.
 */
function buildReactFlowGraph(graph: Graph) {
  const rfNodes: Node<RFNodeData>[] = graph.nodes.map((gn) => ({
    id: gn.id,
    type: 'graphNode',
    position: { x: gn.position.x, y: gn.position.y },
    // A size goes in `style`, which is what ReactFlow *renders* from and what
    // its resizer writes (`updateStyle: true`). `width`/`height` on a node are
    // its measurement: ReactFlow fills them in once the node is drawn and
    // overwrites whatever was put there. Setting the size there therefore did
    // nothing at all -- a page saved at 340x300 came back at whatever its
    // contents happened to measure -- and the measurement then read as an edit
    // to a graph nobody had touched.
    ...sizeStyle(gn),
    data: { graphNode: gn },
  }));

  const rfEdges: Edge[] = graph.edges.map((ge) => ({
    id: ge.id,
    source: ge.source_node_id,
    sourceHandle: ge.source_port_id,
    target: ge.target_node_id,
    targetHandle: ge.target_port_id,
    type: 'smoothstep',
    animated: false,
    style: edgeStyle(ge.target_port_id),
  }));

  return { rfNodes, rfEdges };
}

/** Whether this node keeps an output interface (in its `interface.json`). */
export function keepsOutputInterface(node: GraphNode): boolean {
  return engineRegistry.node(node.node_type)?.keepsOutputInterface ?? false;
}

/**
 * The output interface *node* is to keep, measured from *outputs* it just
 * produced -- by a run, or by ✨'s probe -- or undefined: when it keeps none,
 * already keeps one, or nothing came out. Kept once, the first time; after
 * that it is the contract the next runs are held to, until its Clear in the
 * node's dialog lets the next one measure it again. One rule for the run, the
 * dialog's ✨ and the sweep's, which each write it where their node is.
 */
export function shapeToKeep(node: GraphNode, outputs: Record<string, unknown> | undefined): Schema | undefined {
  if (!keepsOutputInterface(node) || node.config.output_schema) return undefined;
  return outputs && Object.keys(outputs).length ? inferInterface(outputs) : undefined;
}

export const useGraphStore = create<GraphStore>()(
  immer((set, get) => ({
    rfNodes: [],
    rfEdges: [],
    metadata: defaultMetadata(),
    currentFilePath: null,
    isProject: false,
    executionResult: null,
    isExecuting: false,
    editingNodeId: null,
    subgraphStack: [],
    document: 0,
    savedSnapshot: null,
    past: [],
    future: [],
    runProgress: null,
    currentRunId: null,

    setMetadata: (meta) =>
      set((state) => {
        Object.assign(state.metadata, meta);
      }),

    setCurrentFilePath: (path, isProject = false) =>
      set((state) => {
        state.currentFilePath = path;
        state.isProject = path !== null && isProject;
      }),

    addNode: (nodeType, position, fill) => {
      get().commit();
      const id = freeId(nodeType, get().rfNodes.map((existing) => existing.id));
      const kind = NODE_KINDS[nodeType];
      const made = kind.create(id);
      const defaults = kind.placedAmong?.(made, get().rfNodes.map((existing: RFNode) => existing.data.graphNode)) ?? made;
      const rfNode: Node<RFNodeData> = {
        id,
        type: 'graphNode',
        position,
        data: { graphNode: fill ? fill(defaults) : defaults },
      };
      set((state) => {
        state.rfNodes.push(rfNode as never);
      });
      return id;
    },

    connect: (wire) => {
      // Named the way flow.json writes a wire, and known by its two ends: a
      // graph pasted in or designed by ✨ may call its wires anything.
      const id = wireOf(graphEdge(wire));
      const joins = (edge: Edge): boolean => edge.source === wire.source && edge.target === wire.target
        && (edge.sourceHandle ?? '') === (wire.sourceHandle ?? '') && (edge.targetHandle ?? '') === (wire.targetHandle ?? '');
      if (get().rfEdges.some(joins)) return;
      get().commit();
      set((state) => {
        state.rfEdges.push({ ...wire, id, type: 'smoothstep', style: edgeStyle(wire.targetHandle) } as never);

        // A wire from a port that carries file paths -- a picker, a folder --
        // ticks "Read the file at this path" on the input it ends on: the port
        // is typed `file_path`, and a code or AI node is handed the file's
        // text there. Step 1 can untick it; this is so that nobody has to say
        // it, because the wire already did and a graph wired without it
        // summarised the file's *name*. The run itself asks only the port.
        const portOf = (nodeId: string, side: 'inputs' | 'outputs', portId: string) => state.rfNodes
          .find((node: RFNode) => node.id === nodeId)?.data.graphNode[side].find((port) => port.id === portId);
        const from = portOf(wire.source, 'outputs', wire.sourceHandle);
        const to = portOf(wire.target, 'inputs', wire.targetHandle);
        // Not on a node whose ports follow from its settings (a page, an input): those are recomputed.
        const target = state.rfNodes.find((node: RFNode) => node.id === wire.target)?.data.graphNode;
        const own = !!target && derivedNodePorts(target as GraphNode) === null;
        // Only a port with nobody's word on it. A port typed `text` said what it
        // wants -- a file reader takes the same picker twice, one to read and one
        // to keep the name -- and the engine reads it the same way
        // (`execution/fileInputs.ts`: the target's own type wins).
        if (own && from?.data_type === 'file_path' && to && to.data_type === 'any') {
          to.data_type = 'file_path';
          if (from.multi) to.multi = true;
        }
      });
    },

    updateNode: (nodeId, updates, renamed, coalesce) => {
      get().commit(coalesce);
      set((state) => {
        const idx = state.rfNodes.findIndex((n: RFNode) => n.id === nodeId);
        if (idx !== -1) {
          const existing = state.rfNodes[idx].data.graphNode;
          const updated = { ...existing, ...updates } as GraphNode;
          state.rfNodes[idx].data.graphNode = updated;

          // A port that was renamed keeps its wires. Without this the rename
          // would look like "the old port is gone" to the pruning below, and
          // renaming `input` to `csv` would quietly cut the graph in half. A
          // port that was removed loses them here, by name, because the
          // pruning below cannot tell it from a new port given the same name.
          if (renamed) {
            const fate = (map: Record<string, string | null>, handle: string | null | undefined) =>
              (handle && Object.prototype.hasOwnProperty.call(map, handle) ? map[handle] : undefined);
            const cut = new Set<Edge>();
            for (const edge of state.rfEdges as Edge[]) {
              const into = edge.target === nodeId ? fate(renamed.inputs, edge.targetHandle) : undefined;
              const from = edge.source === nodeId ? fate(renamed.outputs, edge.sourceHandle) : undefined;
              if (into === null || from === null) { cut.add(edge); continue; }
              if (into) edge.targetHandle = into;
              if (from) edge.sourceHandle = from;
            }
            if (cut.size) state.rfEdges = state.rfEdges.filter((edge: Edge) => !cut.has(edge));
          }

          // Ports may have shrunk (e.g. a removed GUI widget) -- prune any
          // edges that now dangle off a port id that no longer exists,
          // mirroring the edge cleanup deleteNode already does.
          if (updates.inputs || updates.outputs) {
            const inputIds = new Set(updated.inputs.map((p) => p.id));
            const outputIds = new Set(updated.outputs.map((p) => p.id));
            state.rfEdges = state.rfEdges.filter((e: Edge) => {
              // The run port is every node's and nobody's: it is never in the list.
              if (e.target === nodeId && e.targetHandle && e.targetHandle !== RUN_PORT && !inputIds.has(e.targetHandle)) return false;
              if (e.source === nodeId && e.sourceHandle && !outputIds.has(e.sourceHandle)) return false;
              return true;
            });
          }
        }
      });
    },

    deleteNode: (nodeId) => {
      get().commit();
      set((state) => {
        state.rfNodes = state.rfNodes.filter((n: RFNode) => n.id !== nodeId);
        state.rfEdges = state.rfEdges.filter(
          (e: Edge) => e.source !== nodeId && e.target !== nodeId
        );
      });
    },

    setRFNodes: (nodes) =>
      set((state) => {
        state.rfNodes = nodes as never;
      }),

    setRFEdges: (edges) =>
      set((state) => {
        state.rfEdges = edges;
      }),

    setEditingNode: (nodeId) =>
      set((state) => {
        state.editingNodeId = nodeId;
      }),

    setExecutionResult: (shown, ran) =>
      set((state) => {
        state.executionResult = shown;
        const result = ran ?? shown;
        if (!result) return;

        // What the run remembered, replayed into this copy of the graph. The
        // engine decided what was kept and each element decides where it keeps
        // it; all that happens here is that the long-lived copy catches up with
        // the one the run settled -- so a loop progresses across separate Run
        // clicks, and a conversation keeps its turns.
        applyMemory(
          state.rfNodes.map((n: RFNode) => n.data.graphNode as never),
          result.memory,
          (node, portId, value) => engineRegistry.node(node.node_type)?.settleMemory(node, portId, value),
        );

        // A run is where an output interface comes from: nodes are wired, the
        // graph runs, and what a node actually produced is the first honest
        // statement of its outputs (`shapeToKeep`), the first time it succeeds.
        for (const rfNode of state.rfNodes) {
          const node = rfNode.data.graphNode;
          const ran = result.node_results.find((r) => r.node_id === node.id && r.status === 'success');
          const kept = shapeToKeep(node, ran?.outputs);
          if (kept) node.config.output_schema = kept;
        }
      }),

    loadGraph: (graph) => {
      const normalizedGraph = normalizeGraph(graph);
      const { rfNodes, rfEdges } = buildReactFlowGraph(normalizedGraph);
      coalescing = null;

      set((state) => {
        state.metadata = normalizedGraph.metadata;
        state.rfNodes = rfNodes as never;
        state.rfEdges = rfEdges;
        state.executionResult = null;
        // Whoever loaded a graph without going through the file-path flow
        // (Paste JSON, AI Graph, etc.) doesn't know its file path; the caller
        // sets `currentFilePath` explicitly right after loadGraph when it does.
        state.currentFilePath = null;
        state.isProject = false;
        // A different document: its predecessor's undo steps would restore
        // nodes belonging to a graph that is no longer open, and its frames
        // would fold this one into a node it never came from.
        state.past = [];
        state.future = [];
        state.subgraphStack = [];
        state.editingNodeId = null;
        state.document += 1;
      });
      // Snapshot through exportGraph() rather than from normalizedGraph: it is
      // the same serialisation isDirty() compares against, so a freshly loaded
      // graph is guaranteed to read as clean.
      get().markSaved();
    },

    newGraph: () => get().loadGraph({ metadata: defaultMetadata(), nodes: [], edges: [] }),

    openSubgraph: (nodeId) => {
      // Not while a run is in flight: its result is about to arrive, and it
      // would arrive at a canvas showing a different graph, where node ids
      // that happen to match would be given another level's values.
      if (get().isExecuting) return;
      const node = get().rfNodes.find((n: RFNode) => n.id === nodeId)?.data.graphNode;
      // Whether there is a graph to go into is the same question as whether
      // this node holds one, so it is asked once. A `NodeGuiBuilder.opensNestedGraph`
      // beside it said the same thing a line earlier.
      const held = node && engineRegistry.node(node.node_type)?.nestedGraph(node as never) as Graph | null;
      if (!held) return;

      const frame = { nodeId, graph: get().exportGraph(), past: get().past, future: get().future };
      // Not `loadGraph`: that is for opening a different *document*, and would
      // throw away the frames this one is inside. What changes here is which
      // level the canvas shows.
      get().applyGraphSnapshot(JSON.stringify(held));
      set((state) => {
        state.subgraphStack.push(frame);
        // Its own level, its own history: an undo in here cannot reach out.
        state.past = [];
        state.future = [];
        state.document += 1;
      });
    },

    closeSubgraph: () => {
      if (get().isExecuting) return;
      const { subgraphStack } = get();
      const frame = subgraphStack[subgraphStack.length - 1];
      if (!frame) return;
      const inner = get().exportGraph();
      const merged = withNested(frame.graph, frame.nodeId, inner);
      const before = JSON.stringify(frame.graph);
      const changed = JSON.stringify(merged) !== before;

      get().applyGraphSnapshot(JSON.stringify(merged));
      set((state) => {
        state.subgraphStack.pop();
        // Everything done in there is one step out here, like any other change
        // to this node. Without it the first Ctrl+Z after coming out would
        // restore the graph as it was before going in -- an hour of work, one
        // keystroke, and nothing to say it was about to happen.
        state.past = changed ? [...frame.past, before].slice(-HISTORY_LIMIT) : frame.past;
        state.future = changed ? [] : frame.future;
        state.document += 1;
      });
    },

    closeSubgraphsTo: (depth) => {
      while (get().subgraphStack.length > depth) {
        const before = get().subgraphStack.length;
        get().closeSubgraph();
        if (get().subgraphStack.length === before) return;
      }
    },

    rootGraph: () => {
      const { subgraphStack } = get();
      let graph = get().exportGraph();
      for (let level = subgraphStack.length - 1; level >= 0; level -= 1) {
        graph = withNested(subgraphStack[level].graph, subgraphStack[level].nodeId, graph);
      }
      return graph;
    },

    exportGraph: () => {
      const { rfNodes, rfEdges, metadata } = get();

      // As a file keeps it: each node's own settings, not every field every
      // node starts with -- and a size only where someone can set one, and
      // only the size they set. What ReactFlow measured is never written down
      // (see `setSize`): a graph must serialise the same way twice running, or
      // "unsaved" means nothing.
      const nodes: GraphNode[] = rfNodes.map((rfn) => {
        const resizable = showsPage(rfn.data.graphNode.node_type);
        return savedNode({
          ...rfn.data.graphNode,
          position: { x: rfn.position.x, y: rfn.position.y },
          ...(resizable
            ? setSize(rfn)
            : { width: rfn.data.graphNode.width, height: rfn.data.graphNode.height }),
        });
      });

      const edges: GraphEdge[] = rfEdges.map(graphEdge);

      return { metadata, nodes, edges };
    },

    commit: (coalesce) => {
      const now = Date.now();
      if (coalesce && coalescing?.key === coalesce && now - coalescing.at < COALESCE_MS) {
        coalescing.at = now;
        return;
      }
      coalescing = coalesce ? { key: coalesce, at: now } : null;
      const snapshot = JSON.stringify(get().exportGraph());
      set((state) => {
        if (state.past[state.past.length - 1] === snapshot) return;
        state.past.push(snapshot);
        // A bounded stack: undo is for recovering from a mistake, not for
        // replaying a whole session, and every entry is a full graph.
        if (state.past.length > HISTORY_LIMIT) state.past.shift();
        // Any new change abandons the redo branch, as in every editor.
        state.future = [];
      });
    },

    undo: () => {
      const { past } = get();
      if (past.length === 0) return;
      const current = JSON.stringify(get().exportGraph());
      const previous = past[past.length - 1];
      set((state) => {
        state.past.pop();
        state.future.push(current);
      });
      get().applyGraphSnapshot(previous, true);
    },

    redo: () => {
      const { future } = get();
      if (future.length === 0) return;
      const current = JSON.stringify(get().exportGraph());
      const next = future[future.length - 1];
      set((state) => {
        state.future.pop();
        state.past.push(current);
      });
      get().applyGraphSnapshot(next, true);
    },

    /**
     * Restore a serialised graph without touching the history stacks or the
     * saved-snapshot marker -- undoing back to the last saved state must read as
     * clean again, and undoing past it as dirty, which falls out of leaving
     * `savedSnapshot` alone.
     */
    applyGraphSnapshot: (json, keepEditing = false) => {
      const graph = normalizeGraph(JSON.parse(json) as Graph);
      const { rfNodes, rfEdges } = buildReactFlowGraph(graph);
      // Whatever came next is not a continuation of what was typed before.
      coalescing = null;
      set((state) => {
        state.metadata = graph.metadata;
        state.rfNodes = rfNodes as never;
        state.rfEdges = rfEdges;
        // Everything that names a node of the graph that was here. Left
        // standing, each points at something that may not exist any more: a
        // result against ids that now mean other nodes, a dialog on one of
        // them. The node dialog stays for Undo, on a node that is still there:
        // the same graph, a step back.
        state.executionResult = null;
        const stays = keepEditing && graph.nodes.some((node) => node.id === state.editingNodeId);
        if (!stays) state.editingNodeId = null;
      });
    },

    isDirty: () => {
      const { savedSnapshot } = get();
      // The whole document, not the level that happens to be open: going into
      // a node changes nothing, and a change made in there is a change.
      const root = get().rootGraph();
      // A never-saved graph counts as dirty only once it has something in it.
      if (savedSnapshot === null) return root.nodes.length > 0;
      return JSON.stringify(root) !== savedSnapshot;
    },

    takeDiskChanges: (changes) => {
      if (!changes.length) return [];
      const wasClean = !get().isDirty();
      const refused: string[] = [];
      get().commit();
      set((state) => {
        for (const change of changes) {
          const node = state.rfNodes.find((n: RFNode) => n.id === change.node_id)?.data.graphNode;
          if (!node) continue;
          // A whole graph a node holds, changed in its own folder. Where it is
          // kept is the element's business, and the ports follow from it.
          //
          // Taken only into a document with nothing unsaved in it: unlike a
          // text, which patches one field, this replaces every node, edge and
          // position in that graph. Over unsaved work it would be silent and
          // total, so it is left on disk and said out loud instead.
          if (change.field === NESTED_GRAPH_FIELD) {
            if (!wasClean) { refused.push(change.node_id); continue; }
            engineRegistry.node(node.node_type)?.setNestedGraph(node as never, change.value as never);
            Object.assign(node, derivedNodePorts(node) ?? {});
            continue;
          }
          (node.config as unknown as Record<string, unknown>)[change.field] = change.value;
        }
      });
      if (wasClean) get().markSaved();
      return refused;
    },

    markSaved: () => {
      const snapshot = JSON.stringify(get().rootGraph());
      set((state) => {
        state.savedSnapshot = snapshot;
      });
    },

    save: async (path = get().currentFilePath ?? undefined) => {
      if (!path) throw new Error('This graph has no file yet: use Save As.');
      const graph = get().rootGraph();
      const result = await call('saveGraph', { path, graph });
      set((state) => {
        state.savedSnapshot = JSON.stringify(graph);
      });
      get().setCurrentFilePath(result.path, result.project);
      return { path: result.path };
    },

    runGraph: async (graph, trigger = null) => {
      // A second press -- a double click, or a page event while ▶ Run is
      // going -- would start a second run beside the first, and whichever
      // ended first took the Stop button with it.
      if (get().isExecuting) return;
      const { setExecutionResult } = get();
      const started = get().document;
      const stillOpen = () => get().document === started;
      // A page event runs part of the graph, so what the rest of the page
      // shows is still true and stays: pressing "Plot" must not blank the
      // summary beside it. A full run starts from a clean slate, as before.
      const previous = trigger ? get().executionResult : null;
      set((state) => {
        state.isExecuting = true;
      });
      if (!trigger) setExecutionResult(null);
      try {
        // Started as a background run and polled, rather than awaited as one
        // blocking request: that is what lets the toolbar name the node in
        // flight and offer Stop. A run against a slow local model is otherwise
        // ten minutes of a spinner with no way out but reloading the page.
        const { run_id: runId, total } = await call('startRun', trigger ? { ...graph, trigger } : graph);
        set((state) => {
          state.currentRunId = runId;
          state.runProgress = {
            completed: 0, total, label: '', itemDone: 0, itemTotal: 0, idleSeconds: null,
          };
        });

        let snapshot = await call('run', { id: runId });
        while (!snapshot.done) {
          await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
          snapshot = await call('run', { id: runId });
          set((state) => {
            state.runProgress = {
              completed: snapshot.completed,
              total: snapshot.total,
              label: snapshot.current_label,
              itemDone: snapshot.item_done,
              itemTotal: snapshot.item_total,
              idleSeconds: snapshot.idle_seconds,
            };
          });
        }

        // Another graph is open now. Its nodes may share this one's ids, and
        // what this run made -- a shape, a remembered value, a result -- is
        // not theirs.
        if (!stillOpen()) return;
        const fresh: ExecutionResult = snapshot.result ?? {
          status: snapshot.cancelled ? 'cancelled' : 'error',
          node_results: [],
          outputs: {},
          error: snapshot.error ?? 'The run ended without a result.',
        };
        const result = previous ? mergeResults(previous, fresh) : fresh;
        // setExecutionResult also settles memory-feedback values back into the
        // graph, which is why the result goes through the store rather than
        // being held in a component.
        setExecutionResult(result, fresh);
        get().clearSentValues(fresh, graph);
      } catch (error) {
        if (stillOpen()) setExecutionResult({
          status: 'error',
          node_results: [],
          outputs: {},
          error: errorText(error, 'Execution failed'),
        });
      } finally {
        set((state) => {
          state.isExecuting = false;
          state.runProgress = null;
          state.currentRunId = null;
        });
      }
    },

    clearSentValues: (result, sent) =>
      set((state) => {
        for (const rfNode of state.rfNodes) {
          const graphNode = rfNode.data.graphNode as GraphNode;
          const ran = result.node_results.find((r) => r.node_id === graphNode.id);
          if (!ran || !delivered(ran.status) || !Array.isArray(graphNode.config.gui_widgets)) continue;
          const sentWidgets = sent.nodes.find((node) => node.id === graphNode.id)?.config.gui_widgets ?? [];
          for (const widget of graphNode.config.gui_widgets) {
            const was = sentWidgets.find((w) => w.id === widget.id);
            if (!was || JSON.stringify(was.value) !== JSON.stringify(widget.value)) continue;
            if (engineRegistry.widget(widget.kind)?.clearsValueAfterRun(parseWidget(widget))) widget.value = '';
          }
        }
      }),

    stopRun: async () => {
      const runId = get().currentRunId;
      if (!runId) return;
      try {
        await call('stopRun', { id: runId });
      } catch {
        // The run may have finished between the click and the request; the
        // polling loop reports the real outcome either way.
      }
    },
  }))
);
