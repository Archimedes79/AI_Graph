import React, { useCallback, useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import GuiWindowLayer from '../components/gui/GuiWindowLayer';
import GraphWindows from '../components/GraphWindows';
import RuntimeAISettings from './RuntimeAISettings';
import { executeGraph, getRuntimeGraph, getRuntimeRequirements } from '../utils/api';
import type { Graph, RuntimeRequirement } from '../types/graph';

/**
 * The deployed graph's front-end.
 *
 * This is the *same* application as the editor with the canvas taken away: it
 * loads the bundle's one graph into the ordinary graph store and mounts the
 * ordinary `GuiWindowLayer`, so every widget a graph author placed in the
 * designer renders here through the exact component the editor used --
 * `GuiWindow`, `PlotWidget`, each element's `RuntimeWidget`. There is no
 * second implementation of a widget anywhere, which is why a deployed tool
 * cannot look or behave differently from what was designed.
 *
 * Served by the bundle's `serve.py` at `runtime.html`.
 */
export default function RuntimeApp() {
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const metadata = useGraphStore((s) => s.metadata);
  const isExecuting = useGraphStore((s) => s.isExecuting);
  const setIsExecuting = useGraphStore((s) => s.setIsExecuting);
  const setExecutionResult = useGraphStore((s) => s.setExecutionResult);
  const setTextOutputWindows = useGraphStore((s) => s.setTextOutputWindows);
  const executionResult = useGraphStore((s) => s.executionResult);

  const [loadError, setLoadError] = useState('');
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingRequirements, setPendingRequirements] = useState<RuntimeRequirement[] | null>(null);

  useEffect(() => {
    getRuntimeGraph()
      .then((graph) => {
        loadGraph(graph);
        setReady(true);
      })
      .catch((e: any) => setLoadError(e?.response?.data?.detail ?? e?.message ?? 'Could not load the graph.'));
  }, [loadGraph]);

  const collectOutputWindows = useCallback((graph: Graph, result: Awaited<ReturnType<typeof executeGraph>>) => {
    return graph.nodes
      .filter((n) => n.node_type === 'output' && n.config.write_mode === 'window')
      .map((n) => {
        const nodeResult = result.node_results.find((r) => r.node_id === n.id);
        if (!nodeResult || nodeResult.status !== 'success') return null;
        const content = Object.values(nodeResult.outputs)
          .flatMap((v) => (Array.isArray(v) ? v : [v]))
          .filter((v) => v !== null && v !== undefined)
          .map(String)
          .join('\n');
        return { nodeId: n.id, label: n.config.output_label || n.label, content };
      })
      .filter((w): w is { nodeId: string; label: string; content: string } => w !== null);
  }, []);

  const execute = useCallback(async (graph: Graph) => {
    setIsExecuting(true);
    setExecutionResult(null);
    setTextOutputWindows([]);
    try {
      const result = await executeGraph(graph);
      setExecutionResult(result);
      setTextOutputWindows(collectOutputWindows(graph, result));
    } catch (e: any) {
      setExecutionResult({
        status: 'error',
        node_results: [],
        final_outputs: {},
        error: e?.response?.data?.detail ?? e?.message ?? 'Execution failed.',
      });
    } finally {
      setIsExecuting(false);
    }
  }, [collectOutputWindows, setExecutionResult, setIsExecuting, setTextOutputWindows]);

  // Anything the graph still needs before it can run (a file to read, a place
  // to write) is asked for in the same window the editor uses -- the deployed
  // equivalent of the CLI's stdin prompts, but clickable.
  const handleRun = async () => {
    const graph = exportGraph();
    try {
      const requirements = await getRuntimeRequirements(graph);
      if (requirements.length > 0) {
        setPendingRequirements(requirements);
        return;
      }
    } catch {
      // Requirements are an optimisation; if the check fails, just run and let
      // the engine report a missing value properly.
    }
    await execute(graph);
  };

  const handleRequirementsSubmit = async (values: Record<string, string>) => {
    const graph = exportGraph();
    for (const requirement of pendingRequirements ?? []) {
      const key = requirement.widget_id ? `${requirement.node_id}::${requirement.widget_id}` : requirement.node_id;
      const value = values[key];
      if (value === undefined) continue;
      const node = graph.nodes.find((n) => n.id === requirement.node_id);
      if (!node) continue;
      if (requirement.widget_id) {
        const widget = node.config.gui_widgets.find((w) => w.id === requirement.widget_id);
        if (widget) widget.value = value;
      } else {
        node.config.value = value;
      }
    }
    setPendingRequirements(null);
    await execute(graph);
  };

  const status = executionResult?.status;
  const statusLabel = isExecuting
    ? '⏳ Running…'
    : status === 'success' ? '✅ Done'
    : status === 'error' ? `❌ ${executionResult?.error ?? 'Failed'}`
    : '';

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#0f1117' }}>
      <header
        className="flex items-center gap-3 px-4 py-2 shrink-0"
        style={{ background: '#1a1d2e', borderBottom: '1px solid #2d3148' }}
      >
        <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>
          {metadata.name || 'AI-Graph'}
        </span>
        {metadata.description && (
          <span className="text-xs" style={{ color: '#64748b' }}>{metadata.description}</span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
          title="Point this tool at a different AI"
        >
          ⚙ AI Settings
        </button>
        <button
          onClick={handleRun}
          disabled={!ready || isExecuting}
          className="px-4 py-1.5 text-xs rounded-lg font-semibold"
          style={{
            background: !ready || isExecuting ? '#374151' : '#6366f1',
            color: 'white',
            opacity: !ready || isExecuting ? 0.7 : 1,
          }}
        >
          {isExecuting ? '⏳ Running…' : '▶ Run'}
        </button>
        {statusLabel && (
          <span className="text-xs font-medium" style={{ color: status === 'error' ? '#fca5a5' : '#94a3b8' }}>
            {statusLabel}
          </span>
        )}
      </header>

      <div className="flex-1 relative overflow-auto">
        {loadError && (
          <div className="m-6 text-sm rounded-lg px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            {loadError}
          </div>
        )}
        {!loadError && !ready && (
          <div className="m-6 text-sm" style={{ color: '#64748b' }}>Loading…</div>
        )}

        <GuiWindowLayer />
        <GraphWindows
          requirements={pendingRequirements}
          onSubmit={handleRequirementsSubmit}
          onCancel={() => setPendingRequirements(null)}
        />
      </div>

      {showSettings && <RuntimeAISettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
