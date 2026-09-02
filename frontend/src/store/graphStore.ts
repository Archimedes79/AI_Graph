import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Node, Edge } from 'reactflow';
import type { Graph, GraphNode, GraphEdge, GraphMetadata, ExecutionResult, RFNodeData, NodeType, GuiWidgetKind } from '../types/graph';
import { nodeTypeDefaults } from '../utils/nodeDefaults';
import { syncGuiNodePorts } from '../utils/guiWidgets';
import { cancelRun, getRunSnapshot, startRun } from '../utils/api';
import { errorText } from '../utils/errorText';
import { ACCENT } from '../ui/theme';
import { delivered } from '../utils/executionStatus';
import { NODE_ELEMENTS } from '../elements/registry';
import { migrateNode } from '@engine/migrate.ts';

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

  // Execution state
  executionResult: ExecutionResult | null;
  isExecuting: boolean;

  // Text Output node windows shown after a run
  textOutputWindows: { nodeId: string; label: string; content: string }[];

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
  setCurrentFilePath: (path: string | null) => void;
  /** Add a node and return its id, so a caller can immediately fill it in. */
  addNode: (nodeType: NodeType, position: { x: number; y: number }) => string;
  updateNode: (nodeId: string, updates: Partial<GraphNode>) => void;
  deleteNode: (nodeId: string) => void;
  setRFNodes: (nodes: Node<RFNodeData>[]) => void;
  setRFEdges: (edges: Edge[]) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setEditingNode: (nodeId: string | null) => void;
  setEditingPort: (port: { nodeId: string; portId: string } | null) => void;
  setExecutionResult: (result: ExecutionResult | null) => void;
  setIsExecuting: (v: boolean) => void;
  setTextOutputWindows: (windows: { nodeId: string; label: string; content: string }[]) => void;
  closeTextOutputWindow: (nodeId: string) => void;
  loadGraph: (graph: Graph) => void;
  exportGraph: () => Graph;
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
   * Adopt the `code_file` names a save came back with.
   *
   * Saving renames a node's file to follow its label, so the name on disk can
   * differ from the one that was sent. Deliberately not an undo step and
   * deliberately not `updateNode`: it is bookkeeping about where the file went,
   * not a change the user made.
   */
  syncNodeFileNames: (graph: Graph) => void;
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
  runGraph: (graph: Graph) => Promise<void>;
  /** Stop the run in flight. Nodes already finished keep their results. */
  stopRun: () => Promise<void>;
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
    .filter((node) => NODE_ELEMENTS[node.node_type]?.showsResultWindow?.(node) ?? false)
    .map((node) => {
      const nodeResult = result.node_results.find((r) => r.node_id === node.id);
      if (!nodeResult || !delivered(nodeResult.status)) return null;
      const content = Object.values(nodeResult.outputs)
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter((value) => value !== null && value !== undefined)
        .map(String)
        .join('\n');
      return { nodeId: node.id, label: node.config.output_label || node.label, content };
    })
    .filter((w): w is { nodeId: string; label: string; content: string } => w !== null);
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

// A gui/widget node is a "memory" element: its output reflects its own
// persisted widget value rather than being freshly recomputed from inputs
// each round. An edge feeding one of its input ports is therefore excluded
// from cycle detection exactly when needed to break a cycle -- mirrors
// backend/app/services/graph_executor.py's `_memory_feedback_edge_ids`
// (Kahn's algorithm, marking one memory-targeting edge as feedback at a time
// until the graph is acyclic) so the frontend can tell, after a run, which
// edges' delivered values should be persisted into the target widget's own
// `value` for the *next* run (see `setExecutionResult` below).
function isMemoryNode(nodeType: string): boolean {
  return NODE_ELEMENTS[nodeType as GraphNode['node_type']]?.isMemory ?? false;
}

