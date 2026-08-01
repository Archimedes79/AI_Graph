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

const nodeTypes = { graphNode: GraphNodeComponent };

const edgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: { stroke: '#6366f1', strokeWidth: 2 },
};

export default function GraphCanvas() {
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const setRFNodes = useGraphStore((s) => s.setRFNodes);
  const setRFEdges = useGraphStore((s) => s.setRFEdges);
  const addNode = useGraphStore((s) => s.addNode);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = React.useState<ReactFlowInstance | null>(null);

  const onConnect = useCallback(
    (params: Connection) => {
      const edge: Edge = {
        ...params,
        id: `edge-${params.source}-${params.sourceHandle}-${params.target}-${params.targetHandle}`,
        type: 'smoothstep',
        style: { stroke: '#6366f1', strokeWidth: 2 },
      } as Edge;
      setRFEdges(addEdge(edge, rfEdges));
    },
    [rfEdges, setRFEdges]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/nodeType') as NodeType;
      if (!nodeType || !reactFlowWrapper.current || !rfInstance) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = rfInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      addNode(nodeType, position);
    },
    [rfInstance, addNode]
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
          setRFNodes(applyNodeChanges(changes, rfNodes) as typeof rfNodes);
        }}
        onEdgesChange={(changes: EdgeChange[]) => {
          setRFEdges(applyEdgeChanges(changes, rfEdges));
        }}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={edgeOptions}
        fitView
        onInit={setRfInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        deleteKeyCode="Delete"
        style={{ background: '#0f1117' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#2d3148"
        />
        <Controls
          style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
        />
        <MiniMap
          style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
          nodeColor={(node) => {
            const colors: Record<string, string> = {
              text_input: '#1e3a5f',
              file_input: '#1e3a5f',
              directory_input: '#1e3a5f',
              ai: '#2d1b4e',
              code: '#1a3a2a',
              output: '#3a2000',
              merge: '#1a2a3a',
              split: '#3a1a1a',
            };
            return colors[node.data?.graphNode?.node_type] ?? '#1a1d2e';
          }}
        />
      </ReactFlow>
    </div>
  );
}
