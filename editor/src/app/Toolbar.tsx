import { useEffect, useRef, useState } from 'react';
import { Play, Redo2, Rocket, Settings, Square, Undo2, Wand2 } from 'lucide-react';
import ToolbarButton from '@/ui/ToolbarButton';
import { useGraphStore } from '@/store/graphStore';
import { ApiError, call, downloadBundle, watchGeneration, type AICall } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { Graph } from '@/graph';
import { useDeliveredRun } from '@/page/useDeliveredRun';
import RequirementsDialog from '@/dialogs/RequirementsDialog';
import { useGraphSweep } from '@/authoring/useGraphSweep';
import Modal from '@/ui/Modal';
import LiveGeneration from '@/authoring/LiveGeneration';
import { lastAsked } from './lastAsked';
import SubgraphTrail from './SubgraphTrail';
import GraphProblems from './GraphProblems';
import ViewTabs, { type EditorView } from './ViewTabs';
import { startApplication, stopApplication, useApplication } from './application';
import { usePage } from '@/page/GuiPage';
import FileMenu, { fileActions } from './FileMenu';
import { ACCENT_FILL, ACCENT_TEXT, DANGER, DANGER_TEXT, DIM, DIMMER, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUCCESS, SUNKEN, SURFACE, TEXT } from '@/ui/theme';

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
  view: EditorView;
  onViewChange: (view: EditorView) => void;
}

/**
 * The header: the app's name, the graph's, its views -- and on the
 * right what is done to the graph as a whole: ▶ Run first, then Generate,
 * Settings and Deploy. What is done now and then is in the File menu (New,
 * ✨ AI Graph, Open, Save, Save as…, Reload, JSON); Undo and Redo are icons.
 * Changing the graph as said is the bar under the canvas.
 */
