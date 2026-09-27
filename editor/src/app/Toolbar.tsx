import { useRef, useState } from 'react';
import {
  ClipboardCopy, FilePlus2, FolderOpen, Play, Redo2, RefreshCw, Rocket, Save, SaveAll, Settings, Sparkles, Square, Undo2, Wand2,
} from 'lucide-react';
import ToolbarButton, { ToolbarSeparator } from '@/ui/ToolbarButton';
import { useGraphStore } from '@/store/graphStore';
import { ApiError, call, downloadBundle, watchGeneration, type AICall } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { Graph } from '@/graph';
import { useDeliveredRun } from '@/page/useDeliveredRun';
import RequirementsDialog from '@/dialogs/RequirementsDialog';
import { useGraphSweep } from '@/authoring/useGraphSweep';
import Modal from '@/ui/Modal';
import LiveGeneration from '@/authoring/LiveGeneration';
import SubgraphTrail from './SubgraphTrail';
import GraphProblems from './GraphProblems';
import { ACCENT, ACCENT_FILL, ACCENT_TEXT, DANGER, DANGER_TEXT, DIM, DIMMER, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUCCESS, SUNKEN, TEXT } from '@/ui/theme';

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

/**
 * Why New, Open and Reload wait, or null when they need not: a run or a ✨
 * sweep is going, and what it brings back belongs to the graph it started on.
 */
export function graphBusy(running: boolean, sweeping: boolean): string | null {
  if (running) return 'A run is going: stop it, or wait for it, before opening another graph.';
  if (sweeping) return '✨ Generate is writing this graph: stop it, or wait for it, before opening another.';
  return null;
}

/**
 * Numbered requests of which only the last is still wanted: `ask` hands out
 * what tells a request whether it still is, and `cancel` makes none of them.
 *
 * ✨ AI Graph's Cancel closed the dialog and left the request running; opened
 * again, the dialog showed the old design as the answer to a new, empty
 * description, ready to load.
 */
export function lastAsked(): { ask: () => () => boolean; cancel: () => void } {
  let last = 0;
  return {
    ask: () => {
      last += 1;
      const mine = last;
      return () => mine === last;
    },
    cancel: () => { last += 1; },
  };
}

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
}

