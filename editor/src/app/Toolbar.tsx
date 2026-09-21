import { useEffect, useState } from 'react';
import {
  ClipboardCopy, FilePlus2, FolderOpen, Play, Redo2, RefreshCw, Rocket, Save, SaveAll, Settings, Sparkles, Square, Undo2, Wand2,
} from 'lucide-react';
import ToolbarButton, { ToolbarSeparator } from '@/ui/ToolbarButton';
import { showsPage, widgetFiresRun } from '@/document/guiWidgets';
import { useGraphStore } from '@/store/graphStore';
import { call, downloadBundle, type AICall, type Requirement } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { Graph } from '@/graph';
import { applyRuntimeValues } from '@engine/execution/runtimeValues.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { genAI } from '@/store/settingsStore';
import RequirementsDialog from '@/dialogs/RequirementsDialog';
import { useGraphSweep } from '@/authoring/useGraphSweep';
import Modal from '@/ui/Modal';
import LiveGeneration from '@/authoring/LiveGeneration';
import { ACCENT, ACCENT_FILL, ACCENT_TEXT, DANGER, DANGER_TEXT, DIM, DIMMER, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUCCESS, SUNKEN, SURFACE, TEXT } from '@/ui/theme';

/**
 * How long a node may go without producing anything before the toolbar says so.
 *
 * A local model thinking for twenty seconds is normal and needs no commentary;
 * one silent for a minute is the case where the only question a user has is
 * "is this still alive or do I reload the page?". Comfortably under
 * AI_STREAM_IDLE_TIMEOUT (120s), so the notice appears well before the request
 * would be given up on.
 */
const STALLED_AFTER_SECONDS = 45;

interface ToolbarProps {
  onNewGraph: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** Re-read the node files of the open graph. */
  onReloadProject: () => void;
  onLoad: () => void;
  onInjectJson: () => void;
  onOpenSettings: () => void;
  /** Ask before replacing the current graph; false means the user said no. */
  confirmDiscard: (action: string) => boolean;
  currentFilePath: string | null;
  saveStatus: string;
  /**
   * Show the graph's page.
   *
   * Pressing Run when a block on the page has nothing in it used to open a
   * dialog asking for the same value the block asks for, one tab away — two
   * places to fill in one field, and the one you were not looking at.
   */
  onShowInterface: () => void;
  /**
   * Whether that page is what is on screen right now.
   *
   * ▶ Run means "start this", and for a graph with a page starting it is
   * opening the page. Once it is open there is nothing left to open, so the
   * same button is the one in the page's own header.
   */
  interfaceShown: boolean;
}