export default function Toolbar({
  onNewGraph, onSave, onSaveAs, onReloadProject, onLoad, onInjectJson, onOpenSettings, confirmDiscard,
  currentFilePath, saveStatus, view, onViewChange,
}: ToolbarProps) {
  const metadata = useGraphStore((s) => s.metadata);
  const sweep = useGraphSweep();
  // One answer, which the header is drawn anew by when it turns: the unsaved
  // dot, and the "✅ Saved" line below, which must not claim what is no longer
  // true. It was asked twice a render, and the header drawn on every change of
  // the graph -- each a whole serialised document, every frame of a drag.
  const dirty = useGraphStore((s) => s.isDirty());
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const isExecuting = useGraphStore((s) => s.isExecuting);
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
   * ▶ Run: the application, run as whoever gets it will run it -- one button,
   * the same on every tab (`app/application.ts`). With a page, the page opens
   * (the App tab) and the graph runs when it is used; without one, what starts
   * the graph starts it. While it runs the button is ■ Stop, which ends it.
   *
   * It is the document that runs: from inside a node's graph, the canvas goes
   * back up to the top first, where the page is and where the results land.
   * What a round still needs -- a file nobody chose, a place to write -- is
   * asked first, by the delivered tool's own steps (`useDeliveredRun`).
   */
  const appRunning = useApplication((s) => s.running);
  const hasPage = usePage().widgets.length > 0;
  // Where ■ Stop goes back to: the view ▶ Run was pressed on.
  const ranFrom = useRef<EditorView>('graph');
  const handleRun = () => {
    const store = useGraphStore.getState();
    if (store.subgraphStack.length) store.closeSubgraphsTo(0);
    if (hasPage) {
      if (view !== 'app') ranFrom.current = view;
      onViewChange('app');
    }
    void startApplication(useGraphStore.getState().exportGraph(), (event) => delivered.run(event));
  };
  // Stopped -- by ■ Stop, or by itself, having nothing left to do -- it takes its tab with it.
  useEffect(() => {
    if (!appRunning && view === 'app') onViewChange(ranFrom.current);
  }, [appRunning, view, onViewChange]);
  // Another graph opened, or started anew: the application was the last one's.
  const documentOpen = useGraphStore((s) => s.document);
  useEffect(() => stopApplication, [documentOpen]);

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

  // The bar fits the window: below 1280 pixels its buttons are their icons
  // (`ToolbarButton`), and what it says -- a status, a sweep's progress -- is
  // cut to the room there is, whole in its tooltip. What still does not fit
  // scrolls inside the bar. It used to overflow into the page, which then slid
  // sideways and took the palette and the tabs out of view.
  return (
    <>
      <header
        className="flex items-center gap-2 xl:gap-3 px-3 xl:px-5 h-14 flex-shrink-0 min-w-0 overflow-x-auto overflow-y-hidden"
        style={{ background: SURFACE, borderBottom: `1px solid ${LINE}`, scrollbarWidth: 'thin' }}
      >
        <span className="shrink-0 whitespace-nowrap text-base font-bold" style={{ color: ACCENT_TEXT }}>AI-Graph</span>

        {/* The graph's name; where it is saved is its tooltip and the File menu's first line. */}
        <input
          className="bg-transparent border-none outline-none text-sm w-44 min-w-[5rem] flex-shrink"
          // Dashed underneath: it is a name to type over, not a label.
          style={{ color: MUTED, borderBottom: `1px dashed ${LINE}`, paddingBottom: 2 }}
          value={metadata.name}
          onChange={(e) => setMetadata({ name: e.target.value })}
          aria-label="The graph's name"
          title={currentFilePath ?? 'Not saved to a file yet'}
        />
        {dirty && (
          <span className="shrink-0 text-xs" style={{ color: DIM }} title="Unsaved changes" role="img" aria-label="Unsaved changes">●</span>
        )}

        <SubgraphTrail />

        <ViewTabs view={view} onChange={onViewChange} running={appRunning && hasPage} />

        {/* What is going on, cut to the room between the tabs and the actions. */}
        <div className="flex flex-1 min-w-0 items-center justify-end gap-2 overflow-hidden">
          {isExecuting && runProgress && (
            <span
              className="text-xs tabular-nums truncate"
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
          {/* A "✅ Saved to …" that survives the next ten edits is a lie about
              what is on disk; it only shows while the graph is actually clean. */}
          {saveStatus && !dirty && (
            <span className="text-xs truncate" style={{ color: MUTED }} title={saveStatus}>
              {saveStatus}
            </span>
          )}
          {deployError && (
            <span className="text-xs font-medium truncate" style={{ color: DANGER_TEXT }} title={deployError}>❌ {deployError}</span>
          )}
          {statusLabel && (
            <span className="text-xs font-medium whitespace-nowrap" style={{ color: statusColor }}>
              {statusLabel}
            </span>
          )}
        </div>

        <FileMenu
          where={currentFilePath ?? 'Not saved to a file yet'}
          actions={fileActions({
            busyWith, isProject,
            onNew: onNewGraph, onDesign: handleOpenAiGraph, onOpen: onLoad, onSave, onSaveAs, onReload: onReloadProject, onJson: onInjectJson,
          })}
        />
        <div className="flex shrink-0 items-center">
          <ToolbarButton icon={Undo2} title="Undo (Ctrl+Z)" onClick={undo} disabled={!undoAvailable} />
          <ToolbarButton icon={Redo2} title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!redoAvailable} />
        </div>

        {appRunning || isExecuting ? (
          <button
            onClick={stopApplication}
            title="Stop the application: its clocks, and the round in flight"
            className="h-9 px-4 flex-shrink-0 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={{ background: DANGER, color: 'white' }}
          >
            <Square size={13} strokeWidth={2.5} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            onClick={handleRun}
            title={hasPage
              ? 'Run the application: its page opens, and the graph runs when you use it'
              : 'Run the application: what starts the graph starts it -- its triggers, or, with none, the whole graph once'}
            className="h-9 px-4 flex-shrink-0 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={PRIMARY_BUTTON}
          >
            <Play size={13} strokeWidth={2.5} aria-hidden="true" />
            Run
          </button>
        )}

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
          framed
        />

        {/* Labelled, and the title names what is inside. An API key lives in
            here, under "Keys and addresses", and a tooltip that spoke only of
            "code generation AI and this graph's runtime AI default" was a sign
            pointing away from the thing people come looking for. */}
        <ToolbarButton
          icon={Settings}
          label="Settings"
          title="The AI that generates, tests and runs, API keys and server addresses, and what starts the graph"
          onClick={onOpenSettings}
          framed
        />

        {/* One thing to do, so no menu: the look at the tool detached is the
            running application's pop-out, beside the page it opens. */}
        <ToolbarButton
          icon={Rocket}
          label={deployBusy ? `${deployBusy}…` : 'Deploy'}
          title="Download this graph as a tool of its own: a zip with the engine, the graph and its page"
          onClick={handleDownloadBundle}
          disabled={!!deployBusy}
          framed
        />
      </header>

      {/* What ✨ Generate says, whole, under the header: in it, at 1024
          pixels, "Nothing to generate. 3 left alone: …" was 77 pixels wide
          and the rest only a tooltip. */}
      {sweep.message && (
        <div className="flex items-start gap-3 px-3 xl:px-5 py-1.5 text-xs flex-shrink-0" role="status"
          style={{ background: SURFACE, borderBottom: `1px solid ${LINE}`, color: MUTED }}>
          <span className="flex-1 min-w-0 break-words">{sweep.message}</span>
          {!sweep.busy && (
            <button type="button" onClick={sweep.dismiss} className="shrink-0" style={{ color: MUTED }}
              title="Dismiss what ✨ Generate said" aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      )}

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
            <p className="text-xs" style={{ color: DIM }}>
              To change the graph that is open instead, say it in the bar under the canvas.
            </p>

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
