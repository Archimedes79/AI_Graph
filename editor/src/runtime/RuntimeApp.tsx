import { useEffect, useRef, useState } from 'react';
import { mergeResults, useGraphStore } from '@/store/graphStore';
import { GuiSurfacePage } from '@/page/GuiPage';
import { useDeliveredRun } from '@/page/useDeliveredRun';
import { useSchemeOnRoot } from '@/page/useSchemeOnRoot';
import RequirementsDialog from '@/dialogs/RequirementsDialog';
import DeliveredHeader from '@/page/DeliveredHeader';
import RuntimeAISettings from './RuntimeAISettings';
import { watchSchedule } from './watchSchedule';
import { call, type ScheduleState } from '@/api/client';
import { errorText } from '@/api/errorText';
import { DANGER_TEXT, DIM, NEUTRAL_BUTTON, SUNKEN } from '@/ui/theme';
import { startApplication } from '@/app/application';

/**
 * The deployed graph's front-end.
 *
 * This is the *same* application as the editor with the canvas taken away: it
 * loads the bundle's one graph into the ordinary graph store and mounts the
 * ordinary `GuiSurface`, so every widget a graph author placed in the
 * designer renders here through the exact component the editor used --
 * `GuiPage`, each widget's `View`. There is no
 * second implementation of a widget anywhere, which is why a deployed tool
 * cannot look or behave differently from what was designed.
 *
 * Served by the bundle's `engine/host/serve.ts` at `runtime.html`.
 */
export default function RuntimeApp() {
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const metadata = useGraphStore((s) => s.metadata);
  // A deployed tool looks like the thing that was designed, scheme included.
  useSchemeOnRoot(metadata.gui_scheme);
  const setExecutionResult = useGraphStore((s) => s.setExecutionResult);

  const [loadError, setLoadError] = useState('');
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    call('graph')
      .then((graph) => {
        loadGraph(graph);
        setReady(true);
      })
      .catch((error) => setLoadError(errorText(error, 'Could not load the graph.')));
  }, [loadGraph]);

  // Anything the graph still needs before it can run (a file to read, a place
  // to write) is asked for in the same window the editor uses -- the deployed
  // equivalent of the CLI's stdin prompts, but clickable. One path for every
  // round started here, and the same one the editor's running application
  // uses: see `useDeliveredRun`.
  const delivered = useDeliveredRun();

  // Opened, the tool is started, as ▶ Run starts it in the editor
  // (`app/application.ts`) -- unless its server keeps its time. A bundle's
  // trigger nodes, when the tool starts and on their clock, run in the server,
  // not here: a page is a window, and a window is not always open (below).
  // One the server keeps no time for starts here: a graph nothing on its page
  // starts runs whole once, and the clock of a tool opened from the editor with
  // ⧉ Open as a tool -- which no server keeps -- ticks in this window while it
  // is open. The first answer about the clock decides, once.
  const started = useRef(false);
  const start = useRef(delivered.run);
  start.current = delivered.run;

  // The graph's own triggers, where the server keeps them: this only watches.
  // What the server last produced is shown as soon as the page opens, and each
  // new round as it lands; what that round remembered is replayed into this
  // page's copy of the graph like any other run's.
  const [schedule, setSchedule] = useState<ScheduleState | null>(null);
  const seenRound = useRef(0);
  useEffect(() => {
    if (!ready) return undefined;
    return watchSchedule(() => call('schedule'), (state) => {
      if (!started.current) {
        started.current = true;
        if (!state.scheduled) void startApplication(useGraphStore.getState().exportGraph(), () => start.current(null));
      }
      setSchedule(state);
      if (state.result && state.runs !== seenRound.current && !useGraphStore.getState().isExecuting) {
        seenRound.current = state.runs;
        // Laid over what the page shows, not in place of it: a clock's round
        // runs what its trigger is wired to, and the summary somebody asked
        // for a minute ago is not part of that.
        const shown = useGraphStore.getState().executionResult;
        setExecutionResult(shown ? mergeResults(shown, state.result) : state.result, state.result);
      }
    });
  }, [ready, setExecutionResult]);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: SUNKEN }}>
      <DeliveredHeader
        tools={(
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 text-xs rounded-lg shrink-0"
            style={NEUTRAL_BUTTON}
            title="Point this tool at a different AI"
          >
            ⚙ AI Settings
          </button>
        )}
        note={schedule?.scheduled && (
          <span className="text-xs whitespace-nowrap" style={{ color: DIM }} title="This tool runs by itself; the clock is in the server, so it keeps running with this page closed.">
            {schedule.running ? '⏱ running…' : schedule.next_at
              ? `⏱ next ${new Date(schedule.next_at).toLocaleTimeString()}`
              : schedule.finished_at ? `⏱ ran ${new Date(schedule.finished_at).toLocaleTimeString()}` : '⏱'}
          </span>
        )}
      />

      <div className="flex-1 relative overflow-auto">
        {loadError && (
          <div className="m-6 text-sm rounded-lg px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}>
            {loadError}
          </div>
        )}
        {!loadError && !ready && (
          <div className="m-6 text-sm" style={{ color: DIM }}>Loading…</div>
        )}

        {/* The page -- or, when it has no blocks, what the tool does and what
            its run hands back: the editor's running application draws the same. */}
        {ready && <GuiSurfacePage onRun={(trigger) => { void delivered.run(trigger); }} />}
        <RequirementsDialog
          requirements={delivered.requirements}
          onSubmit={delivered.submit}
          onCancel={delivered.cancel}
        />
      </div>

      {showSettings && <RuntimeAISettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
