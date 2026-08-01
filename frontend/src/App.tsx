import React, { useCallback, useRef } from 'react';
import { ReactFlowProvider } from 'reactflow';

import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import GraphCanvas from './components/GraphCanvas';
import NodeEditor from './components/NodeEditor';
import ResultsPanel from './components/ResultsPanel';
import TextOutputWindows from './components/TextOutputWindows';

import { useGraphStore } from './store/graphStore';
import type { NodeType, Graph } from './types/graph';

export default function App() {
  const addNode = useGraphStore((s) => s.addNode);
  const editingNodeId = useGraphStore((s) => s.editingNodeId);
  const setEditingNode = useGraphStore((s) => s.setEditingNode);
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const setRFNodes = useGraphStore((s) => s.setRFNodes);
  const setRFEdges = useGraphStore((s) => s.setRFEdges);
  const setMetadata = useGraphStore((s) => s.setMetadata);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add a node in the center of the canvas
  const handleAddNode = useCallback(
    (nodeType: NodeType) => {
      addNode(nodeType, { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 });
    },
    [addNode]
  );

  const handleNewGraph = () => {
    if (window.confirm('Start a new graph? Unsaved changes will be lost.')) {
      setRFNodes([]);
      setRFEdges([]);
      setMetadata({ name: 'Untitled Graph', description: '', author: '', tags: [], version: '1.0.0' });
    }
  };

  const handleSave = () => {
    const graph = exportGraph();
    const json = JSON.stringify(graph, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graph.metadata.name.toLowerCase().replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const graph: Graph = JSON.parse(ev.target?.result as string);
        loadGraph(graph);
      } catch {
        alert('Invalid graph JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#0f1117' }}>
        <Toolbar
          onNewGraph={handleNewGraph}
          onSave={handleSave}
          onLoad={handleLoadClick}
        />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar onAddNode={handleAddNode} />
          <GraphCanvas />
          <ResultsPanel />
        </div>

        {editingNodeId && (
          <NodeEditor
            nodeId={editingNodeId}
            onClose={() => setEditingNode(null)}
          />
        )}

        <TextOutputWindows />

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileLoad}
        />
      </div>
    </ReactFlowProvider>
  );
}
