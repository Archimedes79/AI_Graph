import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Node, Edge } from 'reactflow';
import type { Graph, GraphNode, GraphEdge, GraphMetadata, ExecutionResult, NodeType } from '@/graph';
import type { RFNodeData } from '@/canvas/nodeData';
import { derivedNodePorts } from '@/elements/nodes/gui/guiWidgets';
import { call, type RunTrigger } from '@/api/client';
import { errorText } from '@/api/errorText';
import { ACCENT } from '@/ui/theme';
import { delivered } from '@/canvas/executionStatus';
import { WIDGET_UIS, NODE_UIS } from '@/elements/registry';
import { RUN_PORT } from '@engine/execution/triggers.ts';
import type React from 'react';
import { applyMemory } from '@engine/graph.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { inferInterface } from '@engine/execution/interface.ts';
import type { TextChange } from '@engine/host/api.ts';
import { NESTED_GRAPH_FIELD } from '@engine/elements/NodeElement.ts';

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

  // Text Output node windows shown after a run
  textOutputWindows: { nodeId: string; label: string; content: string }[];

  /**
   * The graphs this one is inside, outermost first: one frame per node that
   * was opened, each with the undo history of its own level.
   *
   * One document is open at a time, and going into a node swaps which. That
   * keeps the canvas, the run button and undo exactly as they are, and it is
   * why nothing in here says "subgraph" twice.
   */
  subgraphStack: { nodeId: string; graph: Graph; past: string[]; future: string[] }[];

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
  selectedNodeId: string | null;
  editingNodeId: string | null;
  editingPort: { nodeId: string; portId: string } | null;

  // Actions
  setMetadata: (meta: Partial<GraphMetadata>) => void;
  setCurrentFilePath: (path: string | null, isProject?: boolean) => void;
  /** Add a node and return its id, so a caller can immediately fill it in. */
  addNode: (nodeType: NodeType, position: { x: number; y: number }) => string;
  updateNode: (nodeId: string, updates: Partial<GraphNode>) => void;
  deleteNode: (nodeId: string) => void;
  setRFNodes: (nodes: Node<RFNodeData>[]) => void;
  setRFEdges: (edges: Edge[]) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setEditingNode: (nodeId: string | null) => void;
  setEditingPort: (port: { nodeId: string; portId: string } | null) => void;
  /**
   * `ran` is the part of *result* that is new, when a page event re-ran only
   * some nodes and the rest was kept from before. Memory is settled from that
   * part alone: settling a kept result again would add last turn's answer to a
   * conversation a second time.
   */
  setExecutionResult: (result: ExecutionResult | null, ran?: ExecutionResult) => void;
  setIsExecuting: (v: boolean) => void;
  setTextOutputWindows: (windows: { nodeId: string; label: string; content: string }[]) => void;
  closeTextOutputWindow: (nodeId: string) => void;
  loadGraph: (graph: Graph) => void;
  exportGraph: () => Graph;
  /** Go into the graph a node holds. It becomes the open document. */
  openSubgraph: (nodeId: string) => void;
  /** Come back out one level, putting what was edited back into the node that holds it. */
  closeSubgraph: () => void;
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
   */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Internal: replace the graph with a serialised snapshot (used by undo/redo). */
  applyGraphSnapshot: (json: string) => void;
  isDirty: () => boolean;
  /** Record the current graph as saved (after a successful write to disk). */
  markSaved: () => void;
  /**
   * Take in code and prompts that changed in the project folder on disk.
   *
   * One undo step, so a change from another editor can be taken back like any
   * other. What is on disk is saved by definition: a graph that was clean stays
   * clean, and one with unsaved edits keeps exactly those.
   */
  takeDiskChanges: (changes: TextChange[]) => void;
  /**
   * Execute *graph* and put the whole outcome into the store: the result, the
   * text-output windows, the busy flag, and a synthesised error result if the
   * request itself fails.
   *
   * Lives here rather than in a component because the store already owns every
   * piece of state it touches, and because two front-ends need it -- the
   * editor's toolbar and the deployed runtime page. They had a copy each, and
   * the copies had already drifted.
   */
  runGraph: (graph: Graph, trigger?: RunTrigger | null) => Promise<void>;
  /**
   * Empty the boxes whose content was a message rather than a setting, once a
   * run has delivered it. Only for pages that ran, and only when they ran
   * cleanly: a message that reached nobody should still be there to send again.
   */
  clearSentValues: (result: ExecutionResult) => void;
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
 * The content of every `output` node set to `write_mode: "window"`, ready to
 * show in a floating window.
 */
