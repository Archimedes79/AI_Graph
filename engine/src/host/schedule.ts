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
//
// The last round is kept on disk as well, when the server says where: a tool
// that restarts overnight should still show this morning's run, not an empty
// page until the next one is due.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/**
 * Start running *graph* as its own triggers say.
 *
 * `run` is handed the graph and a signal; it is the server's ordinary run, so
 * a scheduled round is a round like any other. Nothing here knows what a node
 * is. *keptAt*, when given, is the file the last round is written to and read
 * back from at start.
 */
export function schedule(
  graph: () => Graph,
  run: (graph: Graph, signal: AbortSignal) => Promise<ExecutionResult>,
  keptAt?: string,
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
    running: false, runs: 0, result: null, error: null, finished_at: null, next_at: null,
    ...(triggers.on_start || seconds > 0 ? recall(keptAt) : {}),
  };
  if (problem) current.error = problem;
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
    if (keptAt) keep(keptAt, current);
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
