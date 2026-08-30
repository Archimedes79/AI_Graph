import React, { useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import GuiWindowLayer from '../components/gui/GuiWindowLayer';
import GraphWindows from '../components/GraphWindows';
import RuntimeAISettings from './RuntimeAISettings';
import { getRuntimeGraph, getRuntimeRequirements } from '../utils/api';
import { errorText } from '../utils/errorText';
import { syncGuiNodePorts } from '../utils/guiWidgets';
import { NODE_ELEMENTS } from '../elements/registry';
import type { Graph, RuntimeRequirement } from '../types/graph';
import { ACCENT, DANGER_TEXT, DIM, LINE, MUTED, NEUTRAL_BUTTON, SUNKEN, SURFACE, TEXT } from '../ui/theme';

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
  const updateNode = useGraphStore((s) => s.updateNode);
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const metadata = useGraphStore((s) => s.metadata);
  const isExecuting = useGraphStore((s) => s.isExecuting);
  const executionResult = useGraphStore((s) => s.executionResult);
  const runGraph = useGraphStore((s) => s.runGraph);

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
      .catch((error) => setLoadError(errorText(error, 'Could not load the graph.')));
  }, [loadGraph]);

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
    await runGraph(graph);
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
        if (!widget) continue;
        widget.value = value;
        Object.assign(node, syncGuiNodePorts(node));
      } else {
        node.config.value = value;
      }
      // Write the answer back into the store, not just into the copy about to
      // run -- same rule the editor's toolbar follows. Without it an operator
      // running the same tool daily retypes the same paths on every single run.
      updateNode(node.id, { config: node.config });
    }
    setPendingRequirements(null);
    await runGraph(graph);
  };

  const status = executionResult?.status;
  const statusLabel = isExecuting ? '⏳ Running…' : status === 'success' ? '✅ Done' : status === 'error' ? '❌ Failed' : '';
  // A backend error can be several lines long; it belongs in the body, not
  // squeezed into a header span next to the buttons.
  const runError = status === 'error' ? executionResult?.error : '';
  const hasWidgets = rfNodes.some(
    (n) => NODE_ELEMENTS[n.data.graphNode.node_type]?.hasRuntimeWindow ?? false,
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: SUNKEN }}>
      <header
        className="flex items-center gap-3 px-4 py-2 shrink-0"
        style={{ background: SURFACE, borderBottom: `1px solid ${LINE}` }}
      >
        <span className="text-sm font-semibold" style={{ color: TEXT }}>
          {metadata.name || 'AI-Graph'}
        </span>
        {metadata.description && (
          <span className="text-xs" style={{ color: DIM }}>{metadata.description}</span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={NEUTRAL_BUTTON}
          title="Point this tool at a different AI"
        >
          ⚙ AI Settings
        </button>
        <button
          onClick={handleRun}
          disabled={!ready || isExecuting}
          className="px-4 py-1.5 text-xs rounded-lg font-semibold"
          style={{
            background: !ready || isExecuting ? '#374151' : ACCENT,
            color: 'white',
            opacity: !ready || isExecuting ? 0.7 : 1,
          }}
        >
          {isExecuting ? '⏳ Running…' : '▶ Run'}
        </button>
        {statusLabel && (
          <span className="text-xs font-medium whitespace-nowrap" style={{ color: status === 'error' ? DANGER_TEXT : MUTED }}>
            {statusLabel}
          </span>
        )}
      </header>

      <div className="flex-1 relative overflow-auto">
        {loadError && (
          <div className="m-6 text-sm rounded-lg px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}>
            {loadError}
          </div>
        )}
        {!loadError && !ready && (
          <div className="m-6 text-sm" style={{ color: DIM }}>Loading…</div>
        )}

        {runError && (
          <div
            className="m-6 text-sm rounded-lg px-4 py-3 whitespace-pre-wrap"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: DANGER_TEXT }}
          >
            {runError}
          </div>
        )}

        {/* A graph with no GUI node has nothing to draw, so without this the
            page is an empty dark rectangle and the user has no idea what the
            tool does or that ▶ Run is the whole interaction. */}
        {ready && !hasWidgets && !runError && (
          <div className="m-6 max-w-2xl">
            <p className="text-sm mb-2" style={{ color: TEXT }}>
              {metadata.description || `${metadata.name} is ready to run.`}
            </p>
            <p className="text-xs" style={{ color: DIM }}>
              Press <strong>▶ Run</strong> above. Anything the tool still needs — a file to read,
              a place to write — is asked for first. Results appear here when it finishes.
            </p>
          </div>
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
