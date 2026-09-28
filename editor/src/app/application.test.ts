import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph, GraphNode } from '@/graph';
import type { RunTrigger } from '@/api/client';
import { keepsRunning, startApplication, stopApplication, useApplication } from './application';

// What ▶ Run starts: the application, as whoever gets the tool runs it.

const node = (id: string, node_type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id, node_type, label: id, description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
} as unknown as GraphNode);
const graphOf = (...nodes: GraphNode[]): Graph => ({ metadata: { name: 'Tool', description: '', gui_scheme: 'night' }, nodes, edges: [] } as Graph);
const page = (...blocks: Record<string, unknown>[]) => node('page', 'gui', { gui_widgets: blocks });

/** The rounds started, each by the event it was started with -- null for "everything". */
let rounds: (RunTrigger | null)[];
const round = async (event: RunTrigger | null) => { rounds.push(event); };

beforeEach(() => { rounds = []; vi.useFakeTimers(); });
afterEach(() => { stopApplication(); vi.useRealTimers(); });

describe('the application ▶ Run starts', () => {
  it('with a page, opens it and waits: the graph runs when the page is used, not before', async () => {
    await startApplication(graphOf(page({ id: 'msg', kind: 'text_io', mode: 'input', value: 'hello' }, { id: 'go', kind: 'button' }), node('work', 'code')), round);
    expect(rounds).toEqual([]);
    expect(useApplication.getState().running).toBe(true);
  });

  it('without a page, runs whole once, as a program does -- and has then ended', async () => {
    await startApplication(graphOf(node('work', 'code'), node('shown', 'output')), round);
    expect(rounds).toEqual([null]);
    expect(useApplication.getState().running).toBe(false);
  });

  it('fires the trigger nodes set to fire at start, and keeps each clock until it is stopped', async () => {
    const graph = graphOf(node('start', 'trigger', {}), node('clock', 'trigger', { trigger_on_start: false, trigger_every: '30s' }), node('work', 'code'));
    await startApplication(graph, round);
    expect(rounds).toEqual([{ node_id: 'start', port_id: 'fired' }]);
    expect(useApplication.getState().running).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(rounds.slice(1)).toEqual([{ node_id: 'clock', port_id: 'fired' }, { node_id: 'clock', port_id: 'fired' }]);
    stopApplication();
    expect(useApplication.getState().running).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rounds).toHaveLength(3);
  });

  it('keeps running where something is left to happen: a page to use, or a clock', () => {
    expect(keepsRunning(graphOf(page({ id: 'chart', kind: 'plot_window' })))).toBe(true);
    expect(keepsRunning(graphOf(node('clock', 'trigger', { trigger_every: '5m' })))).toBe(true);
    expect(keepsRunning(graphOf(node('start', 'trigger', {}), node('work', 'code')))).toBe(false);
  });
});
