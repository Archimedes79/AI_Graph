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
// The clock is the served tool's own (`execution/clock.ts`), so a round comes
// due here when it would there; and a round a trigger starts asks nobody
// anything, as nobody is there to ask when a served tool's clock strikes. It is
// the document that runs, as it is when a round starts, and a round waits while
// another is going or while the canvas shows a node's graph: its result lands
// on the graph at the top.
//
// A delivered tool whose server keeps no time for it -- one opened from the
// editor with ⧉ Open as a tool -- runs the same way in its own window
// (`runtime/RuntimeApp.tsx`).

import { create } from 'zustand';
import type { Graph } from '@/graph';
import type { RunTrigger } from '@/api/client';
import { useGraphStore } from '@/store/graphStore';
import { pageOf } from '@/document/guiWidgets';
import { startEvents } from '@engine/execution/triggers.ts';
import { startClock, type Clock } from '@engine/execution/clock.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

export const useApplication = create<{
  /** The application is running: its page waits to be used, its clocks tick. */
  running: boolean;
}>(() => ({ running: false }));

/**
 * The clock of the application running now. Each start has its own, so a
 * round of one that was stopped cannot come back into the next.
 */
let clock: Clock | null = null;

/** Whether the graph at the top has a page with blocks: what ▶ Run opens, from whatever level is on screen. */
export function useTopHasPage(): boolean {
  return useGraphStore((s) => pageOf(s.subgraphStack.length
    ? s.subgraphStack[0].graph.nodes
    : s.rfNodes.map((node) => node.data.graphNode)).widgets.length > 0);
}

/** Settles once a round may start: none is going, and the canvas shows the graph at the top. */
function ready(): Promise<void> {
  const free = (): boolean => {
    const { isExecuting, subgraphStack } = useGraphStore.getState();
    return !isExecuting && subgraphStack.length === 0;
  };
  if (free()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useGraphStore.subscribe(() => {
      if (!free()) return;
      stop();
      resolve();
    });
  });
}

/**
 * Start the application *graph* -- stopping one that is running first -- and
 * resolve once what starting it runs has run. *runWhole* runs it whole, for a
 * graph nothing else starts: the delivered tool's steps, which ask first what
 * the graph still needs (`useDeliveredRun`).
 */
export async function startApplication(graph: Graph, runWhole: () => Promise<void>): Promise<void> {
  stopApplication();
  // What the page showed before is not what this run has done: a delivered tool opens empty.
  useGraphStore.getState().setExecutionResult(null);
  useApplication.setState({ running: true });
  const own: Clock = startClock(() => useGraphStore.getState().rootGraph(), engineRegistry, async (event: RunTrigger) => {
    await ready();
    if (clock !== own) return;
    const store = useGraphStore.getState();
    await store.runGraph(store.rootGraph(), event);
  });
  clock = own;

  if (startEvents(graph, engineRegistry).includes(null)) await runWhole();
  else await own.started;
  if (clock !== own) return;
  // Nothing left to happen: no page to use, no clock to tick.
  if (!pageOf(graph.nodes).widgets.length && !own.ticks) end();
}

/** The clock stopped and the application no longer running -- its round, if one is going, left to finish. */
function end(): void {
  void clock?.stop();
  clock = null;
  useApplication.setState({ running: false });
}

/** Stop the application -- its clocks -- and the round in flight, whoever started it. */
export function stopApplication(): void {
  if (useApplication.getState().running) end();
  if (useGraphStore.getState().isExecuting) void useGraphStore.getState().stopRun();
}
