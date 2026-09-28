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
// When a round is due is the clock's (`execution/clock.ts`), the one the
// editor's ▶ Run keeps too; what is kept of the rounds is this file's.
//
// The last round is kept on disk as well, when the server says where: a tool
// that restarts overnight should still show this morning's run, not an empty
// page until the next one is due.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { ExecutionResult, Graph } from '../graph.ts';
import type { Trigger } from '../execution/triggers.ts';
import { startClock } from '../execution/clock.ts';
import { registry } from '../elements/registry.ts';

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
  /** No round starts afterwards, the one in flight is told, and the promise settles once it has ended. */
  stop(): Promise<void>;
}

/** What is kept of the last round between two lives of the server. */
type Kept = Pick<ScheduleState, 'runs' | 'result' | 'error' | 'finished_at'>;

/** The last round a previous server wrote down; nothing when there was none, or it is unreadable. */
function recall(path: string | undefined): Partial<Kept> {
  if (!path) return {};
  try {
    const kept = JSON.parse(readFileSync(path, 'utf8')) as Kept;
    return { runs: Number(kept.runs) || 0, result: kept.result ?? null, error: kept.error ?? null, finished_at: kept.finished_at ?? null };
  } catch {
    return {};
  }
}

/** Written beside and then renamed over, so a crash mid-write leaves the round before intact. */
function keep(path: string, state: ScheduleState): void {
  const kept: Kept = { runs: state.runs, result: state.result, error: state.error, finished_at: state.finished_at };
  try {
    writeFileSync(`${path}.tmp`, JSON.stringify(kept));
    renameSync(`${path}.tmp`, path);
  } catch {
    // A read-only bundle still runs on its clock; it only forgets on restart.
  }
}

/** What two rounds of one graph come to: the later one, over what it did not touch. */
function over(before: ExecutionResult | null, fresh: ExecutionResult): ExecutionResult {
  if (!before) return fresh;
  const touched = new Set(fresh.node_results.map((result) => result.node_id));
  return {
    ...fresh,
    node_results: [...before.node_results.filter((result) => !touched.has(result.node_id)), ...fresh.node_results],
    outputs: { ...before.outputs, ...fresh.outputs },
  };
}

/**
 * Start running *graph* as its own trigger nodes say.
 *
 * `run` is handed the graph, a signal and the event that began the round; it
 * is the server's ordinary run, so a scheduled round is a round like any other
 * and runs what that trigger is wired to. Nothing here knows what a node is.
 * *keptAt*, when given, is the file the last round is written to and read back
 * from at start.
 */
export function schedule(
  graph: () => Graph,
  run: (graph: Graph, signal: AbortSignal, event: Trigger) => Promise<ExecutionResult>,
  keptAt?: string,
): Schedule {
  const abort = new AbortController();
  const current: ScheduleState = {
    scheduled: false, running: false, runs: 0, result: null, error: null, finished_at: null, next_at: null,
  };

  const clock = startClock(graph, registry, async (event) => {
    if (abort.signal.aborted) return;
    current.running = true;
    let result: ExecutionResult | null = null;
    let failure: string | null = null;
    try {
      result = await run(graph(), abort.signal, event);
    } catch (error) {
      // A round that could not even start -- a cycle, a graph edited into
      // nonsense -- must not end the schedule: the next round may be fine.
      failure = error instanceof Error ? error.message : String(error);
    }
    current.running = false;
    // Stopped in the middle: not a round. What is remembered stays the last one
    // that ran to its end, not the half of one the shutdown cut off.
    if (abort.signal.aborted) return;
    if (result) current.result = over(current.result, result);
    // An interval nobody could parse stays said: that clock never runs, and a
    // round of another that went well is not the end of that.
    current.error = failure ?? clock.problem();
    current.runs += 1;
    current.finished_at = Date.now();
    if (keptAt) keep(keptAt, current);
  });

  current.scheduled = clock.runsByItself;
  if (current.scheduled) Object.assign(current, recall(keptAt));
  // Said once, at start, rather than discovered at three in the morning: an
  // interval nobody can parse means no clock for it, and the reason is in the state.
  current.error = clock.problem() ?? current.error;

  return {
    state: () => ({ ...current, next_at: clock.nextAt() }),
    stop: () => {
      abort.abort();
      return clock.stop();
    },
  };
}
