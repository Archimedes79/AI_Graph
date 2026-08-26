import React, { useCallback, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';

import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import GraphCanvas from './components/GraphCanvas';
import NodeEditor from './components/NodeEditor';
import ConnectorEditor from './components/ConnectorEditor';
import ResultsPanel from './components/ResultsPanel';
import GuiWindowLayer from './components/gui/GuiWindowLayer';
import SettingsDialog from './components/SettingsDialog';

import { useGraphStore } from './store/graphStore';
import { loadGraphFile, saveGraphFile } from './utils/api';
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
  const currentFilePath = useGraphStore((s) => s.currentFilePath);
  const setCurrentFilePath = useGraphStore((s) => s.setCurrentFilePath);

  const [showSettings, setShowSettings] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [jsonImportValue, setJsonImportValue] = useState('');
  const [jsonImportError, setJsonImportError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

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
      setCurrentFilePath(null);
    }
  };

  // Path-based Load/Save/Save As -- a small modal collects the absolute
  // server-side path, so "Save" can later write back to the exact same file
  // a graph was loaded from instead of always downloading to a new location.
  const [filePrompt, setFilePrompt] = useState<{ mode: 'load' | 'save'; path: string; error: string; busy: boolean } | null>(null);
  const [saveStatus, setSaveStatus] = useState('');

  const suggestedFileName = () =>
    `${useGraphStore.getState().metadata.name.toLowerCase().replace(/\s+/g, '_') || 'graph'}.json`;

  const handleOpenLoad = () => {
    setFilePrompt({ mode: 'load', path: currentFilePath ?? '', error: '', busy: false });
  };

  const handleOpenSaveAs = () => {
    setFilePrompt({ mode: 'save', path: currentFilePath ?? suggestedFileName(), error: '', busy: false });
  };

  const handleSave = async () => {
    if (!currentFilePath) {
      handleOpenSaveAs();
      return;
    }
    setSaveStatus('Saving\u2026');
    try {
      await saveGraphFile(currentFilePath, exportGraph());
      setSaveStatus(`\u2705 Saved to ${currentFilePath}`);
    } catch (error: any) {
      setSaveStatus(`\u274c ${error?.response?.data?.detail ?? error?.message ?? 'Save failed'}`);
    }
  };

  const handleFilePromptConfirm = async () => {
    if (!filePrompt) return;
    const path = filePrompt.path.trim();
    if (!path) {
      setFilePrompt({ ...filePrompt, error: 'Please enter a file path.' });
      return;
    }
    setFilePrompt({ ...filePrompt, busy: true, error: '' });
    try {
      if (filePrompt.mode === 'load') {
        const result = await loadGraphFile(path);
        loadGraph(result.graph);
        setCurrentFilePath(result.path);
      } else {
        const result = await saveGraphFile(path, exportGraph());
        setCurrentFilePath(result.path);
        setSaveStatus(`\u2705 Saved to ${result.path}`);
      }
      setFilePrompt(null);
    } catch (error: any) {
      setFilePrompt({
        mode: filePrompt.mode, path, busy: false,
        error: error?.response?.data?.detail ?? error?.message ?? 'Something went wrong.',
      });
    }
  };

  const handleOpenJsonImport = useCallback(() => {
    setJsonImportValue(JSON.stringify(exportGraph(), null, 2));
    setJsonImportError('');
    setCopyStatus('');
    setShowJsonImport(true);
  }, [exportGraph]);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonImportValue);
      setCopyStatus('✅ Copied to clipboard');
    } catch {
      setCopyStatus('❌ Could not access the clipboard');
    }
  };

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

  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#0f1117' }}>
        <Toolbar
          onNewGraph={handleNewGraph}
          onSave={handleSave}
          onSaveAs={handleOpenSaveAs}
          onLoad={handleOpenLoad}
          onInjectJson={handleOpenJsonImport}
          onOpenSettings={() => setShowSettings(true)}
          currentFilePath={currentFilePath}
          saveStatus={saveStatus}
        />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar onAddNode={handleAddNode} onAddPreset={handleAddPreset} />
          <GraphCanvas />
          <ResultsPanel />
        </div>

        <GuiWindowLayer />

        {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

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

        {filePrompt && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => !filePrompt.busy && setFilePrompt(null)}
          >
            <div
              className="rounded-xl overflow-hidden shadow-2xl w-full max-w-lg mx-4"
              style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between px-5 py-3"
                style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
              >
                <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>
                  {filePrompt.mode === 'load' ? 'Load Graph' : 'Save Graph As'}
                </span>
                <button onClick={() => setFilePrompt(null)} style={{ color: '#94a3b8' }}>✕</button>
              </div>

              <div className="p-5 flex flex-col gap-3">
                <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                  File path
                </label>
                <input
                  autoFocus
                  className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none"
                  style={{ background: '#0f1117', border: '1px solid #2d3148', color: '#e2e8f0' }}
                  value={filePrompt.path}
                  onChange={(e) => setFilePrompt({ ...filePrompt, path: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && handleFilePromptConfirm()}
                  placeholder="/path/to/graph.json"
                />

                {filePrompt.error && (
                  <div className="text-xs" style={{ color: '#fca5a5' }}>
                    {filePrompt.error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setFilePrompt(null)}
                    disabled={filePrompt.busy}
                    className="px-3 py-1.5 text-xs rounded-lg"
                    style={{ background: '#2d3148', color: '#e2e8f0', opacity: filePrompt.busy ? 0.5 : 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleFilePromptConfirm}
                    disabled={filePrompt.busy}
                    className="px-3 py-1.5 text-xs rounded-lg font-semibold"
                    style={{ background: '#6366f1', color: 'white', opacity: filePrompt.busy ? 0.7 : 1 }}
                  >
                    {filePrompt.busy ? '…' : filePrompt.mode === 'load' ? 'Load' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
                  Copy / Paste Graph JSON
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

                {copyStatus && (
                  <div className="text-xs" style={{ color: '#94a3b8' }}>
                    {copyStatus}
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
                    onClick={handleCopyJson}
                    className="px-3 py-1.5 text-xs rounded-lg"
                    style={{ background: '#2d3148', color: '#e2e8f0' }}
                  >
                    📋 Copy to Clipboard
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
