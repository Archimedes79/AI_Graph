import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Node, Edge } from 'reactflow';
import type { Graph, GraphNode, GraphEdge, GraphMetadata, ExecutionResult, RFNodeData, NodeType } from '../types/graph';
import { nodeTypeDefaults, type NodePreset } from '../utils/nodeDefaults';
import { syncGuiNodePorts } from '../utils/guiWidgets';

type RFNode = Node<RFNodeData>;

/** Extra DSL fields ReactFlow edges carry in `edge.data`. */
export interface RFEdgeData {
  deferred?: boolean;
  initial_value?: unknown;
}

export interface GraphStore {
  // ReactFlow state
  rfNodes: Node<RFNodeData>[];
  rfEdges: Edge[];

  // Graph metadata
  metadata: GraphMetadata;

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
  addNode: (nodeType: NodeType, position: { x: number; y: number }) => void;
  addPresetNode: (preset: NodePreset, position: { x: number; y: number }) => void;
  updateNode: (nodeId: string, updates: Partial<GraphNode>) => void;
  deleteNode: (nodeId: string) => void;
  setRFNodes: (nodes: Node<RFNodeData>[]) => void;
  setRFEdges: (edges: Edge[]) => void;
  setEdgeFeedback: (edgeId: string, patch: RFEdgeData) => void;
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

function normalizeGraphNode(rawNode: Partial<GraphNode>): GraphNode {
  const nodeType = rawNode.node_type ?? 'text_input';
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
          deferred: edge.deferred === true ? true : undefined,
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
});

export const useGraphStore = create<GraphStore>()(
  immer((set, get) => ({
    rfNodes: [],
    rfEdges: [],
    metadata: defaultMetadata(),
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

    setEdgeFeedback: (edgeId, patch) =>
      set((state) => {
        const edge = state.rfEdges.find((e: Edge) => e.id === edgeId);
        if (!edge) return;
        edge.data = { ...(edge.data as RFEdgeData | undefined), ...patch };
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
        data: { deferred: ge.deferred, initial_value: ge.initial_value } satisfies RFEdgeData,
        style: { stroke: '#6366f1', strokeWidth: 2 },
      }));

      set((state) => {
        state.metadata = normalizedGraph.metadata;
        state.rfNodes = rfNodes as any;
        state.rfEdges = rfEdges;
        state.executionResult = null;
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

      const edges: GraphEdge[] = rfEdges.map((rfe) => {
        const data = rfe.data as RFEdgeData | undefined;
        return {
          id: rfe.id,
          source_node_id: rfe.source,
          source_port_id: rfe.sourceHandle ?? 'output',
          target_node_id: rfe.target,
          target_port_id: rfe.targetHandle ?? 'input',
          deferred: data?.deferred === true ? true : undefined,
          initial_value: data?.initial_value,
        };
      });

      return { metadata, nodes, edges };
    },
  }))
);
