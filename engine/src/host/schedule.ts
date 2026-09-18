// Running a served graph on its own: when the tool starts, and on a clock.
//
// The clock lives in the server, not in the page. A page is a window onto the
// tool, and a window is not always open: a graph that says "every 5 minutes"
// should run every five minutes whether or not anyone is looking, and whoever
// opens the page at half past should see the run from twenty-five past rather
// than an empty screen and a countdown.
//
// So the server holds the graph, runs it, keeps the last result, and the page
// asks for that. One held graph, deliberately: what memory nodes kept from one
// round is what the next round starts from, which only works if the rounds
// share the object. The run settles into it; nothing has to be carried across.
//
// The interval counts from the end of one run to the start of the next -- the
// rule `--every` follows on the command line -- so a run slower than its
// interval is followed by the next one rather than overtaken by it.

import type { ExecutionResult, Graph } from '../graph.ts';
import { graphTriggers, parseInterval } from '../execution/triggers.ts';

export interface ScheduleState {
  /** Whether this graph runs by itself at all. A page that hears `false` has nothing to wait for. */
  scheduled: boolean;
  running: boolean;
  /** How many scheduled runs have finished. */
  runs: number;
  result: ExecutionResult | null;
  /** Why the last run produced no result at all, when it did not. */
  error: string | null;
  finished_at: number | null;
  next_at: number | null;
}

export interface Schedule {
  state(): ScheduleState;
  stop(): void;
}

/**
 * Start running *graph* as its own triggers say.
 *
 * `run` is handed the graph and a signal; it is the server's ordinary run, so
 * a scheduled round is a round like any other. Nothing here knows what a node
 * is.
 */
export function schedule(
  graph: () => Graph,
  run: (graph: Graph, signal: AbortSignal) => Promise<ExecutionResult>,
): Schedule {
  const triggers = graphTriggers(graph());
  // Said once, at start, rather than discovered at three in the morning: an
  // interval nobody can parse means no clock, and the reason is in the state.
  let seconds = 0;
  let problem: string | null = null;
  try {
    seconds = triggers.every ? parseInterval(triggers.every) : 0;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  const current: ScheduleState = {
    scheduled: triggers.on_start || seconds > 0,
    running: false, runs: 0, result: null, error: problem, finished_at: null, next_at: null,
  };
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const round = async (): Promise<void> => {
    if (abort.signal.aborted) return;
    current.running = true;
    current.next_at = null;
    try {
      current.result = await run(graph(), abort.signal);
      current.error = null;
    } catch (error) {
      // A round that could not even start -- a cycle, a graph edited into
      // nonsense -- must not end the schedule: the next round may be fine.
      current.error = error instanceof Error ? error.message : String(error);
    }
    current.running = false;
    current.runs += 1;
    current.finished_at = Date.now();
    if (seconds > 0 && !abort.signal.aborted) {
      current.next_at = Date.now() + seconds * 1000;
      timer = setTimeout(() => { void round(); }, seconds * 1000);
      // The server is what keeps the process alive, not a pending round.
      timer.unref?.();
    }
  };

  if (triggers.on_start) void round();
  else if (seconds > 0) {
    current.next_at = Date.now() + seconds * 1000;
    timer = setTimeout(() => { void round(); }, seconds * 1000);
    timer.unref?.();
  }

  return {
    state: () => ({ ...current }),
    stop: () => { abort.abort(); if (timer) clearTimeout(timer); },
  };
}