function collectTextOutputWindows(
  graph: Graph,
  result: ExecutionResult,
): { nodeId: string; label: string; content: string }[] {
  return graph.nodes
    .filter((node) => NODE_UIS[node.node_type]?.showsResultWindow?.(node) ?? false)
    .map((node) => {
      const nodeResult = result.node_results.find((r) => r.node_id === node.id);
      if (!nodeResult || !delivered(nodeResult.status)) return null;
      // Text as text; anything else as the JSON it is -- String() of an object
      // is "[object Object]", which says nothing about the result it replaced.
      const content = Object.values(nodeResult.outputs)
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter((value) => value !== null && value !== undefined)
        .map((value) => (typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)))
        .join('\n');
      return { nodeId: node.id, label: node.config.output_label || node.label, content };
    })
    .filter((w): w is { nodeId: string; label: string; content: string } => w !== null);
}

/**
 * A wire that carries a value, and one that only says "start here".
 *
 * Drawn differently because they *are* different: a run edge delivers nothing,
 * and a canvas where it looks like data invites the question of what the AI
 * node does with a button's press count. Dashed and amber reads as a signal.
 */
export function edgeStyle(targetPort: string | null | undefined): React.CSSProperties {
  return targetPort === RUN_PORT
    ? { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 4' }
    : { stroke: ACCENT, strokeWidth: 2 };
}

let nodeCounter = 1;
function newId(prefix: string) {
  return `${prefix}-${nodeCounter++}-${Date.now()}`;
}

function normalizeMetadata(metadata: Partial<GraphMetadata> | undefined): GraphMetadata {
  return {
    ...defaultMetadata(),
    ...(metadata ?? {}),
    tags: Array.isArray(metadata?.tags) ? metadata.tags : [],
  };
}

function normalizeGraphNode(rawNode: Partial<GraphNode>): GraphNode {
  const nodeType = rawNode.node_type ?? 'input';
  const nodeId = rawNode.id ?? newId(nodeType);
  const defaults = NODE_UIS[nodeType].create(nodeId);

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
    config: {
      ...defaults.config,
      ...(rawNode.config ?? {}),
    },
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
  const edges = Array.isArray(graph.edges)
    ? graph.edges
        .filter((edge) => nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id))
        .map((edge, index) => ({
          ...edge,
          id: edge.id || `edge-${index}-${Date.now()}`,
          source_port_id: edge.source_port_id || 'output',
          target_port_id: edge.target_port_id || 'input',
        }))
    : [];

  return {
    metadata: normalizeMetadata(graph.metadata),
    nodes,
    edges,
  };
}

const defaultMetadata = (): GraphMetadata => ({
  name: 'Untitled Graph',
  version: '1.0.0',
  description: '',
  author: '',
  tags: [],
  // Which AI this graph's AI nodes call when they run, set once for the whole
  // graph (⚙ Settings) instead of once per node. 'default' means unset, which
  // the backend resolves to its own fallback; whoever runs a deployed copy can
  // override it without editing the graph -- see engine/src/ai/settings.ts.
  ai_defaults: { provider: 'default', model: '' },
  gui_scheme: 'night',
});

// How often a run in flight is polled. Fast enough that the node name keeps up
// with a quick graph, slow enough not to flood a local server during a long one.
const RUN_POLL_INTERVAL_MS = 400;

/** How many undo steps are kept. Each entry is a whole serialised graph. */
const HISTORY_LIMIT = 50;

interface NodeCallbacks {
  onEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onPortEdit: (nodeId: string, portId: string) => void;
}

/**
 * Build the ReactFlow node/edge arrays for a graph. Shared by `loadGraph` and by
 * undo/redo's `applyGraphSnapshot`, so restoring a snapshot can never drift from
 * loading a file -- they were the same twenty lines twice.
 */
