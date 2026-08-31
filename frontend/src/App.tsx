import React, { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';

import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import GraphCanvas from './components/GraphCanvas';
import DesignerTab from './components/gui/DesignerTab';
import ViewTabs, { type EditorView } from './components/ViewTabs';
import NodeEditor from './components/NodeEditor';
import ConnectorEditor from './components/ConnectorEditor';
import ResultsPanel from './components/ResultsPanel';

import SettingsDialog from './components/SettingsDialog';
import Modal from './components/Modal';
import FileBrowserDialog from './components/FileBrowserDialog';

import { useGraphStore } from './store/graphStore';
import { NODE_ELEMENTS } from './elements/registry';
import { loadGraphFile, reloadNodeFiles, saveGraphFile } from './utils/api';
import { errorText } from './utils/errorText';
import type { NodeType, Graph } from './types/graph';
import { DANGER_TEXT, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, TEXT, WELL } from './ui/theme';

export default function App() {
  const addNode = useGraphStore((s) => s.addNode);
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
  const isDirty = useGraphStore((s) => s.isDirty);
  const markSaved = useGraphStore((s) => s.markSaved);
  const syncNodeFileNames = useGraphStore((s) => s.syncNodeFileNames);

  // The browser's own "leave site?" prompt. Nothing else stands between an
  // hour of wiring and an accidental Cmd-R or tab close: the graph lives only
  // in memory until it is written to a file.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  /**
   * Ask before replacing the current graph. Every path that calls `loadGraph`
   * goes through here -- New, Load, Paste JSON and ✨ AI Graph all destroy
   * unsaved work otherwise, and only New used to say so.
   */
  const confirmDiscard = useCallback(
    (action: string) => !isDirty() || window.confirm(`${action} Unsaved changes to the current graph will be lost.`),
    [isDirty],
  );

  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<EditorView>('graph');

  // Editing a gui node means editing the page, and the page has its own tab --
  // at the size it will really be, next to the blocks it will really sit
  // beside. A dialog with a Config tab that only says 'go to the other tab'
  // and a Preview tab that shows nothing useful is a dialog worth not opening.
  const editingGuiNode = useGraphStore((s) => {
    const node = s.rfNodes.find((n) => n.id === s.editingNodeId)?.data.graphNode;
    return !!node && !!NODE_ELEMENTS[node.node_type]?.hasRuntimeWindow;
  });
  useEffect(() => {
    if (!editingGuiNode) return;
    setView('design');
    setEditingNode(null);
  }, [editingGuiNode, setEditingNode]);
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

  /**
   * Load a graph JSON dropped anywhere on the window.
   *
   * Registered on the window rather than on the canvas for two reasons: a file
   * dropped just outside the canvas would otherwise make the BROWSER open it,
   * navigating away and taking the unsaved graph with it -- and having to hit
   * the canvas exactly is a poor way to load a file. Palette drags are
   * untouched: this only ever reacts to a real file.
   *
   * The browser does not reveal where a dropped file lives, so the loaded graph
   * has no file path and Save will ask for one, exactly as after Paste JSON.
   */
  const handleGraphFileDrop = useCallback(async (file: File) => {
    if (!/\.json$/i.test(file.name)) {
      setSaveStatus(`❌ ${file.name} is not a .json graph file.`);
      return;
    }
    let graph: Graph;
    try {
      graph = parseGraphJson(await file.text());
    } catch (error) {
      setSaveStatus(`❌ ${errorText(error, `Could not read ${file.name}`)}`);
      return;
    }
    if (!confirmDiscard(`Load ${file.name}?`)) return;
    loadGraph(graph);
    setCurrentFilePath(null);
    setSaveStatus(`✅ Loaded ${file.name}`);
  }, [confirmDiscard, loadGraph, parseGraphJson, setCurrentFilePath]);

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;   // a palette drag: leave it to the canvas
      event.preventDefault();
      void handleGraphFileDrop(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleGraphFileDrop]);

  // Add a node in the center of the canvas
  const handleAddNode = useCallback(
    (nodeType: NodeType) => {
      addNode(nodeType, { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 });
    },
    [addNode]
  );

  const handleNewGraph = () => {
    if (!confirmDiscard('Start a new graph?')) return;
    setRFNodes([]);
    setRFEdges([]);
    setMetadata({ name: 'Untitled Graph', description: '', author: '', tags: [], version: '1.0.0' });
    setCurrentFilePath(null);
    markSaved();
  };

  // Path-based Load/Save/Save As -- a small modal collects the absolute
  // server-side path, so "Save" can later write back to the exact same file
  // a graph was loaded from instead of always downloading to a new location.
  const [filePrompt, setFilePrompt] = useState<{ mode: 'load' | 'save'; path: string; error: string; busy: boolean } | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  /** Which file prompt has its browser open ('load' | 'save'), or null. */
  const [browsingFor, setBrowsingFor] = useState<'load' | 'save' | null>(null);

  const suggestedFileName = () =>
    `${useGraphStore.getState().metadata.name.toLowerCase().replace(/\s+/g, '_') || 'graph'}.json`;

  const handleOpenLoad = () => {
    if (!confirmDiscard('Load another graph?')) return;
    setFilePrompt({ mode: 'load', path: currentFilePath ?? '', error: '', busy: false });
  };

  const handleOpenSaveAs = () => {
    setFilePrompt({ mode: 'save', path: currentFilePath ?? suggestedFileName(), error: '', busy: false });
  };

  /**
   * Take whatever the node files say now.
   *
   * The graph is reopened from disk rather than patched field by field: the
   * files are authoritative for what they carry, so re-reading is the same
   * operation as opening, and asking first is the same courtesy.
   */
  const handleReloadNodeFiles = async () => {
    if (!currentFilePath) return;
    if (!confirmDiscard('Reload the node files?')) return;
    setSaveStatus('Reloading…');
    try {
      const result = await reloadNodeFiles(currentFilePath);
      loadGraph(result.graph);
      setCurrentFilePath(result.path);
      setSaveStatus('✅ Node files reloaded');
    } catch (error) {
      setSaveStatus(`❌ ${errorText(error, 'Reload failed')}`);
    }
  };

  const handleSave = async () => {
    if (!currentFilePath) {
      handleOpenSaveAs();
      return;
    }
    setSaveStatus('Saving\u2026');
    try {
      const result = await saveGraphFile(currentFilePath, exportGraph());
      if (result.graph) syncNodeFileNames(result.graph);
      markSaved();
      setSaveStatus(`\u2705 Saved to ${currentFilePath}`);
    } catch (error) {
      setSaveStatus(`\u274c ${errorText(error, 'Save failed')}`);
    }
  };

  // Ctrl/Cmd+S, because the only other way to save is a trip to the toolbar,
  // and Ctrl/Cmd+Z / Shift+Z / Y for undo and redo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        handleSave();
        return;
      }

      // While the caret is in a field, Ctrl+Z belongs to that field's own text
      // history -- taking it would undo a graph change the user cannot see
      // instead of the word they just typed.
      const target = event.target as HTMLElement | null;
      const typing = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      );
      if (typing) return;

      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useGraphStore.getState().undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        useGraphStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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
        if (result.graph) syncNodeFileNames(result.graph);
        markSaved();
        setSaveStatus(`\u2705 Saved to ${result.path}`);
      }
      setFilePrompt(null);
    } catch (error) {
      setFilePrompt({
        mode: filePrompt.mode, path, busy: false,
        error: errorText(error, 'Something went wrong.'),
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
    if (!confirmDiscard('Replace the current graph with this JSON?')) return;
    try {
      const graph = parseGraphJson(jsonImportValue);
      loadGraph(graph);
      setShowJsonImport(false);
      setJsonImportError('');
    } catch (error) {
      setJsonImportError(error instanceof Error ? error.message : 'Invalid graph JSON.');
    }
  }, [confirmDiscard, jsonImportValue, loadGraph, parseGraphJson]);

  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: SUNKEN }}>
        <Toolbar
          onNewGraph={handleNewGraph}
          onSave={handleSave}
          onSaveAs={handleOpenSaveAs}
          onReloadNodeFiles={handleReloadNodeFiles}
          onLoad={handleOpenLoad}
          onInjectJson={handleOpenJsonImport}
          onOpenSettings={() => setShowSettings(true)}
          confirmDiscard={confirmDiscard}
          currentFilePath={currentFilePath}
          saveStatus={saveStatus}
        />

        <ViewTabs view={view} onChange={setView} />

        {/* Both views stay mounted: the graph keeps its ReactFlow viewport, and
            switching back does not reset the canvas or lose a selection. */}
        <div className="flex flex-1 overflow-hidden" style={{ display: view === 'graph' ? 'flex' : 'none' }}>
          <Sidebar onAddNode={handleAddNode} />
          <GraphCanvas />
          <ResultsPanel />
        </div>
        {view === 'design' && <DesignerTab />}


        {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

        {editingNodeId && !editingGuiNode && (
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
          <Modal
            title={filePrompt.mode === 'load' ? 'Load Graph' : 'Save Graph As'}
            onClose={() => setFilePrompt(null)}
            dismissOnBackdrop={!filePrompt.busy}
            dismissOnEscape={!filePrompt.busy}
            footer={
              <>
                <button
                  onClick={() => setFilePrompt(null)}
                  disabled={filePrompt.busy}
                  className="px-3 py-1.5 text-xs rounded-lg"
                  style={{ ...NEUTRAL_BUTTON, opacity: filePrompt.busy ? 0.5 : 1 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleFilePromptConfirm}
                  disabled={filePrompt.busy}
                  className="px-3 py-1.5 text-xs rounded-lg font-semibold"
                  style={{ ...PRIMARY_BUTTON, opacity: filePrompt.busy ? 0.7 : 1 }}
                >
                  {filePrompt.busy ? '…' : filePrompt.mode === 'load' ? 'Load' : 'Save'}
                </button>
              </>
            }
          >
            <div className="p-5 flex flex-col gap-3">
                <label className="text-xs font-medium" style={{ color: MUTED }}>
                  File path
                </label>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm font-mono outline-none"
                    style={{ ...WELL, color: TEXT }}
                    value={filePrompt.path}
                    onChange={(e) => setFilePrompt({ ...filePrompt, path: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && handleFilePromptConfirm()}
                    placeholder="/path/to/graph.json"
                  />
                  <button
                    type="button"
                    className="px-3 py-2 text-xs rounded-lg flex-shrink-0"
                    style={NEUTRAL_BUTTON}
                    disabled={filePrompt.busy}
                    onClick={() => setBrowsingFor(filePrompt.mode)}
                  >
                    Browse…
                  </button>
                </div>

              {filePrompt.error && (
                <div className="text-xs" style={{ color: DANGER_TEXT }}>
                  {filePrompt.error}
                </div>
              )}
            </div>
          </Modal>
        )}

        {filePrompt && browsingFor && (
          <FileBrowserDialog
            mode={browsingFor === 'load' ? 'file' : 'save'}
            initialPath={filePrompt.path}
            extensions=".json"
            defaultName={suggestedFileName()}
            onPick={(picked) => {
              setFilePrompt({ ...filePrompt, path: picked, error: '' });
              setBrowsingFor(null);
            }}
            onClose={() => setBrowsingFor(null)}
          />
        )}

        {showJsonImport && (
          <Modal
            title="Copy / Paste Graph JSON"
            onClose={() => setShowJsonImport(false)}
            maxWidth="max-w-3xl"
            // Pasted JSON is typed work: a stray backdrop click must not lose it.
            dismissOnBackdrop={false}
            footer={
              <>
                <button
                  onClick={() => setShowJsonImport(false)}
                  className="px-3 py-1.5 text-xs rounded-lg"
                  style={NEUTRAL_BUTTON}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCopyJson}
                  className="px-3 py-1.5 text-xs rounded-lg"
                  style={NEUTRAL_BUTTON}
                >
                  📋 Copy to Clipboard
                </button>
                <button
                  onClick={handleImportGraph}
                  className="px-3 py-1.5 text-xs rounded-lg font-semibold"
                  style={PRIMARY_BUTTON}
                >
                  Load Graph
                </button>
              </>
            }
          >
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
                    background: SUNKEN,
                    border: `1px solid ${LINE}`,
                    color: TEXT,
                  }}
                  spellCheck={false}
                />

                {jsonImportError && (
                  <div className="text-xs" style={{ color: DANGER_TEXT }}>
                    {jsonImportError}
                  </div>
                )}

              {copyStatus && (
                <div className="text-xs" style={{ color: MUTED }}>
                  {copyStatus}
                </div>
              )}
            </div>
          </Modal>
        )}
      </div>
    </ReactFlowProvider>
  );
}