function memoryFeedbackEdgeIds(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const nodeTypeById = new Map(nodes.map((n) => [n.id, n.node_type as string]));
  const nodeIds = new Set(nodeTypeById.keys());
  let feedbackIds = new Set<string>();

  while (true) {
    const active = edges.filter(
      (e) => !feedbackIds.has(e.id) && nodeIds.has(e.source_node_id) && nodeIds.has(e.target_node_id)
    );
    const inDegree = new Map<string, number>();
    nodeIds.forEach((id) => inDegree.set(id, 0));
    const successors = new Map<string, GraphEdge[]>();
    for (const e of active) {
      inDegree.set(e.target_node_id, (inDegree.get(e.target_node_id) ?? 0) + 1);
      if (!successors.has(e.source_node_id)) successors.set(e.source_node_id, []);
      successors.get(e.source_node_id)!.push(e);
    }

    const queue: string[] = [...nodeIds].filter((id) => inDegree.get(id) === 0);
    const visited = new Set(queue);
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of successors.get(id) ?? []) {
        inDegree.set(e.target_node_id, (inDegree.get(e.target_node_id) ?? 0) - 1);
        if (inDegree.get(e.target_node_id) === 0 && !visited.has(e.target_node_id)) {
          visited.add(e.target_node_id);
          queue.push(e.target_node_id);
        }
      }
    }

    if (visited.size === nodeIds.size) return feedbackIds;
    const candidate = active.find(
      (e) => !visited.has(e.target_node_id) && isMemoryNode(nodeTypeById.get(e.target_node_id) ?? '')
    );
    if (!candidate) return feedbackIds;
    feedbackIds = new Set([...feedbackIds, candidate.id]);
  }
}

function normalizeGraphNode(rawNode: Partial<GraphNode>): GraphNode {
  // Raw JSON from a dropped or pasted file never passed through the engine's
  // parseGraph, so it is brought to the current DSL here -- by the engine's
  // own migration, not a copy of it.
  rawNode = migrateNode(rawNode) as Partial<GraphNode>;
  const nodeType = rawNode.node_type ?? 'input';
  const nodeId = rawNode.id ?? newId(nodeType);
  const defaults = nodeTypeDefaults(nodeType, nodeId);

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
      extra: {
        ...defaults.config.extra,
        ...((rawNode.config?.extra as Record<string, unknown> | undefined) ?? {}),
      },
    },
  };

  // gui/widget node ports are always derived from their widget list -- never
  // trust hand-edited/imported/AI-generated `inputs`/`outputs`, mirroring the
  // backend's defensive sync_gui_node_ports call in execute_graph.
  return nodeType === 'gui' ? syncGuiNodePorts(node) : node;
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
  // override it without editing the graph -- see backend/app/services/ai_settings.py.
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
    style: { stroke: ACCENT, strokeWidth: 2 },
  }));

  return { rfNodes, rfEdges };
}

