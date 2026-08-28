import React, { useEffect, useState } from 'react';
import {
  ClipboardCopy, FilePlus2, FolderOpen, Play, Redo2, Rocket, Save, SaveAll, Settings, Sparkles, Square, Undo2,
} from 'lucide-react';
import ToolbarButton, { ToolbarSeparator } from './ToolbarButton';
import { useGraphStore } from '../store/graphStore';
import { downloadBundle, getDockerCompose, getRuntimeRequirements, generateGraph } from '../utils/api';
import { errorText } from '../utils/errorText';
import type { Graph, RuntimeRequirement } from '../types/graph';
import { syncGuiNodePorts } from '../utils/guiWidgets';
import { genAI } from '../store/settingsStore';
import GraphWindows from './GraphWindows';
import Modal from './Modal';
import { ACCENT, ACCENT_TEXT, DANGER, DANGER_TEXT, DIM, DIMMER, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUCCESS, SUNKEN, SURFACE, TEXT } from '../ui/theme';

interface ToolbarProps {
  onNewGraph: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onLoad: () => void;
  onInjectJson: () => void;
  onOpenSettings: () => void;
  /** Ask before replacing the current graph; false means the user said no. */
  confirmDiscard: (action: string) => boolean;
  currentFilePath: string | null;
  saveStatus: string;
}

