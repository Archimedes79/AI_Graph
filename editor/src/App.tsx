import { useCallback, useEffect, useState } from 'react';
import { showsPage } from '@/elements/nodes/gui/guiWidgets';
import { ReactFlowProvider } from 'reactflow';

import Toolbar from '@/app/Toolbar';
import Sidebar from '@/app/Sidebar';
import GraphCanvas from '@/canvas/GraphCanvas';
import DesignerTab from '@/page/DesignerTab';
import PreviewTab from '@/page/PreviewTab';
import ViewTabs, { type EditorView } from '@/app/ViewTabs';
import { useSchemeOnRoot } from '@/page/useSchemeOnRoot';
import NodeEditor from '@/canvas/NodeEditor';
import ConnectorEditor from '@/canvas/ConnectorEditor';
import ResultsPanel from '@/app/ResultsPanel';

import SettingsDialog from '@/app/SettingsDialog';
import Modal from '@/ui/Modal';
import FileBrowserDialog from '@/ui/FileBrowserDialog';

import { useGraphStore } from '@/store/graphStore';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { NodeType, Graph } from '@/graph';
import { DANGER_TEXT, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, TEXT, WELL } from '@/ui/theme';

export default function App() {
  const addNode = useGraphStore((s) => s.addNode);
  const editingNodeId = useGraphStore((s) => s.editingNodeId);
  const setEditingNode = useGraphStore((s) => s.setEditingNode);
  const editingPort = useGraphStore((s) => s.editingPort);
  const setEditingPort = useGraphStore((s) => s.setEditingPort);
  const loadGraph = useGraphStore((s) => s.loadGraph);
  // Saving and exporting are about the whole document, whichever level of it
  // the canvas is showing; running is about the level you are looking at.
  const rootGraph = useGraphStore((s) => s.rootGraph);
  const setRFNodes = useGraphStore((s) => s.setRFNodes);
  const setRFEdges = useGraphStore((s) => s.setRFEdges);
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const currentFilePath = useGraphStore((s) => s.currentFilePath);
  const setCurrentFilePath = useGraphStore((s) => s.setCurrentFilePath);
  const isDirty = useGraphStore((s) => s.isDirty);
  const markSaved = useGraphStore((s) => s.markSaved);
  const isProject = useGraphStore((s) => s.isProject);
  const insideSubgraph = useGraphStore((s) => s.subgraphStack.length > 0);
  const takeDiskChanges = useGraphStore((s) => s.takeDiskChanges);

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
  const guiScheme = useGraphStore((s) => s.metadata.gui_scheme);
  useSchemeOnRoot(guiScheme);

  // Editing a gui node means editing the page, and the page has its own tab --
  // at the size it will really be, next to the blocks it will really sit
  // beside. A dialog with a Config tab that only says 'go to the other tab'
  // and a Preview tab that shows nothing useful is a dialog worth not opening.
  const editingGuiNode = useGraphStore((s) => {
    const node = s.rfNodes.find((n) => n.id === s.editingNodeId)?.data.graphNode;
    return !!node && showsPage(node.node_type);
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
    let text: string;
    let graph: Graph;
    try {
      text = await file.text();
      graph = parseGraphJson(text);
    } catch (error) {
      setSaveStatus(`❌ ${errorText(error, `Could not read ${file.name}`)}`);
      return;
    }
    // A project's graph.json is its wiring only: the code, the prompts and the
    // positions are files beside it, which a browser does not hand over.
    // Loaded as it stands it would be every node stacked in one place with
    // nothing in it -- so it is not loaded, and the way that works is named.
    const raw = JSON.parse(text) as { nodes?: Array<{ position?: unknown }> };
    if (file.name === 'graph.json' && raw.nodes?.length && raw.nodes.every((node) => !node.position)) {
      setSaveStatus('❌ This is a project\'s graph.json: its code and prompts are files beside it, which a browser '
        + 'does not hand over. Drop the project folder, or open it with 📂 Open.');
      return;
    }
    if (!confirmDiscard(`Load ${file.name}?`)) return;
    loadGraph(graph);
    setCurrentFilePath(null);
    setSaveStatus(`✅ Loaded ${file.name}`);
  }, [confirmDiscard, loadGraph, parseGraphJson, setCurrentFilePath]);

  /**
   * A dropped folder: a project, most likely. A browser gives its name and not
   * where it is, so the editor's server looks for a project of that name under
   * the folder it runs in, and opens it when there is exactly one.
   */
  const handleProjectFolderDrop = useCallback(async (name: string) => {
    if (!confirmDiscard(`Open the project ${name}?`)) return;
    try {
      const { paths } = await call('findProjects', { name });
      if (paths.length !== 1) {
        setSaveStatus(paths.length
          ? `❌ ${paths.length} projects are called "${name}". Open the one you mean with 📂 Open.`
          : `❌ No project called "${name}" under the folder the editor was started in. Open it with 📂 Open.`);
        return;
      }
      const result = await call('openGraph', { path: paths[0] });
      loadGraph(result.graph);
      setCurrentFilePath(result.path, result.project);
      setSaveStatus(`✅ Opened ${result.path}`);
    } catch (error) {
      setSaveStatus(`❌ ${errorText(error, `Could not open ${name}`)}`);
    }
  }, [confirmDiscard, loadGraph, setCurrentFilePath]);

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
      // Only answerable while the event lasts: afterwards the item is gone.
      if (event.dataTransfer?.items?.[0]?.webkitGetAsEntry()?.isDirectory) void handleProjectFolderDrop(file.name);
      else void handleGraphFileDrop(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleGraphFileDrop, handleProjectFolderDrop]);

  // Add a node from a palette click
  const handleAddNode = useCallback(
    (nodeType: NodeType) => {
      // To the right of what is already there, not somewhere at random: a
      // random spot inside a 200px square put the second node on top of the
      // first more often than not, and a graph reads left to right anyway. The
      // gap is generous because a node widens once it is configured (a file
      // input grows a path field) and must not then cover its neighbour.
      const placed = useGraphStore.getState().rfNodes;
      const right = Math.max(0, ...placed.map((node) => node.position.x + (node.width ?? 240)));
      const top = placed.length ? Math.min(...placed.map((node) => node.position.y)) : 120;
      addNode(nodeType, placed.length ? { x: right + 160, y: top } : { x: 200, y: 120 });
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

  // A project folder by default: a name without .json. Typing .json saves one file instead.
  const suggestedFileName = () =>
    useGraphStore.getState().metadata.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'my_graph';

  // Open and Save As go straight to the file browser: choosing a file is what
  // they are for, and a path box first -- "/path/to/graph.json" -- asked the
  // one question a newcomer cannot answer. Closing the browser leaves the path
  // box, for whoever would rather type.
  const handleOpenLoad = () => {
    if (!confirmDiscard('Load another graph?')) return;
    setFilePrompt({ mode: 'load', path: currentFilePath ?? '', error: '', busy: false });
    setBrowsingFor('load');
  };

  const handleOpenSaveAs = () => {
    setFilePrompt({ mode: 'save', path: currentFilePath ?? suggestedFileName(), error: '', busy: false });
    setBrowsingFor('save');
  };

  /**
   * Open the project again from disk: for `graph.json` itself changing
   * outside -- a git pull, a merge. Code and prompts need no such thing: they
   * are watched (below).
   */
  const handleReloadProject = async () => {
    if (!currentFilePath) return;
    if (!confirmDiscard('Reload the project from disk?')) return;
    setSaveStatus('Reloading…');
    try {
      const result = await call('reloadGraph', { path: currentFilePath });
      loadGraph(result.graph);
      setCurrentFilePath(result.path, result.project);
      setSaveStatus('✅ Reloaded from disk');
    } catch (error) {
      setSaveStatus(`❌ ${errorText(error, 'Reload failed')}`);
    }
  };

  // A project's code and prompts are files, and files get edited elsewhere:
  // in VS Code, by git, by an assistant. The folder is asked every second and
  // a half what changed, and what did comes in as one undo step -- no reload,
  // no button, and nothing typed here is lost (see takeDiskChanges, and the
  // node dialog's "changed while open" question). Only while the page is
  // looked at: a hidden tab has nobody to show a change to.
  useEffect(() => {
    // Not while a node is open from the inside: a change down there arrives as
    // "that whole graph changed", which is the graph being edited right now.
    if (!isProject || !currentFilePath || insideSubgraph) return;
    let alive = true;
    const look = async () => {
      if (document.hidden) return;
      try {
        const { changes } = await call('projectChanges', { path: currentFilePath });
        if (!alive || !changes.length) return;
        const refused = takeDiskChanges(changes);
        const what = changes.filter((c) => !refused.includes(c.node_id))
          .map((c) => (c.widget_id ? `${c.node_id}/${c.widget_id}` : c.node_id));
        if (what.length) setSaveStatus(`↻ From disk: ${[...new Set(what)].join(', ')}`);
        // A graph inside a node changed on disk while there is unsaved work
        // here. Taking it would replace that graph whole, so it waits.
        if (refused.length) {
          setSaveStatus(`⚠ The graph inside ${[...new Set(refused)].join(', ')} changed on disk. `
            + 'Save or undo your changes, then reload the project to take it.');
        }
      } catch {
        // Half-written by the other editor, most likely: the next look gets it.
      }
    };
    const timer = window.setInterval(look, 1500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [isProject, currentFilePath, insideSubgraph, takeDiskChanges]);

  const handleSave = async () => {
    if (!currentFilePath) {
      handleOpenSaveAs();
      return;
    }
    setSaveStatus('Saving\u2026');
    try {
      await call('saveGraph', { path: currentFilePath, graph: rootGraph() });
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

  /** Load or save *chosen* -- a file picked in the browser -- or what the path box holds. */
  const handleFilePromptConfirm = async (chosen?: string) => {
    if (!filePrompt) return;
    const path = (chosen ?? filePrompt.path).trim();
    if (!path) {
      setFilePrompt({ ...filePrompt, error: 'Please enter a file path.' });
      return;
    }
    setFilePrompt({ ...filePrompt, busy: true, error: '' });
    try {
      if (filePrompt.mode === 'load') {
        const result = await call('openGraph', { path });
        loadGraph(result.graph);
        setCurrentFilePath(result.path, result.project);
      } else {
        // An untitled graph is called what it was saved as: reopened, it
        // should not say "Untitled Graph" above a folder named word_stats.
        if (useGraphStore.getState().metadata.name === 'Untitled Graph') {
          setMetadata({ name: (path.split(/[\\/]/).filter(Boolean).pop() ?? '').replace(/\.json$/i, '') || 'Untitled Graph' });
        }
        const result = await call('saveGraph', { path, graph: rootGraph() });
        setCurrentFilePath(result.path, result.project);
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
    setJsonImportValue(JSON.stringify(rootGraph(), null, 2));
    setJsonImportError('');
    setCopyStatus('');
    setShowJsonImport(true);
  }, [rootGraph]);

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
          onReloadProject={handleReloadProject}
          onLoad={handleOpenLoad}
          onInjectJson={handleOpenJsonImport}
          onOpenSettings={() => setShowSettings(true)}
          confirmDiscard={confirmDiscard}
          currentFilePath={currentFilePath}
          onShowInterface={() => setView('preview')}
          interfaceShown={view === 'preview'}
          saveStatus={saveStatus}
        />

        <ViewTabs view={view} onChange={setView} />

        {/* Both views stay mounted: the graph keeps its ReactFlow viewport, and
            switching back does not reset the canvas or lose a selection. */}
        <div className="flex flex-1 overflow-hidden" style={{ display: view === 'graph' ? 'flex' : 'none' }}>
          <Sidebar onAddNode={handleAddNode} />
          <GraphCanvas active={view === 'graph'} />
          <ResultsPanel />
        </div>
        {view === 'design' && <DesignerTab />}
        {view === 'preview' && <PreviewTab />}

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
                  onClick={() => { void handleFilePromptConfirm(); }}
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
            projects
            defaultName={suggestedFileName()}
            onPick={(picked) => {
              // Picking a file is the choice: it is loaded, or saved to, straight away.
              setFilePrompt({ ...filePrompt, path: picked, error: '' });
              setBrowsingFor(null);
              void handleFilePromptConfirm(picked);
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
