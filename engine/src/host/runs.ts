// Runs in flight, so a page can watch one and stop it.
//
// A run is started, reports as it goes, and is looked at by polling; Stop
// aborts it. That is a small state machine with one owner, so it is one class:
// the server hands it a graph and a trigger and asks it for snapshots, and
// nothing outside knows what a run record holds.

import type { ExecutionResult, Graph } from '../graph.ts';
import { executeGraph } from '../execution/executor.ts';
import { LastOutputs } from '../execution/reuse.ts';
import { registry } from '../elements/registry.ts';
import type { Trigger } from '../execution/triggers.ts';
import type { RunSnapshot } from './api.ts';
import { nodeRuntime } from './node.ts';

/** How long a finished run can still be looked at. A long session must not accumulate them. */
const KEEP_MS = 300_000;

class Run {
  readonly id: string;
  readonly total: number;
  completed = 0;
  running: string[] = [];
  currentLabel = '';
  itemDone = 0;
  itemTotal = 0;
  lastActivity: number | null = null;
  result: ExecutionResult | null = null;
  error: string | null = null;
  cancelled = false;
  finishedAt: number | null = null;
  /** What Stop pulls: the executor ends the call in flight and starts nothing more. */
  readonly stop = new AbortController();

  constructor(id: string, total: number) {
    this.id = id;
    this.total = total;
  }

  snapshot(): RunSnapshot {
    return {
      run_id: this.id,
      done: this.finishedAt !== null,
      cancelled: this.cancelled,
      completed: this.completed,
      total: this.total,
      running: this.running,
      current_label: this.currentLabel,
      item_done: this.itemDone,
      item_total: this.itemTotal,
      idle_seconds: this.lastActivity === null ? null : (Date.now() - this.lastActivity) / 1000,
      error: this.error,
      result: this.result,
    };
  }
}

export class RunBoard {
  private readonly runs = new Map<string, Run>();
  /** Shared by every run on this board: what one page event computed, the next may reuse. */
  private readonly reuse = new LastOutputs();

  /**
   * Start *graph* in the background and hand back the run's id.
   *
   * `total` is how many nodes the run will touch -- all of them, or the slice
   * a trigger starts -- so the progress line reads "2 of 2", not "2 of 9 and done".
   */
  start(graph: Graph, trigger: Trigger | null, total: number): string {
    const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const run = new Run(id, total);
    this.runs.set(id, run);

    const runtime = nodeRuntime({
      report(event) {
        run.lastActivity = Date.now();
        if (event.type === 'node_start') {
          run.currentLabel = graph.nodes.find((n) => n.id === event.node_id)?.label ?? event.node_id;
          run.running = [...run.running, event.node_id];
          run.itemDone = 0;
          run.itemTotal = 0;
        }
        if (event.type === 'node_done') {
          run.completed += 1;
          run.running = run.running.filter((id) => id !== event.node_id);
        }
        if (event.type === 'batch') {
          run.itemDone = event.done;
          run.itemTotal = event.total;
        }
      },
    });

    executeGraph(graph, { runtime, registry, trigger, signal: run.stop.signal, reuse: this.reuse })
      .then((result) => { run.result = result; })
      .catch((error: unknown) => { run.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { run.finishedAt = Date.now(); this.forgetOld(); });

    return id;
  }

  snapshot(id: string): RunSnapshot | null {
    return this.runs.get(id)?.snapshot() ?? null;
  }

  /** Stop a run: the run is told, not just the page that was watching it. */
  stop(id: string): boolean {
    const run = this.runs.get(id);
    if (!run) return false;
    run.cancelled = true;
    run.stop.abort();
    return true;
  }

  private forgetOld(): void {
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, run] of this.runs) {
      if (run.finishedAt !== null && run.finishedAt < cutoff) this.runs.delete(id);
    }
  }
}
