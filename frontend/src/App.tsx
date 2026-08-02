import React, { useCallback, useRef, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';

import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import GraphCanvas from './components/GraphCanvas';
import NodeEditor from './components/NodeEditor';
import ConnectorEditor from './components/ConnectorEditor';
import ResultsPanel from './components/ResultsPanel';

import { useGraphStore } from './store/graphStore';
import type { NodeType, Graph } from './types/graph';
import type { NodePreset } from './utils/nodeDefaults';

export default function App() {
  const addNode = useGraphStore((s) => s.addNode);
  const addPresetNode = useGraphStore((s) => s.addPresetNode);
  const editingNodeId = useGraphStore((s) => s.editingNodeId);
  const setEditingNode = useGraphStore((s) => s.setEditingNode);
  const editingPort = useGraphStore((s) => s.editingPort);
  const setEditingPort = useGraphStore((s) => s.setEditingPort);
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const setRFNodes = useGraphStore((s) => s.setRFNodes);
  const setRFEdges = useGraphStore((s) => s.setRFEdges);
  const setMetadata = useGraphStore((s) => s.setMetadata);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [jsonImportValue, setJsonImportValue] = useState('');
  const [jsonImportError, setJsonImportError] = useState('');

  const parseGraphJson = useCallback((raw: string): Graph => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Malformed JSON.';
      throw new Error(`Invalid graph JSON: ${message}`);
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('nodes' in parsed) ||
      !('edges' in parsed) ||
      !Array.isArray((parsed as Graph).nodes) ||
      !Array.isArray((parsed as Graph).edges)
    ) {
      throw new Error('Invalid graph JSON: expected nodes and edges arrays.');
    }

    return parsed as Graph;
  }, []);

  // Add a node in the center of the canvas
  const handleAddNode = useCallback(
    (nodeType: NodeType) => {
      addNode(nodeType, { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 });
    },
    [addNode]
  );

  const handleAddPreset = useCallback(
    (preset: NodePreset) => {
      addPresetNode(preset, { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 });
    },
    [addPresetNode]
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

  const handleOpenJsonImport = useCallback(() => {
    setJsonImportValue(JSON.stringify(exportGraph(), null, 2));
    setJsonImportError('');
    setShowJsonImport(true);
  }, [exportGraph]);

  const handleImportGraph = useCallback(() => {
    try {
      const graph = parseGraphJson(jsonImportValue);
      loadGraph(graph);
      setShowJsonImport(false);
      setJsonImportError('');
    } catch (error) {
      setJsonImportError(error instanceof Error ? error.message : 'Invalid graph JSON.');
    }
  }, [jsonImportValue, loadGraph, parseGraphJson]);

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const graph = parseGraphJson(ev.target?.result as string);
        loadGraph(graph);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Invalid graph JSON file.');
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
          onInjectJson={handleOpenJsonImport}
        />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar onAddNode={handleAddNode} onAddPreset={handleAddPreset} />
          <GraphCanvas />
          <ResultsPanel />
        </div>

        {editingNodeId && (
          <NodeEditor
            nodeId={editingNodeId}
            onClose={() => setEditingNode(null)}
          />
        )}

        {editingPort && (
          <ConnectorEditor
            nodeId={editingPort.nodeId}
            portId={editingPort.portId}
            onClose={() => setEditingPort(null)}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileLoad}
        />

        {showJsonImport && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setShowJsonImport(false)}
          >
            <div
              className="rounded-xl overflow-hidden shadow-2xl w-full max-w-3xl mx-4"
              style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between px-5 py-3"
                style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
              >
                <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>
                  Load Graph JSON
                </span>
                <button onClick={() => setShowJsonImport(false)} style={{ color: '#94a3b8' }}>✕</button>
              </div>

              <div className="p-5 flex flex-col gap-3">
                <textarea
                  value={jsonImportValue}
                  onChange={(e) => {
                    setJsonImportValue(e.target.value);
                    if (jsonImportError) setJsonImportError('');
                  }}
                  className="w-full rounded-lg p-4 text-sm font-mono resize-y outline-none"
                  style={{
                    minHeight: 320,
                    background: '#0f1117',
                    border: '1px solid #2d3148',
                    color: '#e2e8f0',
                  }}
                  spellCheck={false}
                />

                {jsonImportError && (
                  <div className="text-xs" style={{ color: '#fca5a5' }}>
                    {jsonImportError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowJsonImport(false)}
                    className="px-3 py-1.5 text-xs rounded-lg"
                    style={{ background: '#2d3148', color: '#e2e8f0' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleImportGraph}
                    className="px-3 py-1.5 text-xs rounded-lg font-semibold"
                    style={{ background: '#6366f1', color: 'white' }}
                  >
                    Load Graph
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}
