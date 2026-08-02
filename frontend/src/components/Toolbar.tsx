import React, { useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { executeGraph, downloadBundle, getDockerCompose, getRuntimeRequirements, generateGraph } from '../utils/api';
import type { Graph, RuntimeRequirement } from '../types/graph';
import { syncGuiNodePorts } from '../utils/guiWidgets';
import { effectiveWriteMode } from '../elements/output/outputElement';
import GraphWindows from './GraphWindows';

interface ToolbarProps {
  onNewGraph: () => void;
  onSave: () => void;
  onLoad: () => void;
  onInjectJson: () => void;
}

export default function Toolbar({ onNewGraph, onSave, onLoad, onInjectJson }: ToolbarProps) {
  const metadata = useGraphStore((s) => s.metadata);
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const isExecuting = useGraphStore((s) => s.isExecuting);
  const setIsExecuting = useGraphStore((s) => s.setIsExecuting);
  const setExecutionResult = useGraphStore((s) => s.setExecutionResult);
  const setTextOutputWindows = useGraphStore((s) => s.setTextOutputWindows);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const executionResult = useGraphStore((s) => s.executionResult);
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const updateNode = useGraphStore((s) => s.updateNode);

  const [showDeploy, setShowDeploy] = useState(false);
  const [deployContent, setDeployContent] = useState('');
  const [deployLabel, setDeployLabel] = useState('');
  const [pendingRequirements, setPendingRequirements] = useState<RuntimeRequirement[] | null>(null);
  const [pendingGraph, setPendingGraph] = useState<Graph | null>(null);

  const [showAiGraph, setShowAiGraph] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<{ graph: Graph; explanation?: string } | null>(null);

  const runGraph = async (graph: Graph) => {
    setIsExecuting(true);
    setExecutionResult(null);
    setTextOutputWindows([]);
    try {
      const result = await executeGraph(graph);
      setExecutionResult(result);

      const windows = graph.nodes
        .filter((n) => effectiveWriteMode(n) === 'window')
        .map((n) => {
          const nr = result.node_results.find((r) => r.node_id === n.id);
          if (!nr || nr.status !== 'success') return null;
          const content = Object.values(nr.outputs)
            .flatMap((v) => (Array.isArray(v) ? v : [v]))
            .filter((v) => v !== null && v !== undefined)
            .map(String)
            .join('\n');
          return { nodeId: n.id, label: n.config.output_label || n.label, content };
        })
        .filter((w): w is { nodeId: string; label: string; content: string } => w !== null);
      setTextOutputWindows(windows);
    } catch (e: any) {
      setExecutionResult({
        status: 'error',
        node_results: [],
        final_outputs: {},
        error: e?.response?.data?.detail ?? e?.message ?? 'Execution failed',
      });
    } finally {
      setIsExecuting(false);
    }
  };

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

  const handleDownloadBundle = async () => {
    const graph = exportGraph();
    await downloadBundle(graph);
  };

  const handleDockerCompose = async () => {
    const graph = exportGraph();
    const content = await getDockerCompose(graph);
    setDeployLabel('docker-compose.yml');
    setDeployContent(content);
    setShowDeploy(true);
  };

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
      const result = await generateGraph({ description: aiDescription });
      setAiResult(result);
    } catch (e: any) {
      setAiError(e?.response?.data?.detail ?? e?.message ?? 'Failed to generate graph.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleConfirmAiGraph = () => {
    if (!aiResult) return;
    loadGraph(aiResult.graph);
    setShowAiGraph(false);
    setAiResult(null);
    setAiError('');
  };

  const statusColor = executionResult
    ? executionResult.status === 'success' ? '#22c55e' : '#ef4444'
    : '#475569';
  const statusLabel = executionResult ? `${executionResult.status} (${Math.round(executionResult.duration_ms ?? 0)}ms)` : '';

  return (
    <>
      <header
        className="flex items-center gap-4 px-4 h-14 flex-shrink-0"
        style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <span className="text-xl">🕸️</span>
          <span className="text-base font-bold" style={{ color: '#6366f1' }}>
            AI-Graph
          </span>
        </div>

        {/* Graph name */}
        <input
          className="bg-transparent border-none outline-none text-sm font-medium max-w-xs"
          style={{ color: '#e2e8f0', borderBottom: '1px dashed #2d3148', paddingBottom: 2 }}
          value={metadata.name}
          onChange={(e) => setMetadata({ name: e.target.value })}
        />

        <div className="flex-1" />

        {/* Actions */}
        <button
          onClick={onNewGraph}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          New
        </button>
        <button
          onClick={onLoad}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          Load
        </button>
        <button
          onClick={onInjectJson}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          Paste JSON
        </button>
        <button
          onClick={handleOpenAiGraph}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          ✨ AI Graph
        </button>
        <button
          onClick={onSave}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          Save JSON
        </button>

        {/* Deploy dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowDeploy(!showDeploy)}
            className="px-3 py-1.5 text-xs rounded-lg flex items-center gap-1"
            style={{ background: '#2d3148', color: '#e2e8f0' }}
          >
            🚀 Deploy ▾
          </button>
        </div>

        {/* Run */}
        <button
          onClick={handleRun}
          disabled={isExecuting}
          className="px-4 py-1.5 text-xs rounded-lg font-semibold flex items-center gap-2"
          style={{ background: isExecuting ? '#374151' : '#6366f1', color: 'white', opacity: isExecuting ? 0.7 : 1 }}
        >
          {isExecuting ? '⏳ Running…' : '▶ Run Graph'}
        </button>

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
          style={{ top: 56, right: 16, background: '#1a1d2e', border: '1px solid #2d3148', borderRadius: 8, minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        >
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors"
            style={{ color: '#e2e8f0' }}
            onClick={() => { setShowDeploy(false); handleDownloadBundle(); }}
          >
            📦 Download Bundle (zip)
          </button>
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors"
            style={{ color: '#e2e8f0' }}
            onClick={() => { setShowDeploy(false); handleDockerCompose(); }}
          >
            🐳 View Docker Compose
          </button>
          <button
            className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors border-t"
            style={{ color: '#94a3b8', borderColor: '#2d3148' }}
            onClick={() => setShowDeploy(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Deploy preview modal */}
      {deployContent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setDeployContent('')}
        >
          <div
            className="rounded-xl overflow-hidden shadow-2xl w-full max-w-2xl mx-4"
            style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3" style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}>
              <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>{deployLabel}</span>
              <button onClick={() => setDeployContent('')} style={{ color: '#94a3b8' }}>✕</button>
            </div>
            <pre className="p-5 overflow-auto text-xs font-mono" style={{ color: '#94a3b8', maxHeight: '60vh' }}>
              {deployContent}
            </pre>
          </div>
        </div>
      )}

      <GraphWindows
        requirements={pendingRequirements}
        onSubmit={handlePromptSubmit}
        onCancel={handlePromptCancel}
      />

      {/* AI Graph modal */}
      {showAiGraph && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={handleCloseAiGraph}
        >
          <div
            className="rounded-xl overflow-hidden shadow-2xl w-full max-w-2xl mx-4"
            style={{ background: '#1a1d2e', border: '1px solid #2d3148' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
            >
              <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>
                ✨ Generate Graph with AI
              </span>
              <button onClick={handleCloseAiGraph} style={{ color: '#94a3b8' }}>✕</button>
            </div>

            <div className="p-5 flex flex-col gap-3">
              <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                Describe the graph you want
              </label>
              <textarea
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                className="w-full rounded-lg p-3 text-sm resize-y outline-none"
                style={{ minHeight: 100, background: '#0f1117', border: '1px solid #2d3148', color: '#e2e8f0' }}
                placeholder="e.g. Read a text file, summarize it with AI, and show the result in a text window."
                disabled={aiGenerating}
              />

              {aiError && (
                <div className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
                  ❌ {aiError}
                </div>
              )}

              {aiResult && (
                <div className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc' }}>
                  {aiResult.explanation || 'Graph generated.'} ({aiResult.graph.nodes.length} node{aiResult.graph.nodes.length === 1 ? '' : 's'},{' '}
                  {aiResult.graph.edges.length} edge{aiResult.graph.edges.length === 1 ? '' : 's'})
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  onClick={handleCloseAiGraph}
                  className="px-4 py-2 text-sm rounded-lg"
                  style={{ background: '#2d3148', color: '#e2e8f0' }}
                >
                  Cancel
                </button>
                {aiResult ? (
                  <button
                    onClick={handleConfirmAiGraph}
                    className="px-4 py-2 text-sm rounded-lg font-semibold"
                    style={{ background: '#22c55e', color: 'white' }}
                  >
                    Load Graph
                  </button>
                ) : (
                  <button
                    onClick={handleGenerateGraph}
                    disabled={aiGenerating}
                    className="px-4 py-2 text-sm rounded-lg font-semibold"
                    style={{ background: '#6366f1', color: 'white', opacity: aiGenerating ? 0.7 : 1 }}
                  >
                    {aiGenerating ? '⏳ Generating…' : 'Generate'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}