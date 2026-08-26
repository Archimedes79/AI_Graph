import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Node, Edge } from 'reactflow';
import type { Graph, GraphNode, GraphEdge, GraphMetadata, ExecutionResult, RFNodeData, NodeType, GuiWidgetKind } from '../types/graph';
import { nodeTypeDefaults, type NodePreset } from '../utils/nodeDefaults';
import { syncGuiNodePorts } from '../utils/guiWidgets';

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

  // UI state
  selectedNodeId: string | null;
  editingNodeId: string | null;
  editingPort: { nodeId: string; portId: string } | null;

  // Actions
  setMetadata: (meta: Partial<GraphMetadata>) => void;
  setCurrentFilePath: (path: string | null) => void;
  addNode: (nodeType: NodeType, position: { x: number; y: number }) => void;
  addPresetNode: (preset: NodePreset, position: { x: number; y: number }) => void;
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

// One-time client-side migration of retired legacy alias names, mirroring
// backend/app/models/graph.py's _migrate_legacy_node (the backend handles
// API loads; this covers raw JSON file/paste imports).
const LEGACY_INPUT_MODES: Record<string, 'text' | 'file' | 'directory'> = {
  text_input: 'text',
  file_input: 'file',
  directory_input: 'directory',
};
const LEGACY_WIDGET_KINDS: Record<string, { kind: GuiWidgetKind; mode: string }> = {
  file_open: { kind: 'input_picker', mode: 'file' },
  directory_open: { kind: 'input_picker', mode: 'directory' },
  text_window: { kind: 'text_io', mode: 'both' },
  chat_window: { kind: 'text_io', mode: 'both' },
};

function migrateLegacyNode(rawNode: Partial<GraphNode>): Partial<GraphNode> {
  const nodeType = rawNode.node_type as string | undefined;
  let node = rawNode;
  if (nodeType && nodeType in LEGACY_INPUT_MODES) {
    node = {
      ...node,
      node_type: 'input',
      config: { ...(node.config as GraphNode['config']), input_mode: LEGACY_INPUT_MODES[nodeType], prompt_at_runtime: true },
    };
  } else if (nodeType === 'text_output') {
    node = {
      ...node,
      node_type: 'output',
      config: { ...(node.config as GraphNode['config']), write_mode: 'window' },
    };
  }
  const widgets = node.config?.gui_widgets;
  if (Array.isArray(widgets) && widgets.some((w) => (w.kind as string) in LEGACY_WIDGET_KINDS)) {
    node = {
      ...node,
      config: {
        ...(node.config as GraphNode['config']),
        gui_widgets: widgets.map((w) => {
          const legacy = LEGACY_WIDGET_KINDS[w.kind as string];
          return legacy ? { ...w, kind: legacy.kind, mode: w.mode || legacy.mode } : w;
        }),
      },
    };
  }
  return node;
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
  return nodeType === 'data' || nodeType === 'gui' || nodeType === 'widget';
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
  rawNode = migrateLegacyNode(rawNode);
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
  return nodeType === 'gui' || nodeType === 'widget' ? syncGuiNodePorts(node) : node;
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
});

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

    setMetadata: (meta) =>
      set((state) => {
        Object.assign(state.metadata, meta);
      }),

    setCurrentFilePath: (path) =>
      set((state) => {
        state.currentFilePath = path;
      }),

    addNode: (nodeType, position) => {
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
    },

    addPresetNode: (preset, position) => {
      const id = newId(preset.nodeType);
      const graphNode = preset.build(id);
      const rfNode: Node<RFNodeData> = {
        id,
        type: 'graphNode',
        position,
        data: {
          graphNode,
          onEdit: (nid) => get().setEditingNode(nid),
          onDelete: (nid) => get().deleteNode(nid),
          onPortEdit: (nid, pid) => get().setEditingPort({ nodeId: nid, portId: pid }),
        },
      };
      set((state) => {
        state.rfNodes.push(rfNode as any);
      });
    },

    updateNode: (nodeId, updates) => {
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
        for (const rfNode of state.rfNodes) {
          const graphNode = rfNode.data.graphNode as GraphNode;
          if (graphNode.node_type !== 'data') continue;
          const nodeResult = resultByNodeId.get(graphNode.id);
          if (nodeResult?.status === 'success' && nodeResult.outputs && 'output' in nodeResult.outputs) {
            graphNode.config.data_value = nodeResult.outputs.output as any;
          }
        }
        const feedbackIds = memoryFeedbackEdgeIds(nodes, edges);
        if (feedbackIds.size === 0) return;

        for (const edge of edges) {
          if (!feedbackIds.has(edge.id)) continue;
          const sourceResult = resultByNodeId.get(edge.source_node_id);
          if (!sourceResult || sourceResult.status !== 'success') continue;
          const value = sourceResult.outputs?.[edge.source_port_id];
          if (value === undefined) continue;

          const targetIdx = state.rfNodes.findIndex((n: RFNode) => n.id === edge.target_node_id);
          if (targetIdx === -1) continue;
          const targetNode = state.rfNodes[targetIdx].data.graphNode as GraphNode;
          if (targetNode.node_type === 'data') {
            targetNode.config.data_value = value as any;
            continue;
          }
          const widgetId = edge.target_port_id.endsWith('_in')
            ? edge.target_port_id.slice(0, -'_in'.length)
            : edge.target_port_id;
          const widgets = targetNode.config.gui_widgets;
          const widget = Array.isArray(widgets) ? widgets.find((w) => w.id === widgetId) : undefined;
          if (!widget) continue;
          widget.value = value as any;
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

      const rfNodes: Node<RFNodeData>[] = normalizedGraph.nodes.map((gn) => ({
        id: gn.id,
        type: 'graphNode',
        position: { x: gn.position.x, y: gn.position.y },
        width: gn.width,
        height: gn.height,
        data: { graphNode: gn, ...callbacks },
      }));

      const rfEdges: Edge[] = normalizedGraph.edges.map((ge) => ({
        id: ge.id,
        source: ge.source_node_id,
        sourceHandle: ge.source_port_id,
        target: ge.target_node_id,
        targetHandle: ge.target_port_id,
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#6366f1', strokeWidth: 2 },
      }));

      set((state) => {
        state.metadata = normalizedGraph.metadata;
        state.rfNodes = rfNodes as any;
        state.rfEdges = rfEdges;
        state.executionResult = null;
        // Whoever loaded a graph without going through the file-path flow
        // (Paste JSON, AI Graph, etc.) doesn't know its file path; the caller
        // sets `currentFilePath` explicitly right after loadGraph when it does.
        state.currentFilePath = null;
      });
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
  }))
);
