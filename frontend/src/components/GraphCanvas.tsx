import React, { useCallback, useRef, DragEvent } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  Edge,
  NodeChange,
  EdgeChange,
  BackgroundVariant,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useGraphStore } from '../store/graphStore';
import GraphNodeComponent from './nodes/GraphNodeComponent';
import type { NodeType } from '../types/graph';
import { WIDGET_PRESETS } from '../utils/nodeDefaults';
import { ACCENT, LINE, PANEL, SUNKEN, SURFACE } from '../ui/theme';

const nodeTypes = { graphNode: GraphNodeComponent };

const edgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: { stroke: ACCENT, strokeWidth: 2 },
};

function getConnectionRejectionReason(
  params: Connection,
  rfNodes: ReturnType<typeof useGraphStore.getState>['rfNodes'],
  rfEdges: ReturnType<typeof useGraphStore.getState>['rfEdges']
) {
  if (!params.source || !params.target) return null;

  const sourceNode = rfNodes.find((node) => node.id === params.source);
  const targetNode = rfNodes.find((node) => node.id === params.target);

  if (!sourceNode || !targetNode) return null;

  return null;
}

export default function GraphCanvas() {
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const setRFNodes = useGraphStore((s) => s.setRFNodes);
  const setRFEdges = useGraphStore((s) => s.setRFEdges);
  const addNode = useGraphStore((s) => s.addNode);
  const addPresetNode = useGraphStore((s) => s.addPresetNode);
  const commit = useGraphStore((s) => s.commit);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = React.useState<ReactFlowInstance | null>(null);

  const onConnect = useCallback(
    (params: Connection) => {
      const rejectionReason = getConnectionRejectionReason(params, rfNodes, rfEdges);
      if (rejectionReason) {
        window.alert(rejectionReason);
        return;
      }

      const edge: Edge = {
        ...params,
        id: `edge-${params.source}-${params.sourceHandle}-${params.target}-${params.targetHandle}`,
        type: 'smoothstep',
        style: { stroke: ACCENT, strokeWidth: 2 },
      } as Edge;
      commit();
      setRFEdges(addEdge(edge, rfEdges));
    },
    [commit, rfEdges, rfNodes, setRFEdges]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!reactFlowWrapper.current || !rfInstance) return;

      const presetId = event.dataTransfer.getData('application/nodePreset');
      const nodeType = event.dataTransfer.getData('application/nodeType') as NodeType;
      if (!presetId && !nodeType) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = rfInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      if (presetId) {
        const preset = WIDGET_PRESETS.find((p) => p.id === presetId);
        if (preset) addPresetNode(preset, position);
        return;
      }

      addNode(nodeType, position);
    },
    [rfInstance, addNode, addPresetNode]
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <div ref={reactFlowWrapper} className="flex-1 h-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={(changes: NodeChange[]) => {
          // A drag reports a position change per frame, so history points come
          // from onNodeDragStart instead; removals have no such event and are
          // committed here, before they are applied.
          if (changes.some((c) => c.type === 'remove')) commit();
          setRFNodes(applyNodeChanges(changes, rfNodes) as typeof rfNodes);
        }}
        onNodeDragStart={() => commit()}
        onEdgesChange={(changes: EdgeChange[]) => {
          if (changes.some((c) => c.type === 'remove')) commit();
          setRFEdges(applyEdgeChanges(changes, rfEdges));
        }}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={edgeOptions}
        fitView
        onInit={setRfInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        deleteKeyCode={['Delete', 'Backspace']}
        style={{ background: SUNKEN }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color={LINE}
        />
        <Controls
          style={PANEL}
        />
        <MiniMap
          style={PANEL}
          nodeColor={(node) => {
            const colors: Record<string, string> = {
              input: '#1e3a5f',
              ai: '#2d1b4e',
              code: '#1a3a2a',
              output: '#3a2000',
            };
            return colors[node.data?.graphNode?.node_type] ?? SURFACE;
          }}
        />
      </ReactFlow>
    </div>
  );
}
