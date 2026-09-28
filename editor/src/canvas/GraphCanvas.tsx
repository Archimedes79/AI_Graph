import React, { useCallback, useMemo, useRef, DragEvent } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  NodeChange,
  EdgeChange,
  BackgroundVariant,
  ReactFlowInstance,
  getNodesBounds,
  getViewportForBounds,
  useStore,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useGraphStore } from '@/store/graphStore';
import GraphNodeView from './GraphNodeView';
import { deleteKeys, removalsToApply } from './nodeRemoval';
import { drawnWire } from './wireLook';
import { panToShow, viewDue, type ViewDue } from './inView';
import { showsPage } from '@/document/guiWidgets';
import type { NodeType } from '@/graph';
import { LINE, PANEL, SUNKEN, SURFACE } from '@/ui/theme';

const nodeTypes = { graphNode: GraphNodeView };

/**
 * @param active Whether the graph tab is the one on screen.
 * @param onOpenPage Show the Page tab: what double-clicking the page's card
 *   does, since the page is built there.
 *
 * The canvas stays mounted while another tab is shown, so switching back keeps
 * the viewport and the selection. Its keyboard shortcuts stayed live with it:
 * pressing Delete on the surface designer removed the selected block *and* the
 * gui node selected back on the canvas, which is the whole page -- so Delete
 * looked like it deleted everything. Keys belong to the view you are looking
 * at.
 */
export default function GraphCanvas({ active = true, onOpenPage }: { active?: boolean; onOpenPage?: () => void }) {
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const setRFNodes = useGraphStore((s) => s.setRFNodes);
  const setRFEdges = useGraphStore((s) => s.setRFEdges);
  const connect = useGraphStore((s) => s.connect);
  const commit = useGraphStore((s) => s.commit);
  const setEditingNode = useGraphStore((s) => s.setEditingNode);
  const clearSelection = useGraphStore((s) => s.clearSelection);
  // The nodes whose wires are drawn in the accent, as one string: it changes
  // when the selection does, not on every frame of a drag.
  const lit = useGraphStore((s) => [s.editingNodeId, ...s.rfNodes.filter((n) => n.selected).map((n) => n.id)]
    .filter(Boolean).join('\n'));
  const edges = useMemo(() => {
    const selected = new Set(lit.split('\n'));
    return rfEdges.map((edge) => drawnWire(edge, selected));
  }, [rfEdges, lit]);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = React.useState<ReactFlowInstance | null>(null);
  // Whether a key pressed now is pressed on the canvas (`deleteKeys`).
  const [focused, setFocused] = React.useState(false);

  // What the view owes (`viewDue`): another graph fitted whole; a node added,
  // or one whose panel opens, brought into sight by as little as that takes.
  // Paid once the canvas is on screen and what it is about is measured, at the
  // canvas's own size as it is then: a fit on a timer ran before the node was
  // measured, and did nothing -- a palette node stayed out of sight, and New
  // kept the last graph's view.
  const documentOpen = useGraphStore((s) => s.document);
  const openId = useGraphStore((s) => s.editingNodeId);
  const minZoom = useStore((s) => s.minZoom);
  const due = useRef<ViewDue>({ document: documentOpen, count: rfNodes.length, open: openId, fit: false, show: null });
  React.useEffect(() => {
    due.current = viewDue(due.current, { document: documentOpen, ids: rfNodes.map((node) => node.id), open: openId });
    const owed = due.current;
    const wrapper = reactFlowWrapper.current;
    if (!rfInstance || !wrapper || !active || !wrapper.clientWidth || !wrapper.clientHeight) return;
    const measured = (node: { width?: number | null; height?: number | null }) => !!node.width && !!node.height;
    if (owed.fit) {
      const nodes = rfInstance.getNodes();
      if (!nodes.every(measured)) return;
      // An empty graph starts where the first node goes (`besideTheRest`) is in sight.
      rfInstance.setViewport(nodes.length
        ? getViewportForBounds(getNodesBounds(nodes), wrapper.clientWidth, wrapper.clientHeight, minZoom, 1, 0.25)
        : { x: 0, y: 0, zoom: 1 });
      owed.fit = false;
      owed.show = null;
      return;
    }
    if (!owed.show) return;
    const node = rfInstance.getNode(owed.show);
    if (node && !measured(node)) return;
    owed.show = null;
    if (!node) return;
    const { x, y, zoom } = rfInstance.getViewport();
    const at = node.positionAbsolute ?? node.position;
    const { dx, dy } = panToShow(
      { x: at.x * zoom + x, y: at.y * zoom + y, width: node.width! * zoom, height: node.height! * zoom },
      { x: 0, y: 0, width: wrapper.clientWidth, height: wrapper.clientHeight },
    );
    if (dx || dy) rfInstance.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 250 });
  }, [rfNodes, rfInstance, active, documentOpen, openId, minZoom]);
  // The map of the whole graph, only where the canvas has room for it beside
  // what it maps: beside a node's panel at 1024 it covered a third of it.
  const roomy = useStore((s) => s.width >= 640);

  // The wire itself is the store's to make (`connect`): a canvas is one way
  // to ask for one, and a test is another.
  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return;
    connect({ source: params.source, sourceHandle: params.sourceHandle, target: params.target, targetHandle: params.targetHandle });
  }, [connect]);

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

      // With its panel open, as a palette click adds one: the next click was always on it.
      const store = useGraphStore.getState();
      store.setEditingNode(store.addNode(nodeType, position));
    },
    [rfInstance]
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    // Focusable, so a click on the empty canvas puts the keys here: Delete
    // deletes what is selected only when it was pressed on the canvas.
    <div
      ref={reactFlowWrapper}
      className="flex-1 min-h-0 outline-none"
      tabIndex={-1}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        onNodesChange={(changes: NodeChange[]) => {
          // A drag reports a position change per frame, so history points come
          // from onNodeDragStart instead; removals have no such event and are
          // committed here, before they are applied.
          const kept = removalsToApply(
            changes,
            (id) => rfNodes.find((n) => n.id === id)?.data.graphNode,
            window.confirm,
          );
          if (kept.some((c) => c.type === 'remove')) commit();
          setRFNodes(applyNodeChanges(kept, rfNodes) as typeof rfNodes);
        }}
        onNodeDragStart={() => commit()}
        onEdgesChange={(changes: EdgeChange[]) => {
          if (changes.some((c) => c.type === 'remove')) commit();
          setRFEdges(applyEdgeChanges(changes, rfEdges));
        }}
        onConnect={onConnect}
        // One click on a node is the node the person is on: its panel opens
        // beside the canvas, and the bar under it speaks of it. With Shift or
        // Ctrl held a click only adds to what is selected, to move or delete.
        onNodeClick={(event, node) => {
          if (event.shiftKey || event.ctrlKey || event.metaKey) return;
          setEditingNode(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          if (showsPage(node.data.graphNode.node_type)) onOpenPage?.();
        }}
        onPaneClick={clearSelection}
        nodeTypes={nodeTypes}
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
        deleteKeyCode={deleteKeys(active, focused)}
        style={{ background: SUNKEN }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color={LINE}
        />
        <Controls
          style={PANEL}
        />
        {roomy && (
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
        )}
      </ReactFlow>
    </div>
  );
}
