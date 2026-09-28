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

import { create } from 'zustand';
import type { Graph } from '@/graph';
import type { RunTrigger } from '@/api/client';
import { useGraphStore } from '@/store/graphStore';
import { pageOf } from '@/document/guiWidgets';
import { after, graphTriggers, parseInterval, startEvents } from '@engine/execution/triggers.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

export const useApplication = create<{
  /** The application is running: its page waits to be used, its clocks tick. */
  running: boolean;
}>(() => ({ running: false }));

/** One round of the application: the delivered tool's steps -- what the graph still needs is asked first (`useDeliveredRun`). */
export type Round = (event: RunTrigger | null) => Promise<void>;

/** What stops each clock that is ticking. */
let clocks: (() => void)[] = [];

/** How long a clock's round waits when another round is still going: one round at a time. */
const BUSY_RETRY_MS = 1000;

const running = (): boolean => useApplication.getState().running;

/** Whether the application has anything left to happen once it has started: a page to use, or a clock. */
export function keepsRunning(graph: Graph): boolean {
  return pageOf(graph.nodes).widgets.length > 0 || graphTriggers(graph).some((trigger) => trigger.every);
}

/**
 * Start the application *graph* -- stopping one that is running first -- and
 * resolve once what starting it runs has run. Each round goes through *round*.
 */
export async function startApplication(graph: Graph, round: Round): Promise<void> {
  stopApplication();
  useApplication.setState({ running: true });

  for (const trigger of graphTriggers(graph).filter((one) => one.every)) {
    let ms: number;
    try {
      ms = parseInterval(trigger.every) * 1000;
    } catch {
      continue; // `check` names an interval nobody can read; the rest of the tool still runs.
    }
    // Counted from the end of one round to the start of the next, as the
    // served tool's clock counts: a round slower than its interval is followed
    // by the next, not overtaken by it.
    const arm = (wait: number): void => { clocks.push(after(wait, () => { void due(); })); };
    const due = async (): Promise<void> => {
      if (!running()) return;
      // A round of the page's, or of another clock, is waited for.
      if (useGraphStore.getState().isExecuting) return arm(BUSY_RETRY_MS);
      await round(trigger.event);
      if (running()) arm(ms);
    };
    arm(ms);
  }

  for (const event of startEvents(graph, engineRegistry)) {
    if (!running()) return;
    await round(event);
  }
  if (!keepsRunning(graph)) useApplication.setState({ running: false });
}

/** Stop the application: its clocks, and the round in flight. */
export function stopApplication(): void {
  for (const stop of clocks) stop();
  clocks = [];
  if (running()) useApplication.setState({ running: false });
  if (useGraphStore.getState().isExecuting) void useGraphStore.getState().stopRun();
}
