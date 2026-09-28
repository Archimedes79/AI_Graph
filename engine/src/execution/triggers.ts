// What starts a graph.
//
// Three things can, and they are the same three everywhere a graph runs:
//
//   the program starting   -- a trigger node set to fire at start
//   a clock                -- a trigger node with an interval
//   something on the page  -- a button pressed, a box submitted, a choice made
//
// All three are events, and an event starts the graph **where it is wired
// to**. That is the part worth a file of its own: a page
// with a "Summarize" button and a "Plot" button is two tools sharing a window,
// and pressing one should not run the other's model call.
//
// So a page event names the port it came from, and what runs is:
//
//   - the nodes that port is wired to, and everything downstream of them --
//     what the event is *for*;
//   - everything upstream of those that they need an input from -- because a
//     node cannot run on values nobody produced;
//   - whatever computes the ◆ of one of them the event does not open itself,
//     and what that needs -- a gate nobody computes never opens;
//   - and nothing else.
//
// A block wired to nothing starts everything, which is what a lone "Go" button
// on a page means.
//
// **The run port is a gate.** Every node has one input nobody declares: `__run`,
// the ◆. What arrives on it is never handed to the node; it decides whether the
// node runs this round. Wired, the node runs only when the round opens it: the
// event the round began with is wired to the node, or a node computed `true`
// onto the ◆ in this round. Several wires are OR-ed. Unwired, the node runs
// whenever the round reaches it, as it always did.
//
// **An event is a boolean that is true for one round.** A button's port says
// "pressed just now". So a code node with named boolean inputs knows which of
// several events this round is, and one that *returns* booleans, wired to other
// nodes' ◆, is a filter and a router -- there is no node type for either.
//
// A node whose gate stays shut keeps what it made last (`latch.ts`), and a run
// no event started -- ▶ Run, the clock, the command line -- counts every event
// as having happened, which is what "run everything" means.

import type { Graph, GraphEdge } from '../graph.ts';
import type { Runners } from '../elements/NodeRunner.ts';

/** The input every node has and nobody declares: the ◆, a gate. What arrives opens it or does not, and is never handed on. */
export const RUN_PORT = '__run';

/** A page event: the port it fired on. No port means the node as a whole. */
export interface Trigger {
  node_id: string;
  port_id?: string | null;
}

/** The one output of a trigger node: true in the round it started. */
export const TRIGGER_PORT = 'fired';

/** One trigger node, as whoever keeps the time needs it. */
export interface GraphTrigger {
  /** The event it is: what a round it starts is told began it. */
  event: Trigger;
  /** Fire once when the tool starts, without waiting to be asked. */
  on_start: boolean;
  /** Fire again this often: `45`, `30s`, `5m`, `2h`, `1d`. Empty means never. */
  every: string;
}

/**
 * The graph's trigger nodes. Read from the document rather than asked of the
 * elements, so that a scheduler needs no registry to know when to run.
 */
export function graphTriggers(graph: Graph): GraphTrigger[] {
  return graph.nodes.filter((node) => node.node_type === 'trigger').map((node) => ({
    event: { node_id: node.id, port_id: TRIGGER_PORT },
    on_start: node.config.trigger_on_start !== false,
    every: String(node.config.trigger_every ?? '').trim(),
  }));
}

/**
 * Whether something on the graph's page starts it when somebody uses it: a
 * block that does -- a button, a chat, a box ticked "Using this starts the
 * graph" -- on a node that is not a trigger node.
 */
export function pageStarts(graph: Graph, elements: Runners): boolean {
  const triggers = new Set(graphTriggers(graph).map((trigger) => trigger.event.node_id));
  return graph.nodes.some((node) => !triggers.has(node.id) && (elements.node(node.node_type)?.eventPorts(node).length ?? 0) > 0);
}

/**
 * What starting the application runs before anybody uses it -- ▶ Run in the
 * editor, a delivered tool opened: each trigger node set to fire at start.
 * A graph with no trigger node starts where its page says, when somebody uses
 * it -- and, with nothing on a page to start it, it runs whole once, as a
 * program runs when it is started (`null` is "everything").
 */
export function startEvents(graph: Graph, elements: Runners): (Trigger | null)[] {
  const triggers = graphTriggers(graph);
  if (triggers.length) return triggers.filter((trigger) => trigger.on_start).map((trigger) => trigger.event);
  return pageStarts(graph, elements) ? [] : [null];
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

/** The longest a Node timer waits: past it, a timer fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/**
 * Call *then* once *ms* have passed, however long that is -- in steps of at
 * most 24.8 days, because a longer timer fires at once, and "every 30d" was a
 * round every millisecond. *keepsAlive* false lets the process end meanwhile.
 * Hands back the way to call it off.
 */
export function after(ms: number, then: () => void, keepsAlive = true): () => void {
  const due = Date.now() + ms;
  let timer: ReturnType<typeof setTimeout>;
  const arm = (): void => {
    const left = Math.max(0, due - Date.now());
    timer = setTimeout(left > LONGEST_TIMER_MS ? arm : then, Math.min(left, LONGEST_TIMER_MS));
    if (!keepsAlive) timer.unref?.();
  };
  arm();
  return () => clearTimeout(timer);
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
  // What decides whether a node the event is for may run is needed as much as
  // what it runs on: a ◆ computed by a node outside the event would otherwise
  // never be computed in its round, and never open. Not for a node the event
  // is wired to itself, which that opens.
  const live = graph.edges.filter((edge) => !feedback.has(edge.id));
  const opened = new Set(live.filter((edge) => edge.source_node_id === trigger.node_id
    && (!trigger.port_id || edge.source_port_id === trigger.port_id)).map((edge) => edge.target_node_id));
  const gates = live
    .filter((edge) => edge.target_port_id === RUN_PORT && downstream.has(edge.target_node_id) && !opened.has(edge.target_node_id))
    .map((edge) => edge.source_node_id);
  const needed = upstreamOf(graph, [...downstream, ...gates], feedback);
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