export default function Toolbar({
  onNewGraph, onSave, onSaveAs, onReloadProject, onLoad, onInjectJson, onOpenSettings, confirmDiscard,
  currentFilePath, saveStatus, onShowInterface, interfaceShown,
}: ToolbarProps) {
  const metadata = useGraphStore((s) => s.metadata);
  const subgraphStack = useGraphStore((s) => s.subgraphStack);
  const closeSubgraph = useGraphStore((s) => s.closeSubgraph);
  // The graph at the top, then one step per node gone into. `depth` is how
  // many levels remain when you are standing on that step.
  const trail = subgraphStack.length === 0 ? [] : [
    { depth: 0, name: subgraphStack[0].graph.metadata.name || 'Graph' },
    ...subgraphStack.map((frame, level) => ({
      depth: level + 1,
      name: frame.graph.nodes.find((node) => node.id === frame.nodeId)?.label || frame.nodeId,
    })),
  ];
  const sweep = useGraphSweep();
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
  const isProject = useGraphStore((s) => s.isProject);
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
  const [pendingRequirements, setPendingRequirements] = useState<Requirement[] | null>(null);
  const [pendingGraph, setPendingGraph] = useState<Graph | null>(null);

  const [openingTool, setOpeningTool] = useState('');

  const [showAiGraph, setShowAiGraph] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<{ graph: Graph; explanation?: string } | null>(null);
  // What the one long call has sent so far, so designing a graph is not five
  // minutes of a spinning button with nothing behind it.
  const [aiCalls, setAiCalls] = useState<AICall[]>([]);

  /** Whether this tool has a page at all: a window to open, or only ▶ Run. */
  const pageBlocks = rfNodes
    .map((n) => n.data.graphNode)
    .filter((node) => showsPage(node.node_type))
    .flatMap((node) => node.config.gui_widgets);
  const hasPage = pageBlocks.length > 0;
  /** Whether that page has anything to *use* — a button, a chat, a field told to fire. */
  const hasEvent = pageBlocks.some(widgetFiresRun);

  const handleRun = async () => {
    // A graph with a page is an application, and starting an application is
    // opening its window -- not pressing the button its user would have
    // pressed, on whatever values happen to be on the page.
    //
    // So Run shows the page. If there is something on it to use, that is the
    // whole of it: the tool now sits there waiting, which is what it does. If
    // there is nothing to use, ▶ Run *is* the tool's only interaction -- the
    // delivered tool says so in as many words -- and the run goes ahead.
    //
    // Once the page is up, this button is the one in its header: the same run,
    // asked for from the other side of the tab strip.
    if (hasPage && !interfaceShown) {
      onShowInterface();
      if (hasEvent) return;
    }

    const graph = exportGraph();
    try {
      const requirements = await call('requirements', graph);

      // A requirement that belongs to a block is one the *page* asks for, and
      // the page is a better place to answer it than a dialog: it has the
      // label, the Browse button and the rest of the form around it. So show
      // the page instead of asking, and let the next Run go through. Already
      // looking at the page, that would be a button that does nothing, and the
      // dialog below asks instead.
      const onThePage = requirements.filter((r) => r.widget_id);
      if (onThePage.length > 0 && !interfaceShown) {
        onShowInterface();
        return;
      }

      // What is left belongs to nodes with nothing on the page — an input set
      // to ask, an output set to ask where to write. Those have nowhere else
      // to be answered.
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

  /**
   * The tool as it is delivered, in a window of its own.
   *
   * ▶ Run runs every node, now, from the top, whether or not the page asked
   * for it -- which is what you want while building and is not what the thing
   * you are building does. What a tool *is* -- a page that sits there until
   * someone uses it, and then runs what that use is wired to -- was until now
   * only reachable by bundling it and opening the zip somewhere else.
   *
   * So the graph is handed to the server and `runtime.html` is opened against
   * it: the same page, the same entry point and the same routes a bundle
   * serves, in a window with no editor in it. Nothing is written to disk, and
   * the window keeps the graph it was given until it is opened again — which
   * is what a delivered tool does.
   */
  const openAsTool = async () => {
    setOpeningTool('Opening…');
    try {
      await call('holdGraph', useGraphStore.getState().rootGraph());
      // Named, so pressing it again reloads the tool's own window instead of
      // leaving a trail of them.
      const opened = window.open('runtime.html', 'ai-graph-tool');
      setOpeningTool(opened ? '' : 'The browser blocked the window. Allow pop-ups for this page.');
    } catch (error) {
      setOpeningTool(errorText(error, 'The tool could not be opened.'));
    }
  };

  const handlePromptSubmit = (values: Record<string, string>) => {
    if (!pendingGraph) return;
    const graph: Graph = JSON.parse(JSON.stringify(pendingGraph));
    // Where an answer goes is each element's own business (`applyRuntimeValue`:
    // an input keeps it as its value, a page in the widget that asked) -- the
    // engine's code, run here, rather than a second copy of it.
    applyRuntimeValues(graph, values, engineRegistry);
    // Persist the answers back into the graph itself, not just into the copy
    // about to run -- otherwise the picked file or text is forgotten the moment
    // the run ends and has to be retyped every time.
    const answered = new Set(Object.keys(values).map((key) => key.split('::')[0]));
    for (const node of graph.nodes) {
      if (answered.has(node.id)) updateNode(node.id, { config: node.config });
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
      // The tool someone is handed is the whole thing, not the level that is open.
      await downloadBundle(useGraphStore.getState().rootGraph());
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
    setAiCalls([]);
    const progressId = `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const watching = window.setInterval(async () => {
      try {
        const { calls } = await call('generationProgress', { id: progressId });
        if (calls.length) setAiCalls(calls);
      } catch { /* a poll that fails changes nothing */ }
    }, 500);
    try {
      const result = await call('generateGraph', { description: aiDescription, progress_id: progressId, ...genAI() });
      setAiResult(result);
    } catch (e: any) {
      setAiError(errorText(e, 'Failed to generate graph.'));
    } finally {
      window.clearInterval(watching);
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
  const statusLabel = executionResult ? executionResult.status : '';

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

        {/* Where you are, and the way back out. Each crumb leaves as many
            levels as it takes to get there; the last one is where you stand. */}
        {trail.length > 1 && (
          <div className="flex items-center gap-1 text-xs">
            {trail.map((step, index) => (
              <span key={step.depth} className="flex items-center gap-1">
                {index > 0 && <span style={{ color: DIMMER }}>▸</span>}
                <button
                  type="button"
                  className="px-2 py-0.5 rounded"
                  style={{ color: index === trail.length - 1 ? TEXT : MUTED }}
                  disabled={index === trail.length - 1}
                  title={index === trail.length - 1 ? 'You are here' : `Back out to ${step.name}`}
                  onClick={() => { while (useGraphStore.getState().subgraphStack.length > step.depth) closeSubgraph(); }}
                >
                  {step.name}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* Actions, grouped: file · history · authoring · run · project */}
        <ToolbarButton icon={FilePlus2} label="New" title="New graph" onClick={onNewGraph} />
        <ToolbarButton icon={FolderOpen} label="Open" title="Open a graph file" onClick={onLoad} />
        <ToolbarButton icon={Save} label="Save" title="Save (Ctrl+S)" onClick={onSave} />
        <ToolbarButton icon={SaveAll} title="Save as…" onClick={onSaveAs} />
        {/* Code and prompts that change on disk come in by themselves; this
            is for graph.json itself -- after a git pull, say. */}
        {isProject && (
          <ToolbarButton
            icon={RefreshCw}
            title="Reload the whole project from disk (graph.json changed outside the editor)"
            onClick={onReloadProject}
          />
        )}

        <ToolbarSeparator />

        <ToolbarButton icon={Undo2} title="Undo (Ctrl+Z)" onClick={undo} disabled={!undoAvailable} />
        <ToolbarButton icon={Redo2} title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!redoAvailable} />

        <ToolbarSeparator />

        <ToolbarButton icon={ClipboardCopy} title="Copy or paste the graph as JSON" onClick={onInjectJson} />
        <ToolbarButton icon={Sparkles} label="AI Graph" title="Describe a graph and let the AI build it" onClick={handleOpenAiGraph} />
        {/* Front to back through the graph: each node is generated against what
            the node before it turned out to return, so only the first one is
            written against a description rather than against data. */}
        <ToolbarButton
          icon={Wand2}
          label={sweep.busy ? 'Stop' : 'Generate'}
          title={sweep.busy
            ? 'Stop after the node in flight'
            : 'Write every empty node, in the order the graph runs'}
          onClick={sweep.busy ? sweep.stop : sweep.run}
        />
        {sweep.message && (
          <span className="text-xs truncate max-w-md" style={{ color: MUTED }} title={sweep.message}>
            {sweep.message}
          </span>
        )}

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
            title={
              'Nodes finished, of the total in this graph'
              + (runProgress.itemTotal > 1 ? '; then items finished within the running node' : '')
            }
          >
            {runProgress.completed}/{runProgress.total}
            {runProgress.label ? ` · ${runProgress.label}` : ''}
            {/* Only worth showing for a real batch: "1/1" on every single-item
                node is noise that makes the useful case harder to spot. */}
            {runProgress.itemTotal > 1 ? ` · ${runProgress.itemDone}/${runProgress.itemTotal}` : ''}
          </span>
        )}
        {/* Said only once it is worth saying. Below the threshold a run is
            visibly working, and a ticking "1s… 2s…" would be pure anxiety;
            above it, silence is the thing the user cannot otherwise tell from
            a hang. */}
        {isExecuting && runProgress && runProgress.idleSeconds !== null
          && runProgress.idleSeconds > STALLED_AFTER_SECONDS && (
          <span
            className="text-xs tabular-nums"
            style={{ color: DIM }}
            title="No output from the model since this long. The run is still waiting, not stopped."
          >
            ⏳ {Math.round(runProgress.idleSeconds)}s
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
            title={!hasPage ? 'Run this graph'
              : interfaceShown ? 'Run this tool on what is on the page now'
                : hasEvent ? 'Start this tool: show its page, and let it wait for what its user does'
                  : 'Start this tool: show its page and run it — there is nothing on it to press'}
            className="h-8 px-3.5 rounded-md text-xs font-semibold flex items-center gap-1.5"
            style={{ background: ACCENT, color: 'white' }}
          >
            <Play size={14} strokeWidth={2.5} aria-hidden="true" />
            Run
          </button>
        )}

        {openingTool && openingTool !== 'Opening…' && (
          <span className="text-xs" style={{ color: DANGER_TEXT }}>{openingTool}</span>
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
          style={{ top: 56, right: 16, background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 8, minWidth: 200, boxShadow: '0 8px 32px var(--ui-scrim, rgba(0,0,0,0.5))' }}
        >
          {/* Both ways of handing this over, in the order you would use them:
              look at it detached, then pack it. ▶ Run opens the same page in
              the Preview tab, attached to what you are building; this opens it
              in a window with no editor anywhere near it, which is the last
              look before the zip. */}
          {hasPage && (
            <button
              className="w-full text-left px-4 py-3 text-sm hover-raise transition-colors"
              style={{ color: TEXT }}
              title="A window of its own, served exactly as a bundle serves it. Nothing is written to disk."
              onClick={() => { setShowDeploy(false); void openAsTool(); }}
              disabled={openingTool === 'Opening…'}
            >
              ⧉ Open as a tool (new window)
            </button>
          )}
          <button
            className={`w-full text-left px-4 py-3 text-sm hover-raise transition-colors${hasPage ? ' border-t' : ''}`}
            style={{ color: TEXT, borderColor: LINE }}
            onClick={handleDownloadBundle}
          >
            📦 Download Bundle (zip)
          </button>
          <button
            className="w-full text-left px-4 py-3 text-sm hover-raise transition-colors border-t"
            style={{ color: MUTED, borderColor: LINE }}
            onClick={() => setShowDeploy(false)}
          >
            Cancel
          </button>
        </div>
      )}

      <RequirementsDialog
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

            {aiGenerating && (
              <div className="mt-3">
                <LiveGeneration calls={aiCalls} minHeight={140} />
              </div>
            )}
            {aiError && (
              <div className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}>
                ❌ {aiError}
              </div>
            )}

            {aiResult && (
              <div className="text-xs px-3 py-2 rounded" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>
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