export default function Toolbar({
  onNewGraph, onSave, onSaveAs, onLoad, onInjectJson, onOpenSettings, confirmDiscard,
  currentFilePath, saveStatus,
}: ToolbarProps) {
  const metadata = useGraphStore((s) => s.metadata);
  // Subscribed to so the toolbar re-renders when the graph changes and the
  // "✅ Saved" line below can stop claiming something that is no longer true.
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const isDirty = useGraphStore((s) => s.isDirty);
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const isExecuting = useGraphStore((s) => s.isExecuting);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const runGraph = useGraphStore((s) => s.runGraph);
  const stopRun = useGraphStore((s) => s.stopRun);
  const runProgress = useGraphStore((s) => s.runProgress);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  // Subscribe to the stack lengths, not to canUndo/canRedo: selecting a function
  // never changes identity, so the buttons would never re-enable.
  const undoAvailable = useGraphStore((s) => s.past.length > 0);
  const redoAvailable = useGraphStore((s) => s.future.length > 0);
  const executionResult = useGraphStore((s) => s.executionResult);
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const updateNode = useGraphStore((s) => s.updateNode);

  const [showDeploy, setShowDeploy] = useState(false);
  const [deployBusy, setDeployBusy] = useState('');
  const [deployError, setDeployError] = useState('');
  const [deployContent, setDeployContent] = useState('');
  const [deployLabel, setDeployLabel] = useState('');
  const [pendingRequirements, setPendingRequirements] = useState<RuntimeRequirement[] | null>(null);
  const [pendingGraph, setPendingGraph] = useState<Graph | null>(null);

  const [showAiGraph, setShowAiGraph] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<{ graph: Graph; explanation?: string } | null>(null);

  const handleRun = async () => {
    const graph = exportGraph();
    try {
      const requirements = await getRuntimeRequirements(graph);
      if (requirements.length > 0) {
        setPendingGraph(graph);
        setPendingRequirements(requirements);
        return;
      }
    } catch {
      // If the requirements check itself fails, fall back to running directly.
    }
    await runGraph(graph);
  };

  const handlePromptSubmit = (values: Record<string, string>) => {
    if (!pendingGraph) return;
    const graph: Graph = JSON.parse(JSON.stringify(pendingGraph));
    for (const node of graph.nodes) {
      let changed = false;
      if (values[node.id] !== undefined) {
        node.config.value = values[node.id];
        changed = true;
      }

      if (node.node_type === 'gui') {
        let widgetsChanged = false;
        for (const widget of node.config.gui_widgets) {
          const key = `${node.id}::${widget.id}`;
          if (values[key] !== undefined) {
            widget.value = values[key];
            widgetsChanged = true;
          }
        }
        // Widget values don't change port shape, but re-sync for consistency
        // with how every other widget mutation is applied (see applyWidgets).
        if (widgetsChanged) Object.assign(node, syncGuiNodePorts(node));
        changed = changed || widgetsChanged;
      }

      // Persist the answers back into the graph itself, not just into the
      // copy we're about to run -- otherwise the picked file/text is forgotten
      // the moment the run ends and has to be retyped every time.
      if (changed) updateNode(node.id, { config: node.config });
    }
    setPendingRequirements(null);
    setPendingGraph(null);
    runGraph(graph);
  };

  const handlePromptCancel = () => {
    setPendingRequirements(null);
    setPendingGraph(null);
  };

  // Both deploy actions used to have no busy state and no error handling, so a
  // slow or rejecting backend looked exactly like a dead button.
  const runDeployAction = async (label: string, action: () => Promise<void>) => {
    setShowDeploy(false);
    setDeployBusy(label);
    setDeployError('');
    try {
      await action();
    } catch (error) {
      setDeployError(errorText(error, `${label} failed.`));
    } finally {
      setDeployBusy('');
    }
  };

  const handleDownloadBundle = () =>
    runDeployAction('Bundle download', async () => {
      await downloadBundle(exportGraph());
    });

  const handleDockerCompose = () =>
    runDeployAction('Compose preview', async () => {
      const content = await getDockerCompose(exportGraph());
      setDeployLabel('docker-compose.yml');
      setDeployContent(content);
      // Deliberately no setShowDeploy(true): the preview renders off
      // deployContent, and re-opening the dropdown here left it hanging behind
      // the modal after the caller had just closed it.
    });

  const handleOpenAiGraph = () => {
    setAiDescription('');
    setAiError('');
    setAiResult(null);
    setShowAiGraph(true);
  };

  const handleCloseAiGraph = () => {
    setShowAiGraph(false);
    setAiResult(null);
    setAiError('');
  };

  const handleGenerateGraph = async () => {
    if (!aiDescription.trim()) {
      setAiError('Please describe the graph you want first.');
      return;
    }
    setAiGenerating(true);
    setAiError('');
    setAiResult(null);
    try {
      const result = await generateGraph({ description: aiDescription, ...genAI() });
      setAiResult(result);
    } catch (e: any) {
      setAiError(errorText(e, 'Failed to generate graph.'));
    } finally {
      setAiGenerating(false);
    }
  };

  const handleConfirmAiGraph = () => {
    if (!aiResult) return;
    // The user came here to explore an idea; loading the result must not
    // silently destroy the graph they already had open.
    if (!confirmDiscard('Replace the current graph with the generated one?')) return;
    loadGraph(aiResult.graph);
    setShowAiGraph(false);
    setAiResult(null);
    setAiError('');
  };

  // A dropdown with no dismiss handler stays open over the canvas until you
  // find the button again.
  useEffect(() => {
    if (!showDeploy) return;
    const close = () => setShowDeploy(false);
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && close();
    // Deferred so the click that opened the menu doesn't immediately close it.
    const timer = window.setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showDeploy]);

  const statusColor = executionResult
    ? executionResult.status === 'success' ? SUCCESS : DANGER
    : DIMMER;
  const statusLabel = executionResult ? `${executionResult.status} (${Math.round(executionResult.duration_ms ?? 0)}ms)` : '';

  return (
    <>
      <header
        className="flex items-center gap-4 px-4 h-14 flex-shrink-0"
        style={{ background: SUNKEN, borderBottom: `1px solid ${LINE}` }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <span className="text-xl">🕸️</span>
          <span className="text-base font-bold" style={{ color: ACCENT }}>
            AI-Graph
          </span>
        </div>

        {/* Graph name */}
        <input
          className="bg-transparent border-none outline-none text-sm font-medium max-w-xs"
          style={{ color: TEXT, borderBottom: `1px dashed ${LINE}`, paddingBottom: 2 }}
          value={metadata.name}
          onChange={(e) => setMetadata({ name: e.target.value })}
        />
        <span className="text-xs truncate max-w-xs" style={{ color: DIMMER }} title={currentFilePath ?? 'Not saved to a file yet'}>
          {currentFilePath ?? 'Untitled — not saved'}
        </span>

        <div className="flex-1" />

        {/* Actions, grouped: file · history · authoring · run · project */}
        <ToolbarButton icon={FilePlus2} label="New" title="New graph" onClick={onNewGraph} />
        <ToolbarButton icon={FolderOpen} label="Open" title="Open a graph file" onClick={onLoad} />
        <ToolbarButton icon={Save} label="Save" title="Save (Ctrl+S)" onClick={onSave} />
        <ToolbarButton icon={SaveAll} title="Save as…" onClick={onSaveAs} />

        <ToolbarSeparator />

        <ToolbarButton icon={Undo2} title="Undo (Ctrl+Z)" onClick={undo} disabled={!undoAvailable} />
        <ToolbarButton icon={Redo2} title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!redoAvailable} />

        <ToolbarSeparator />

        <ToolbarButton icon={ClipboardCopy} title="Copy or paste the graph as JSON" onClick={onInjectJson} />
        <ToolbarButton icon={Sparkles} label="AI Graph" title="Describe a graph and let the AI build it" onClick={handleOpenAiGraph} />

        <ToolbarSeparator />

        {/* A "✅ Saved to …" that survives the next ten edits is a lie about
            what is on disk; it only shows while the graph is actually clean.
            (rfNodes/rfEdges are read above purely to drive this re-render.) */}
        {saveStatus && !isDirty() && (
          <span className="text-xs" style={{ color: MUTED }}>
            {saveStatus}
          </span>
        )}
        {isDirty() && (rfNodes.length > 0 || rfEdges.length > 0) && (
          <span className="text-xs" style={{ color: DIM }} title="Unsaved changes">
            ● unsaved
          </span>
        )}

        {/* Run, and while running, what it is doing and how to stop it */}
        {isExecuting && runProgress && (
          <span
            className="text-xs tabular-nums"
            style={{ color: MUTED }}
            title="Nodes finished, of the total in this graph"
          >
            {runProgress.completed}/{runProgress.total}
            {runProgress.label ? ` · ${runProgress.label}` : ''}
          </span>
        )}
        {isExecuting ? (
          <button
            onClick={stopRun}
            title="Stop this run"
            className="h-8 px-3.5 rounded-md text-xs font-semibold flex items-center gap-1.5"
            style={{ background: DANGER, color: 'white' }}
          >
            <Square size={14} strokeWidth={2.5} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            onClick={handleRun}
            title="Run this graph"
            className="h-8 px-3.5 rounded-md text-xs font-semibold flex items-center gap-1.5"
            style={{ background: ACCENT, color: 'white' }}
          >
            <Play size={14} strokeWidth={2.5} aria-hidden="true" />
            Run
          </button>
        )}

        <ToolbarSeparator />

        <ToolbarButton icon={Settings} title="Code generation AI and this graph's runtime AI default" onClick={onOpenSettings} />

        {/* Deploy dropdown */}
        <div className="relative">
          <ToolbarButton
            icon={Rocket}
            label={deployBusy ? `${deployBusy}…` : 'Deploy'}
            title="Package this graph as a standalone tool"
            onClick={() => setShowDeploy(!showDeploy)}
            disabled={!!deployBusy}
          />
        </div>

        {deployError && (
          <span className="text-xs font-medium" style={{ color: DANGER_TEXT }}>❌ {deployError}</span>
        )}

        {/* Status */}
        {statusLabel && (
          <span className="text-xs font-medium" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        )}
      </header>

      {/* Deploy menu */}
      {showDeploy && (
        <div
          className="fixed z-50"
          style={{ top: 56, right: 16, background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 8, minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        >
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors"
            style={{ color: TEXT }}
            onClick={handleDownloadBundle}
          >
            📦 Download Bundle (zip)
          </button>
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors"
            style={{ color: TEXT }}
            onClick={handleDockerCompose}
          >
            🐳 View Docker Compose
          </button>
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors border-t"
            style={{ color: MUTED, borderColor: LINE }}
            onClick={() => setShowDeploy(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Deploy preview modal */}
      {deployContent && (
        <Modal title={deployLabel} onClose={() => setDeployContent('')} maxWidth="max-w-2xl">
          <pre className="p-5 overflow-auto text-xs font-mono" style={{ color: MUTED, maxHeight: '60vh' }}>
            {deployContent}
          </pre>
        </Modal>
      )}

      <GraphWindows
        requirements={pendingRequirements}
        onSubmit={handlePromptSubmit}
        onCancel={handlePromptCancel}
      />

      {/* AI Graph modal */}
      {showAiGraph && (
        <Modal
          title="✨ Generate Graph with AI"
          onClose={handleCloseAiGraph}
          maxWidth="max-w-2xl"
          dismissOnBackdrop={!aiGenerating}
          dismissOnEscape={!aiGenerating}
          footer={
            <>
              <button
                onClick={handleCloseAiGraph}
                className="px-4 py-2 text-sm rounded-lg"
                style={NEUTRAL_BUTTON}
              >
                Cancel
              </button>
              {aiResult ? (
                <button
                  onClick={handleConfirmAiGraph}
                  className="px-4 py-2 text-sm rounded-lg font-semibold"
                  style={{ background: SUCCESS, color: 'white' }}
                >
                  Load Graph
                </button>
              ) : (
                <button
                  onClick={handleGenerateGraph}
                  disabled={aiGenerating}
                  className="px-4 py-2 text-sm rounded-lg font-semibold"
                  style={{ ...PRIMARY_BUTTON, opacity: aiGenerating ? 0.7 : 1 }}
                >
                  {aiGenerating ? '⏳ Generating…' : 'Generate'}
                </button>
              )}
            </>
          }
        >
          <div className="p-5 flex flex-col gap-3">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              Describe the graph you want
            </label>
            <textarea
              autoFocus
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              className="w-full rounded-lg p-3 text-sm resize-y outline-none"
              style={{ minHeight: 100, background: SUNKEN, border: `1px solid ${LINE}`, color: TEXT }}
              placeholder="e.g. Read a text file, summarize it with AI, and show the result in a text window."
              disabled={aiGenerating}
            />

            {aiError && (
              <div className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}>
                ❌ {aiError}
              </div>
            )}

            {aiResult && (
              <div className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: ACCENT_TEXT }}>
                {aiResult.explanation || 'Graph generated.'} ({aiResult.graph.nodes.length} node{aiResult.graph.nodes.length === 1 ? '' : 's'},{' '}
                {aiResult.graph.edges.length} edge{aiResult.graph.edges.length === 1 ? '' : 's'})
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}