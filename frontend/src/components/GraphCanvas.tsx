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

      // Only node types are dropped now. There used to be a second kind of
      // payload for the standalone widget presets; a gui node's blocks are
      // added inside it, on its page, so nothing drops a widget onto a canvas.
      const nodeType = event.dataTransfer.getData('application/nodeType') as NodeType;
      if (!nodeType) return;

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
        // Fit, but never magnify. A two-node graph used to open at ~180%, so
        // the node text was half again the size of the panel text beside it and
        // the first thing anyone did was zoom out. 100% is the honest starting
        // point -- one type size across the whole window -- and a graph too big
        // for the viewport is still shrunk to fit.
        fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
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
          // The minimap paints SVG `fill` attributes, where a CSS variable does
          // not resolve -- so the scheme's tint is read off the document here
          // instead of handed over as `var(--ui-node-ai)`. It was a second,
          // hard-coded copy of four of the six tints before that, which is why
          // a data node was the wrong colour on a map of its own graph.
          nodeColor={(node) => {
            const type = node.data?.graphNode?.node_type;
            const tint = type
              ? getComputedStyle(document.documentElement).getPropertyValue(`--ui-node-${type}`).trim()
              : '';
            return tint || SURFACE;
          }}
        />
      </ReactFlow>
    </div>
  );
}