export const useGraphStore = create<GraphStore>()(
  immer((set, get) => ({
    rfNodes: [],
    rfEdges: [],
    metadata: defaultMetadata(),
    currentFilePath: null,
    executionResult: null,
    isExecuting: false,
    textOutputWindows: [],
    selectedNodeId: null,
    editingNodeId: null,
    editingPort: null,
    savedSnapshot: null,
    past: [],
    future: [],
    runProgress: null,
    currentRunId: null,

    setMetadata: (meta) =>
      set((state) => {
        Object.assign(state.metadata, meta);
      }),

    setCurrentFilePath: (path) =>
      set((state) => {
        state.currentFilePath = path;
      }),

    addNode: (nodeType, position) => {
      get().commit();
      const id = newId(nodeType);
      const defaults = nodeTypeDefaults(nodeType, id);
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
              if (e.target === nodeId && e.targetHandle && !inputIds.has(e.targetHandle)) return false;
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

    setExecutionResult: (result) =>
      set((state) => {
        state.executionResult = result;
        if (!result) return;

        // Same-round "memory settle": a gui/widget node's own output reflects
        // its persisted widget value, so a cycle-closing edge into one only
        // becomes visible on the NEXT run unless we persist the fresh value
        // here now -- mirrors the backend's own in-memory
        // `_settle_memory_feedback`, which mutates its (request-scoped) Graph
        // copy the same way; the frontend must repeat it against its own
        // long-lived graph state so the loop actually progresses across
        // separate Run clicks.
        const nodes = state.rfNodes.map((n: RFNode) => n.data.graphNode as GraphNode);
        const edges: GraphEdge[] = state.rfEdges.map((e: Edge) => ({
          id: e.id,
          source_node_id: e.source,
          source_port_id: e.sourceHandle ?? 'output',
          target_node_id: e.target,
          target_port_id: e.targetHandle ?? 'input',
        }));
        const resultByNodeId = new Map(result.node_results.map((r) => [r.node_id, r]));
        // An acyclic memory node still updates: it delivered a value this round,
        // and that value is what the next round starts from.
        for (const rfNode of state.rfNodes) {
          const graphNode = rfNode.data.graphNode as GraphNode;
          const element = NODE_ELEMENTS[graphNode.node_type];
          if (!element?.isMemory || !element.settleMemoryValue) continue;
          const nodeResult = resultByNodeId.get(graphNode.id);
          if (delivered(nodeResult?.status) && nodeResult?.outputs && 'output' in nodeResult.outputs) {
            element.settleMemoryValue(graphNode, 'output', nodeResult.outputs.output);
          }
        }
        const feedbackIds = memoryFeedbackEdgeIds(nodes, edges);
        if (feedbackIds.size === 0) return;

        for (const edge of edges) {
          if (!feedbackIds.has(edge.id)) continue;
          const sourceResult = resultByNodeId.get(edge.source_node_id);
          if (!sourceResult || !delivered(sourceResult.status)) continue;
          // Prefer the value the backend's own settle pass wrote into the
          // target's NodeResult.inputs: for a display-only widget that is the
          // *transformed* value (apply_display_transform), not the raw source
          // output. Fall back to the raw output for older results.
          const settled = resultByNodeId.get(edge.target_node_id)?.inputs?.[edge.target_port_id];
          const value = settled !== undefined ? settled : sourceResult.outputs?.[edge.source_port_id];
          if (value === undefined) continue;

          const targetIdx = state.rfNodes.findIndex((n: RFNode) => n.id === edge.target_node_id);
          if (targetIdx === -1) continue;
          const targetNode = state.rfNodes[targetIdx].data.graphNode as GraphNode;
          NODE_ELEMENTS[targetNode.node_type]?.settleMemoryValue?.(
            targetNode, edge.target_port_id, value,
          );
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
        // A different document: its predecessor's undo steps would restore
        // nodes belonging to a graph that is no longer open.
        state.past = [];
        state.future = [];
      });
      // Snapshot through exportGraph() rather than from normalizedGraph: it is
      // the same serialisation isDirty() compares against, so a freshly loaded
      // graph is guaranteed to read as clean.
      get().markSaved();
    },

    exportGraph: () => {
      const { rfNodes, rfEdges, metadata } = get();

      const nodes: GraphNode[] = rfNodes.map((rfn) => ({
        ...rfn.data.graphNode,
        position: { x: rfn.position.x, y: rfn.position.y },
        width: rfn.width ?? rfn.data.graphNode.width,
        height: rfn.height ?? rfn.data.graphNode.height,
      }));

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
      const current = JSON.stringify(get().exportGraph());
      // A never-saved graph counts as dirty only once it has something in it.
      if (savedSnapshot === null) return get().rfNodes.length > 0;
      return current !== savedSnapshot;
    },

    syncNodeFileNames: (graph) => {
      const names = new Map(graph.nodes.map((n) => [n.id, n.config?.code_file ?? '']));
      set((state) => {
        for (const rfNode of state.rfNodes) {
          const name = names.get(rfNode.id);
          if (name !== undefined) rfNode.data.graphNode.config.code_file = name;
        }
      });
    },

    markSaved: () => {
      const snapshot = JSON.stringify(get().exportGraph());
      set((state) => {
        state.savedSnapshot = snapshot;
      });
    },

    runGraph: async (graph) => {
      const { setIsExecuting, setExecutionResult, setTextOutputWindows } = get();
      setIsExecuting(true);
      setExecutionResult(null);
      setTextOutputWindows([]);
      try {
        // Started as a background run and polled, rather than awaited as one
        // blocking request: that is what lets the toolbar name the node in
        // flight and offer Stop. A run against a slow local model is otherwise
        // ten minutes of a spinner with no way out but reloading the page.
        const { run_id: runId, total } = await startRun(graph);
        set((state) => {
          state.currentRunId = runId;
          state.runProgress = {
            completed: 0, total, label: '', itemDone: 0, itemTotal: 0, idleSeconds: null,
          };
        });

        let snapshot = await getRunSnapshot(runId);
        while (!snapshot.done) {
          await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
          snapshot = await getRunSnapshot(runId);
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

        const result: ExecutionResult = snapshot.result ?? {
          status: snapshot.cancelled ? 'cancelled' : 'error',
          node_results: [],
          final_outputs: {},
          error: snapshot.error ?? 'The run ended without a result.',
        };
        // setExecutionResult also settles memory-feedback values back into the
        // graph, which is why the result goes through the store rather than
        // being held in a component.
        setExecutionResult(result);
        setTextOutputWindows(collectTextOutputWindows(graph, result));
      } catch (error) {
        setExecutionResult({
          status: 'error',
          node_results: [],
          final_outputs: {},
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

    stopRun: async () => {
      const runId = get().currentRunId;
      if (!runId) return;
      try {
        await cancelRun(runId);
      } catch {
        // The run may have finished between the click and the request; the
        // polling loop reports the real outcome either way.
      }
    },
  }))
);