function buildReactFlowGraph(graph: Graph, callbacks: NodeCallbacks) {
  const rfNodes: Node<RFNodeData>[] = graph.nodes.map((gn) => ({
    id: gn.id,
    type: 'graphNode',
    position: { x: gn.position.x, y: gn.position.y },
    width: gn.width,
    height: gn.height,
    data: { graphNode: gn, ...callbacks },
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

/** Whether this node's element keeps *field* as a file of its own: asked of the engine, never of a node type. */
function keepsText(node: GraphNode, field: string): boolean {
  return engineRegistry.node(node.node_type)?.texts(node).some((text) => text.field === field) ?? false;
}

/** Whether this node keeps an output interface (`output.schema.json`). */
export function keepsOutputInterface(node: GraphNode): boolean {
  return keepsText(node, 'output_schema');
}

/** Whether this node can keep examples (`examples.md`). */
export function keepsExamples(node: GraphNode): boolean {
  return keepsText(node, 'examples');
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
    textOutputWindows: [],
    selectedNodeId: null,
    editingNodeId: null,
    editingPort: null,
    subgraphStack: [],
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

    addNode: (nodeType, position) => {
      get().commit();
      const id = newId(nodeType);
      const defaults = NODE_UIS[nodeType].create(id);
      const rfNode: Node<RFNodeData> = {
        id,
        type: 'graphNode',
        position,
        data: {
          graphNode: defaults,
          onEdit: (nid) => get().setEditingNode(nid),
          onDelete: (nid) => get().deleteNode(nid),
          onPortEdit: (nid, pid) => get().setEditingPort({ nodeId: nid, portId: pid }),
        },
      };
      set((state) => {
        state.rfNodes.push(rfNode as any);
      });
      return id;
    },

    updateNode: (nodeId, updates) => {
      get().commit();
      set((state) => {
        const idx = state.rfNodes.findIndex((n: RFNode) => n.id === nodeId);
        if (idx !== -1) {
          const existing = state.rfNodes[idx].data.graphNode;
          const updated = { ...existing, ...updates } as GraphNode;
          state.rfNodes[idx].data.graphNode = updated;

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
        state.rfNodes = nodes as any;
      }),

    setRFEdges: (edges) =>
      set((state) => {
        state.rfEdges = edges;
      }),

    setSelectedNode: (nodeId) =>
      set((state) => {
        state.selectedNodeId = nodeId;
      }),

    setEditingNode: (nodeId) =>
      set((state) => {
        state.editingNodeId = nodeId;
      }),

    setEditingPort: (port) =>
      set((state) => {
        state.editingPort = port;
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
        // statement of its outputs. Kept once, the first time it succeeds;
        // after that it is the contract the next runs are held to, and only
        // "Set from last run" replaces it.
        for (const rfNode of state.rfNodes) {
          const node = rfNode.data.graphNode;
          if (!keepsOutputInterface(node) || node.config.output_schema) continue;
          const ran = result.node_results.find((r) => r.node_id === node.id && r.status === 'success');
          if (ran && Object.keys(ran.outputs ?? {}).length) node.config.output_schema = inferInterface(ran.outputs);
        }
      }),

    setIsExecuting: (v) =>
      set((state) => {
        state.isExecuting = v;
      }),

    setTextOutputWindows: (windows) =>
      set((state) => {
        state.textOutputWindows = windows;
      }),

    closeTextOutputWindow: (nodeId) =>
      set((state) => {
        state.textOutputWindows = state.textOutputWindows.filter((w) => w.nodeId !== nodeId);
      }),

    loadGraph: (graph) => {
      const normalizedGraph = normalizeGraph(graph);
      const callbacks = {
        onEdit: (nid: string) => get().setEditingNode(nid),
        onDelete: (nid: string) => get().deleteNode(nid),
        onPortEdit: (nid: string, pid: string) => get().setEditingPort({ nodeId: nid, portId: pid }),
      };

      const { rfNodes, rfEdges } = buildReactFlowGraph(normalizedGraph, callbacks);

      set((state) => {
        state.metadata = normalizedGraph.metadata;
        state.rfNodes = rfNodes as any;
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
      });
      // Snapshot through exportGraph() rather than from normalizedGraph: it is
      // the same serialisation isDirty() compares against, so a freshly loaded
      // graph is guaranteed to read as clean.
      get().markSaved();
    },

    openSubgraph: (nodeId) => {
      const node = get().rfNodes.find((n: RFNode) => n.id === nodeId)?.data.graphNode;
      if (!node || !NODE_UIS[node.node_type]?.opensNestedGraph) return;
      const held = engineRegistry.node(node.node_type)?.nestedGraph(node as never) as Graph | null;
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
      });
    },

    closeSubgraph: () => {
      const { subgraphStack } = get();
      const frame = subgraphStack[subgraphStack.length - 1];
      if (!frame) return;
      const inner = get().exportGraph();
      get().applyGraphSnapshot(JSON.stringify(withNested(frame.graph, frame.nodeId, inner)));
      set((state) => {
        state.subgraphStack.pop();
        state.past = frame.past;
        state.future = frame.future;
      });
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

      // As a file keeps it: each node's own settings, not every field every node
      // starts with -- and a size only where someone can set one. ReactFlow
      // measures every node once it is drawn and writes that onto it; kept for
      // a node that sizes itself, the measurement made every graph read as
      // "unsaved" the moment it was opened.
      const nodes: GraphNode[] = rfNodes.map((rfn) => {
        const ui = NODE_UIS[rfn.data.graphNode.node_type];
        const resizable = ui.hasRuntimeWindow === true;
        return ui.saved({
          ...rfn.data.graphNode,
          position: { x: rfn.position.x, y: rfn.position.y },
          width: resizable ? rfn.width ?? rfn.data.graphNode.width : rfn.data.graphNode.width,
          height: resizable ? rfn.height ?? rfn.data.graphNode.height : rfn.data.graphNode.height,
        });
      });

      const edges: GraphEdge[] = rfEdges.map((rfe) => ({
        id: rfe.id,
        source_node_id: rfe.source,
        source_port_id: rfe.sourceHandle ?? 'output',
        target_node_id: rfe.target,
        target_port_id: rfe.targetHandle ?? 'input',
      }));

      return { metadata, nodes, edges };
    },

    commit: () => {
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
      get().applyGraphSnapshot(previous);
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
      get().applyGraphSnapshot(next);
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    /**
     * Restore a serialised graph without touching the history stacks or the
     * saved-snapshot marker -- undoing back to the last saved state must read as
     * clean again, and undoing past it as dirty, which falls out of leaving
     * `savedSnapshot` alone.
     */
    applyGraphSnapshot: (json) => {
      const graph = normalizeGraph(JSON.parse(json) as Graph);
      const { rfNodes, rfEdges } = buildReactFlowGraph(graph, {
        onEdit: (nid: string) => get().setEditingNode(nid),
        onDelete: (nid: string) => get().deleteNode(nid),
        onPortEdit: (nid: string, pid: string) => get().setEditingPort({ nodeId: nid, portId: pid }),
      });
      set((state) => {
        state.metadata = graph.metadata;
        state.rfNodes = rfNodes as any;
        state.rfEdges = rfEdges;
        // A stale result would point at nodes that may no longer exist.
        state.executionResult = null;
        state.editingNodeId = null;
        state.editingPort = null;
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
      if (!changes.length) return;
      const wasClean = !get().isDirty();
      get().commit();
      set((state) => {
        for (const change of changes) {
          const node = state.rfNodes.find((n: RFNode) => n.id === change.node_id)?.data.graphNode;
          if (!node) continue;
          // A whole graph a node holds, changed in its own folder. Where it is
          // kept is the element's business, and the ports follow from it.
          if (change.field === NESTED_GRAPH_FIELD) {
            engineRegistry.node(node.node_type)?.setNestedGraph(node as never, change.value as never);
            Object.assign(node, derivedNodePorts(node) ?? {});
            continue;
          }
          const holder: Record<string, unknown> | undefined = change.widget_id
            ? (node.config.gui_widgets ?? []).find((widget) => widget.id === change.widget_id)
            : node.config;
          if (holder) holder[change.field] = change.value;
        }
      });
      if (wasClean) get().markSaved();
    },

    markSaved: () => {
      const snapshot = JSON.stringify(get().rootGraph());
      set((state) => {
        state.savedSnapshot = snapshot;
      });
    },

    runGraph: async (graph, trigger = null) => {
      const { setIsExecuting, setExecutionResult, setTextOutputWindows } = get();
      // A page event runs part of the graph, so what the rest of the page
      // shows is still true and stays: pressing "Plot" must not blank the
      // summary beside it. A full run starts from a clean slate, as before.
      const previous = trigger ? get().executionResult : null;
      setIsExecuting(true);
      if (!trigger) {
        setExecutionResult(null);
        setTextOutputWindows([]);
      }
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
              // `?? 0` rather than a required field: a deployed bundle may be
              // serving an older snapshot shape, and a missing counter should
              // mean "no items to show", not NaN in the toolbar.
              itemDone: snapshot.item_done ?? 0,
              itemTotal: snapshot.item_total ?? 0,
              idleSeconds: snapshot.idle_seconds ?? null,
            };
          });
        }

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
        get().clearSentValues(fresh);
        setTextOutputWindows(collectTextOutputWindows(graph, result));
      } catch (error) {
        setExecutionResult({
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

    clearSentValues: (result) =>
      set((state) => {
        for (const rfNode of state.rfNodes) {
          const graphNode = rfNode.data.graphNode as GraphNode;
          const ran = result.node_results.find((r) => r.node_id === graphNode.id);
          if (!ran || !delivered(ran.status) || !Array.isArray(graphNode.config.gui_widgets)) continue;
          for (const widget of graphNode.config.gui_widgets) {
            if (WIDGET_UIS[widget.kind]?.clearValueAfterRun?.(widget)) widget.value = '';
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
