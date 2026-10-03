// The application ▶ Run starts, as an IDE runs the program it builds.
//
// One button, and it runs the tool the way whoever gets it will: with a page,
// the page opens -- its fields filled in as they are set -- and the graph runs
// when the page is used, a button pressed, a file picked. Without one, what
// starts the graph starts it: a trigger node set to fire at start fires, a
// clock keeps its time, and a graph with no trigger at all runs whole, once,
// as a program runs when it is started (`startEvents`). ■ Stop ends it.
//
// It runs until it is stopped where something is left to happen -- a page to
// use, a clock to tick -- and ends by itself where nothing is: a graph that
// only computes, like a program that has returned.
//
// The clock is the server's, as a served tool's is (`host/session.ts`): the
// document is handed to the server's session, which keeps the time of its
// trigger nodes from ▶ Run to ■ Stop, so a round comes due in the editor when
// it would in a bundle, and asks nobody anything. It is the document that
// runs: while the application runs, what is edited is handed over a moment
// after, and the next round runs that. And it ends with the editor: closed or
// reloaded while it runs, the page tells the server to stop the clock, which
// would otherwise tick on with nobody there.

import { create } from 'zustand';
import type { Graph } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { pageOf } from '@/document/guiWidgets';
import { call } from '@/api/client';
import { stopRound } from '@/api/session';
import { startEvents } from '@engine/execution/triggers.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

export const useApplication = create<{
  /** The application is running: its page waits to be used, its clocks tick. */
  running: boolean;
}>(() => ({ running: false }));

/** Whether the graph at the top has a page with blocks: what ▶ Run opens, from whatever level is on screen. */
export function useTopHasPage(): boolean {
  return useGraphStore((s) => pageOf(s.subgraphStack.length
    ? s.subgraphStack[0].graph.nodes
    : s.rfNodes.map((node) => node.data.graphNode)).widgets.length > 0);
}

/** How long after an edit, while the application runs, the document is handed over again. */
const HOLD_AFTER_EDIT_MS = 500;

/** What the running application set up, each undone when it ends. */
let whileRunning: (() => void)[] = [];

/** While the application runs, hand the server each edit of the document, a moment after it was made. */
function followEdits(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = useGraphStore.subscribe((state, before) => {
    if (state.rfNodes === before.rfNodes && state.rfEdges === before.rfEdges && state.metadata === before.metadata) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void useGraphStore.getState().holdDocument().catch(() => {}); }, HOLD_AFTER_EDIT_MS);
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}

/** While the application runs, stop the server's clock when the editor is closed or reloaded. */
function stopWhenLeft(): () => void {
  const left = (): void => { void call('stopApplication', {}, { keepalive: true }).catch(() => {}); };
  addEventListener('pagehide', left);
  return () => removeEventListener('pagehide', left);
}

/**
 * Start the application *graph* -- stopping one that is running first -- and
 * resolve once what starting it runs has started. *runWhole* runs it whole,
 * for a graph nothing else starts: the delivered tool's steps, which ask first
 * what the graph still needs (`useRound`).
 */
export async function startApplication(graph: Graph, runWhole: () => Promise<void>): Promise<void> {
  const stopping = stopApplication();
  // Running from the moment ▶ Run is pressed, before the server has answered:
  // the App tab it opens is shown only while the application runs, and would
  // close again in between.
  useApplication.setState({ running: true });
  // What the graph's cards showed before is not what this run has done.
  useGraphStore.getState().setExecutionResult(null);
  // The one before is stopped in the server first, or its stop could overtake this start.
  await stopping;
  await useGraphStore.getState().holdDocument();
  whileRunning = [followEdits(), stopWhenLeft()];
  const { ticks } = await call('startApplication', {});
  if (startEvents(graph, engineRegistry).includes(null)) await runWhole();
  // Nothing left to happen: no page to use, no clock to tick.
  if (!pageOf(graph.nodes).widgets.length && !ticks) await end();
}

/** No longer running: edits no longer handed over, and the server's clock stopped -- once it has answered. */
function end(): Promise<void> {
  for (const undo of whileRunning) undo();
  whileRunning = [];
  useApplication.setState({ running: false });
  return call('stopApplication', {}).then(() => {}, () => {});
}

/** Stop the application -- its clocks -- and the round in flight, whoever started it. */
export async function stopApplication(): Promise<void> {
  const ending = useApplication.getState().running ? end() : null;
  if (useGraphStore.getState().isExecuting) await stopRound().catch(() => {});
  await ending;
}