export default function Toolbar({
  onNewGraph, onSave, onSaveAs, onReloadProject, onLoad, onInjectJson, onOpenSettings, confirmDiscard,
  currentFilePath, saveStatus,
}: ToolbarProps) {
  const metadata = useGraphStore((s) => s.metadata);
  const sweep = useGraphSweep();
  // Subscribed to so the toolbar re-renders when the graph changes and the
  // "✅ Saved" line below can stop claiming something that is no longer true.
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const isDirty = useGraphStore((s) => s.isDirty);
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const isExecuting = useGraphStore((s) => s.isExecuting);
  const stopRun = useGraphStore((s) => s.stopRun);
  const runProgress = useGraphStore((s) => s.runProgress);
  const isProject = useGraphStore((s) => s.isProject);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  // Subscribe to the stack lengths, not to a function that reads them: selecting
  // a function never changes identity, so the buttons would never re-enable.
  const undoAvailable = useGraphStore((s) => s.past.length > 0);
  const redoAvailable = useGraphStore((s) => s.future.length > 0);
  const executionResult = useGraphStore((s) => s.executionResult);
  const loadGraph = useGraphStore((s) => s.loadGraph);

  const [deployBusy, setDeployBusy] = useState('');
  const [deployError, setDeployError] = useState('');
  // Asking what the graph needs, then running: the delivered page's own steps.
  const delivered = useDeliveredRun();

  const [showAiGraph, setShowAiGraph] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<{ graph: Graph; explanation?: string } | null>(null);
  // What the one long call has sent so far, so designing a graph is not five
  // minutes of a spinning button with nothing behind it.
  const [aiCalls, setAiCalls] = useState<AICall[]>([]);
  const aiAsked = useRef(lastAsked());

  /** Why another graph cannot be opened now, or null when it can. */
  const busyWith = graphBusy(isExecuting, sweep.busy);

  /**
   * ▶ Run: the whole graph, now, on what is set -- the same on every tab.
   *
   * It used to mean three things. With a page it was ▶ Start, which only
   * switched to the Preview tab, whose header then had a ▶ Run of its own; a
   * graph without a page ran here. One button, one meaning: what a page's own
   * blocks start is theirs, and they still start it.
   *
   * What the graph still asks -- a file nobody chose, a place to write -- is
   * asked first, by the delivered tool's own steps (`useDeliveredRun`).
   */
  const handleRun = () => { void delivered.run(null); };

  // Deploying used to have no busy state and no error handling, so a slow or
  // rejecting backend looked exactly like a dead button.
  const runDeployAction = async (label: string, action: () => Promise<void>) => {
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
    // What is still on its way is no longer wanted: nothing it brings is shown.
    aiAsked.current.cancel();
    setAiGenerating(false);
    setShowAiGraph(false);
    setAiResult(null);
    setAiError('');
  };

  const handleGenerateGraph = async () => {
    setAiCalls([]);
    if (!aiDescription.trim()) {
      setAiError('Please describe the graph you want first.');
      return;
    }
    const wanted = aiAsked.current.ask();
    setAiGenerating(true);
    setAiError('');
    setAiResult(null);
    try {
      const result = await watchGeneration(
        (progressId) => call('generateGraph', { description: aiDescription, progress_id: progressId }),
        (calls) => { if (wanted()) setAiCalls(calls); },
      );
      if (wanted()) setAiResult(result);
    } catch (e) {
      if (!wanted()) return;
      setAiError(errorText(e, 'Failed to generate graph.'));
      // The whole failing exchange, replies included, as a node's ✨ keeps it:
      // the failing case is the one where what was asked matters.
      if (e instanceof ApiError && e.body.calls) setAiCalls(e.body.calls);
    } finally {
      if (wanted()) setAiGenerating(false);
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

  const statusColor = executionResult
    ? executionResult.status === 'success' ? SUCCESS : DANGER
    : DIMMER;
  const statusLabel = executionResult ? executionResult.status : '';

  // The bar fits the window: below 1536 pixels its buttons are their icons
  // (`ToolbarButton`), and what it says -- the file, a status, a sweep's
  // progress -- is cut to the room there is, whole in its tooltip. What still
  // does not fit scrolls inside the bar. It used to overflow into the page,
  // which then slid sideways and took the palette and the tabs out of view.
  return (
    <>
      <header
        className="flex items-center gap-2 2xl:gap-3 px-3 2xl:px-4 h-14 flex-shrink-0 min-w-0 overflow-x-auto overflow-y-hidden"
        style={{ background: SUNKEN, borderBottom: `1px solid ${LINE}`, scrollbarWidth: 'thin' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mr-1 2xl:mr-2 flex-shrink-0">
          <span className="text-xl">🕸️</span>
          <span className="hidden 2xl:inline text-base font-bold whitespace-nowrap" style={{ color: ACCENT }}>
            AI-Graph
          </span>
        </div>

        {/* Graph name */}
        <input
          className="bg-transparent border-none outline-none text-sm font-medium w-40 min-w-[6rem] flex-shrink"
          style={{ color: TEXT, borderBottom: `1px dashed ${LINE}`, paddingBottom: 2 }}
          value={metadata.name}
          onChange={(e) => setMetadata({ name: e.target.value })}
        />
        <span className="text-xs truncate min-w-[4rem] max-w-xs" style={{ color: DIMMER }} title={currentFilePath ?? 'Not saved to a file yet'}>
          {currentFilePath ?? 'Untitled — not saved'}
        </span>

        <SubgraphTrail />

        <div className="flex-1" />

        {/* Actions, grouped: file · history · authoring · run · project */}
        {/* Not while a run or a sweep is going: what they bring back is for
            the graph they started on, and is dropped once another is open. */}
        <ToolbarButton icon={FilePlus2} label="New" title={busyWith ?? 'New graph'} onClick={onNewGraph} disabled={!!busyWith} />
        <ToolbarButton icon={FolderOpen} label="Open" title={busyWith ?? 'Open a graph file'} onClick={onLoad} disabled={!!busyWith} />
        <ToolbarButton icon={Save} label="Save" title="Save (Ctrl+S)" onClick={onSave} />
        <ToolbarButton icon={SaveAll} title="Save as…" onClick={onSaveAs} />
        {/* Code and prompts that change on disk come in by themselves; this
            is for the flow and the nodes' settings -- after a git pull, say. */}
        {isProject && (
          <ToolbarButton
            icon={RefreshCw}
            title={busyWith ?? 'Reload the whole project from disk (flow.json or a node\'s settings changed outside the editor)'}
            onClick={onReloadProject}
            disabled={!!busyWith}
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
          icon={sweep.busy ? Square : Wand2}
          label={sweep.busy ? 'Stop' : 'Generate'}
          title={sweep.busy
            ? 'Stop after the node in flight'
            : 'Write every empty node, in the order the graph runs'}
          onClick={sweep.busy ? sweep.stop : sweep.run}
        />
        {sweep.message && (
          <span className="text-xs truncate max-w-xs" style={{ color: MUTED }} title={sweep.message}>
            {sweep.message}
          </span>
        )}

        <ToolbarSeparator />

        {/* A "✅ Saved to …" that survives the next ten edits is a lie about
            what is on disk; it only shows while the graph is actually clean.
            (rfNodes/rfEdges are read above purely to drive this re-render.) */}
        {saveStatus && !isDirty() && (
          <span className="text-xs truncate max-w-[14rem]" style={{ color: MUTED }} title={saveStatus}>
            {saveStatus}
          </span>
        )}
        {isDirty() && (rfNodes.length > 0 || rfEdges.length > 0) && (
          <span className="text-xs whitespace-nowrap" style={{ color: DIM }} title="Unsaved changes">
            ● unsaved
          </span>
        )}

        {/* Run, and while running, what it is doing and how to stop it */}
        {isExecuting && runProgress && (
          <span
            className="text-xs tabular-nums truncate max-w-[14rem]"
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
            className="text-xs tabular-nums whitespace-nowrap"
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
            className="h-8 px-3.5 flex-shrink-0 rounded-md text-xs font-semibold flex items-center gap-1.5"
            style={{ background: DANGER, color: 'white' }}
          >
            <Square size={14} strokeWidth={2.5} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            onClick={handleRun}
            title="Run the whole graph on what is set now. Anything it still needs is asked for first."
            className="h-8 px-3.5 flex-shrink-0 rounded-md text-xs font-semibold flex items-center gap-1.5"
            style={{ background: ACCENT, color: 'white' }}
          >
            <Play size={14} strokeWidth={2.5} aria-hidden="true" />
            Run
          </button>
        )}

        <ToolbarSeparator />

        {/* Labelled, and the title names what is inside. An API key lives in
            here, under "Keys and addresses", and a tooltip that spoke only of
            "code generation AI and this graph's runtime AI default" was a sign
            pointing away from the thing people come looking for. */}
        <ToolbarButton
          icon={Settings}
          label="Settings"
          title="The AI that generates, tests and runs, API keys and server addresses, and what starts the graph"
          onClick={onOpenSettings}
        />

        {/* One thing to do, so no menu: the look at the tool detached is the
            Preview tab's pop-out, beside the page it opens. */}
        <ToolbarButton
          icon={Rocket}
          label={deployBusy ? `${deployBusy}…` : 'Deploy'}
          title="Download this graph as a tool of its own: a zip with the engine, the graph and its page"
          onClick={handleDownloadBundle}
          disabled={!!deployBusy}
        />

        {deployError && (
          <span className="text-xs font-medium truncate max-w-[14rem]" style={{ color: DANGER_TEXT }} title={deployError}>❌ {deployError}</span>
        )}

        {/* Status */}
        {statusLabel && (
          <span className="text-xs font-medium whitespace-nowrap" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        )}
      </header>

      <RequirementsDialog
        requirements={delivered.requirements}
        onSubmit={delivered.submit}
        onCancel={delivered.cancel}
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
              placeholder="e.g. Read a text file, summarize it with AI, and show the result on a page."
              disabled={aiGenerating}
            />

            {(aiGenerating || (aiError && aiCalls.length > 0)) && (
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
            {aiResult && <GraphProblems graph={aiResult.graph} />}
          </div>
        </Modal>
      )}
    </>
  );
}