// What starts a graph.
//
// Three things can, and they are the same three everywhere a graph runs:
//
//   the program starting   -- `metadata.triggers.on_start`
//   a clock                -- `metadata.triggers.every`
//   something on the page  -- a button pressed, a box submitted, a choice made
//
// The first two start the whole graph. The third starts the graph **where the
// block is wired to**, and that is the part worth a file of its own: a page
// with a "Summarize" button and a "Plot" button is two tools sharing a window,
// and pressing one should not run the other's model call.
//
// So a page event names the port it came from, and what runs is:
//
//   - the nodes that port is wired to, and everything downstream of them --
//     what the event is *for*;
//   - everything upstream of those that they need an input from -- because a
//     node cannot run on values nobody produced;
//   - and nothing else.
//
// A block wired to nothing starts everything, which is what a lone "Go" button
// on a page means.
//
// **The run port.** Every node has one input nobody declares: `__run`. An edge
// into it carries no value -- it says "start here", and, like any edge, "after
// that". It is how a button is wired to a node it has no data for: a Send
// button beside a message box has nothing to say to the model, only when.

import type { Graph, GraphEdge } from '../graph.ts';

/** The input every node has and nobody declares: "start here", carrying nothing. */
export const RUN_PORT = '__run';

/** A page event: the port it fired on. No port means the node as a whole. */
export interface Trigger {
  node_id: string;
  port_id?: string | null;
}

export interface GraphTriggers {
  /** Run once when the tool starts, without waiting to be asked. */
  on_start: boolean;
  /** Run again this often: `45`, `30s`, `5m`, `2h`, `1d`. Empty means never. */
  every: string;
}

export function graphTriggers(graph: Graph): GraphTriggers {
  const raw = (graph.metadata as { triggers?: Partial<GraphTriggers> }).triggers ?? {};
  return { on_start: raw.on_start === true, every: String(raw.every ?? '').trim() };
}

/**
 * `45`, `30s`, `5m`, `2h`, `1d` — seconds when it is only a number.
 *
 * Bare numbers are seconds because that is what "interval" means everywhere
 * else here; the suffixes exist so nobody has to multiply by 86400 to say "a
 * day" and get it wrong at three in the morning.
 */
export function parseInterval(text: string): number {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(text.trim());
  if (!match) throw new Error(`Not an interval: ${text}. Use 45, 30s, 5m, 2h or 1d.`);
  const scale = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 1;
  const seconds = Number(match[1]) * scale;
  if (seconds <= 0) throw new Error('An interval must be greater than zero.');
  return seconds;
}

/**
 * The nodes one page event runs, or null for "all of them".
 *
 * `feedback` is the executor's own set of memory edges. They are left out
 * both ways: downstream, because the value they carry is settled after the
 * round rather than delivered in it, and upstream for the same reason -- a
 * chat window that shows the model's answer is not something the model waits
 * for.
 */
export function triggeredNodes(graph: Graph, trigger: Trigger, feedback: Set<string>): Set<string> | null {
  const downstream = firedNodes(graph, trigger, feedback);
  if (!downstream) return null;
  const needed = upstreamOf(graph, downstream, feedback);
  needed.add(trigger.node_id);
  return needed;
}

/**
 * What one page event is *for*: the nodes its port is wired to, and everything
 * downstream of them. Null when the port is wired to nothing.
 *
 * The rest of what the event runs is context, which a run may reuse; this part
 * always runs fresh.
 */
export function firedNodes(graph: Graph, trigger: Trigger, feedback: Set<string>): Set<string> | null {
  const live = graph.edges.filter((edge) => !feedback.has(edge.id));
  const fired = live.filter((edge) => edge.source_node_id === trigger.node_id
    && (!trigger.port_id || edge.source_port_id === trigger.port_id));
  if (!fired.length) return null;
  return walk(fired.map((edge) => edge.target_node_id), live, true);
}

/**
 * These nodes, and everything they need an input from.
 *
 * Upstream along edges that carry a value only: a run edge into a needed node
 * says when it may start, not that whoever says so must run as well.
 */
export function upstreamOf(graph: Graph, nodeIds: Iterable<string>, feedback: Set<string>): Set<string> {
  const data = graph.edges.filter((edge) => !feedback.has(edge.id) && edge.target_port_id !== RUN_PORT);
  return walk(nodeIds, data, false);
}

function walk(from: Iterable<string>, edges: GraphEdge[], forward: boolean): Set<string> {
  const seen = new Set(from);
  const queue = [...seen];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of edges) {
      const [near, far] = forward
        ? [edge.source_node_id, edge.target_node_id]
        : [edge.target_node_id, edge.source_node_id];
      if (near !== id || seen.has(far)) continue;
      seen.add(far);
      queue.push(far);
    }
  }
  return seen;
}
