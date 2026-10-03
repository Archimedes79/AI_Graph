// Running a graph: initialise, wire, order, execute.
//
// The whole engine is four ideas.
//
// **Order.** Kahn's algorithm over the edges gives levels; everything in a
// level can run at once because nothing in it feeds anything else in it.
//
// **Memory edges.** A graph with a loop — a chart feeding back into the panel
// that shows it — is not a mistake, it is how an interface works. The minimal
// set of edges into memory-holding nodes is left out of the ordering, so what
// remains is acyclic; those edges are settled *after* the round, for the next
// one. A loop through something that does not remember is still an error.
//
// **Collection.** A node's inputs are whatever its upstream neighbours put on
// the wires. A port fed by several edges collects a list; a port whose single
// source failed gets nothing rather than a null, so a failure upstream does not
// look like a successfully computed nothing.
//
// **Batching.** A node marked per-item runs once per element of its list input,
// bounded, and a failing item costs that item rather than the batch.
//
// Everything else — what a node *does* — belongs to its element.

import type { Graph, GraphEdge, GraphNode, ExecutionResult, NodeResult } from '../graph.ts';
import { resultKeys, type NodeRunner, type Runners } from '../elements/NodeRunner.ts';
import type { Runtime } from '../elements/Runtime.ts';
import { atMost, batchItems, mergeBatchOutputs, reconcileOutputs } from './batching.ts';
import { Unread, filePorts, readPorts } from './fileInputs.ts';
import { RUN_PORT, firedNodes, neededFor, triggeredNodes, type Trigger } from './triggers.ts';
import type { LastOutputs } from './reuse.ts';
import type { Latch } from './latch.ts';
import { mismatches } from './interface.ts';
import { ERROR_PORT, fatalProblems, unrunnable } from './wiring.ts';

/** Ids of the fewest edges that must be ignored to make the graph acyclic. */
export function memoryFeedbackEdges(
  nodes: GraphNode[],
  edges: GraphEdge[],
  registry: Runners,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const feedback = new Set<string>();

  const remembers = (nodeId: string): boolean => {
    const node = byId.get(nodeId);
    return node ? registry.node(node.node_type)?.isMemory === true : false;
  };
  const settles = (nodeId: string): boolean => {
    const node = byId.get(nodeId);
    return node ? registry.node(node.node_type)?.settlesOnArrival === true : false;
  };

  for (;;) {
    const active = edges.filter(
      (e) => !feedback.has(e.id) && byId.has(e.source_node_id) && byId.has(e.target_node_id),
    );
    const inDegree = new Map([...byId.keys()].map((id) => [id, 0]));
    const successors = new Map<string, GraphEdge[]>();
    for (const e of active) {
      inDegree.set(e.target_node_id, (inDegree.get(e.target_node_id) ?? 0) + 1);
      successors.set(e.source_node_id, [...(successors.get(e.source_node_id) ?? []), e]);
    }

    const queue = [...inDegree].filter(([, d]) => d === 0).map(([id]) => id);
    const visited = new Set(queue);
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of successors.get(id) ?? []) {
        const left = (inDegree.get(e.target_node_id) ?? 0) - 1;
        inDegree.set(e.target_node_id, left);
        if (left === 0 && !visited.has(e.target_node_id)) {
          visited.add(e.target_node_id);
          queue.push(e.target_node_id);
        }
      }
    }

    if (visited.size === byId.size) return feedback;

    // Cut one more edge into a node that remembers -- one that closes a loop:
    // a node below a loop is unvisited too, and cutting the wire into it
    // settles its value a round late for nothing. Into one that keeps only
    // what comes back around a loop (a page) before one that keeps whatever
    // arrives (a data node): cut at the data node, the page would be shown
    // what it held from before and keep nothing of it. Then by the graph's node
    // order and by id, never by the order the wires happen to be stored in. If
    // there is none, the cycle is a real one and `topologicalLevels` reports it
    // as such.
    const reaches = (from: string, to: string): boolean => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        const id = queue.shift()!;
        if (id === to) return true;
        for (const e of successors.get(id) ?? []) {
          if (!seen.has(e.target_node_id)) { seen.add(e.target_node_id); queue.push(e.target_node_id); }
        }
      }
      return false;
    };
    const order = new Map(nodes.map((n, index) => [n.id, index]));
    const [candidate] = active
      .filter((e) => !visited.has(e.target_node_id) && remembers(e.target_node_id) && reaches(e.target_node_id, e.source_node_id))
      .sort((a, b) => Number(settles(a.target_node_id)) - Number(settles(b.target_node_id))
        || order.get(a.target_node_id)! - order.get(b.target_node_id)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!candidate) return feedback;
    feedback.add(candidate.id);
  }
}

/** Execution stages: everything in a stage waits only for earlier stages. */
export function topologicalLevels(
  nodes: GraphNode[],
  edges: GraphEdge[],
  feedback: Set<string>,
): string[][] {
  const ids = new Set(nodes.map((n) => n.id));
  const inDegree = new Map([...ids].map((id) => [id, 0]));
  const successors = new Map<string, string[]>();

  for (const e of edges) {
    if (feedback.has(e.id)) continue;
    if (!ids.has(e.source_node_id) || !ids.has(e.target_node_id)) continue;
    inDegree.set(e.target_node_id, (inDegree.get(e.target_node_id) ?? 0) + 1);
    successors.set(e.source_node_id, [...(successors.get(e.source_node_id) ?? []), e.target_node_id]);
  }

  const levels: string[][] = [];
  let current = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  let seen = 0;

  while (current.length) {
    levels.push(current);
    seen += current.length;
    const next = new Set<string>();
    for (const id of current) {
      for (const successor of successors.get(id) ?? []) {
        const left = (inDegree.get(successor) ?? 0) - 1;
        inDegree.set(successor, left);
        if (left === 0) next.add(successor);
      }
    }
    // Keep the graph's own node order inside a level, so a run is reproducible.
    current = nodes.filter((n) => next.has(n.id)).map((n) => n.id);
  }

  if (seen !== ids.size) throw new Error('Graph contains a cycle; execution is not possible.');
  return levels;
}

/**
 * Gather what the wires deliver to *nodeId*.
 *
 * A port fed by more than one edge always collects a list, even when some
 * sources failed — those contribute nothing rather than a null placeholder, so
 * surviving values are not diluted. A port fed by one edge whose source failed
 * yields no entry at all, which is different from a source that succeeded with
 * a null.
 */
export function collectInputs(
  nodeId: string,
  edges: GraphEdge[],
  outputs: Map<string, Record<string, unknown>>,
  feedback: Set<string>,
): Record<string, unknown> {
  const byPort = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    if (e.target_node_id !== nodeId || feedback.has(e.id)) continue;
    // A run edge says when, not what: it orders the node and delivers nothing.
    if (e.target_port_id === RUN_PORT) continue;
    byPort.set(e.target_port_id, [...(byPort.get(e.target_port_id) ?? []), e]);
  }

  const collected: Record<string, unknown> = {};
  for (const [port, incoming] of byPort) {
    const values: unknown[] = [];
    for (const edge of incoming) {
      const source = outputs.get(edge.source_node_id);
      if (source === undefined) continue;
      values.push(source[edge.source_port_id]);
    }
    if (incoming.length > 1) collected[port] = values;
    else if (values.length) collected[port] = values[0];
  }
  return collected;
}

export interface RunOptions {
  /** Wired file paths are read into text for elements that asked. */
  runtime: Runtime;
  registry: Runners;
  /**
   * The page event that started this run. With one, only what that event is
   * wired to runs, plus whatever those nodes need -- see `triggers.ts`.
   */
  trigger?: Trigger | null;
  /**
   * Ends the run early: no further node starts, and the model call or body in
   * flight is ended rather than waited for. What had finished keeps its result.
   */
  signal?: AbortSignal;
  /** Run these nodes and no others. How `inputsFor` asks for one node's upstream. */
  only?: Set<string>;
  /**
   * What nodes produced before, for the ones this run needs only as context:
   * upstream of what a page event is for, or of the node `inputsFor` asks
   * about. See `reuse.ts`. Absent, everything runs.
   */
  reuse?: LastOutputs;
  /**
   * Nodes whose result is already known: they do not run, and what is here is
   * what the rest of the graph receives from them.
   *
   * The same idea as `reuse`, without the cache and without the conditions --
   * a caller who already has the answer says so. It is how a graph inside a
   * node is handed the values that arrived on that node's ports: the run's
   * input nodes are answered rather than asked.
   */
  given?: Record<string, Record<string, unknown>>;
  /**
   * What every node last produced, for the rounds in which its ◆ stays shut.
   * See `latch.ts`. Absent -- a single run from the command line -- a node
   * whose gate is shut has nothing to hand on, and what needs it waits.
   */
  latch?: Latch;
  /** How many graphs this run is already inside. Set by the executor, for itself. */
  depth?: number;
}

/**
 * What running one node by itself honours: its services, a stop, and how deep
 * it already is. No event, no slice of the graph, nothing held or reused: it
 * is one node, asked directly.
 */
export type NodeRunOptions = Pick<RunOptions, 'runtime' | 'registry' | 'signal' | 'depth'>;

/**
 * Run the graph once.
 *
 * A node that throws is recorded as failed and its dependents are skipped
 * rather than the run being abandoned: the report should say what happened
 * everywhere, not only where it stopped first.
 */
export async function executeGraph(graph: Graph, options: RunOptions): Promise<ExecutionResult> {
  const { registry } = options;
  // Before anything runs: an edge that ends nowhere delivers nothing and fails
  // nothing, so a run that went ahead would report a result computed without
  // it. Said here rather than in each caller -- `check` says the same thing
  // about the same graph before it is ever run, and more of it.
  const broken = fatalProblems(graph);
  if (broken.length) throw new Error(unrunnable(broken));
  const { signal } = options;
  const depth = options.depth ?? 0;
  const runtime = stoppable(options.runtime, signal);
  const { nodes, edges } = graph;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const feedback = memoryFeedbackEdges(nodes, edges, registry);
  const levels = topologicalLevels(nodes, edges, feedback);
  const only = options.only ?? (options.trigger ? triggeredNodes(graph, options.trigger, feedback) : null);
  // Context, as opposed to what this run is for: only in a run that is not
  // the whole graph, never the node that fired, never what it fired, and
  // never a node with nothing wired in -- that one reads the outside world.
  const fired = options.trigger && !options.only ? firedNodes(graph, options.trigger, feedback) : null;
  const context = (nodeId: string): boolean => !!options.reuse && !!only
    && nodeId !== options.trigger?.node_id && !fired?.has(nodeId)
    && edges.some((e) => e.target_node_id === nodeId && e.target_port_id !== RUN_PORT && !feedback.has(e.id));
  // Which model answers is part of what a node depends on (`reuse.ts`): asked once for the round.
  const setting = options.reuse ? await runtime.ai.setting?.() : undefined;

  // Which event this round is. A run no event started counts every one as
  // having happened: that is what "run everything" means, and what lets a
  // graph inside a node, or one node's upstream, run without a page.
  const fires = (nodeId: string, portId: string): boolean => {
    const node = byId.get(nodeId);
    if (!node || !registry.node(node.node_type)?.eventPorts(node).includes(portId)) return false;
    const event = options.trigger;
    if (!event) return true;
    return event.node_id === nodeId && (!event.port_id || event.port_id === portId);
  };

  const outputs = new Map<string, Record<string, unknown>>();
  // Nodes whose outputs this round are the ones they were left holding: not
  // run, so not settled into memory again and not a reason for anything to run.
  const held = new Set<string>();
  const results: NodeResult[] = [];
  const failed = new Set<string>();
  const partial = new Set<string>();
  // Nodes that had nothing to do. Not a failure and not a success: the chat
  // page opened and ▶ Run pressed before anyone has said anything.
  const idle = new Set<string>();

  const dependsOn = (nodeId: string, those: Set<string>): boolean =>
    edges.some((e) => e.target_node_id === nodeId && !feedback.has(e.id) && those.has(e.source_node_id));

  /** This node's view of the run: which of *its* ports the round began with. */
  const atNode = (base: Runtime, nodeId: string): Runtime => ({ ...base, fired: (portId) => fires(nodeId, portId) });

  /** Its outputs come from what it holds, not only from what reaches it. */
  const keepsItsOwn = (nodeId: string): boolean => {
    const node = byId.get(nodeId);
    const element = node && registry.node(node.node_type);
    return !!node && !!element && (element.isMemory || element.hasInterface || element.eventPorts(node).length > 0);
  };

  /** Where the latch keeps what this node made: see `latch.ts`. */
  const latchKey = (node: GraphNode): string => options.latch!.key(graph, node, (from) => keepsItsOwn(from.id));

  /**
   * Why this node stands still this round, or '' when it runs.
   *
   * Only what happened *in this round* opens a gate: a boolean a node was left
   * holding from an earlier one is a moment that has passed.
   */
  const standsStill = (nodeId: string): string => {
    const into = edges.filter((e) => e.target_node_id === nodeId && !feedback.has(e.id));
    const gates = into.filter((e) => e.target_port_id === RUN_PORT);
    if (gates.length) {
      // The event itself opens the node it is wired to, whichever port the wire
      // ends on: a dropdown told to start the graph is wired into the chart's
      // `kind`, not into its ◆, and choosing from it must still redraw a chart
      // that a button can start as well.
      const open = into.some((e) => fires(e.source_node_id, e.source_port_id))
        || gates.some((e) => !held.has(e.source_node_id) && outputs.get(e.source_node_id)?.[e.source_port_id] === true);
      return open ? '' : 'Nothing opened its ◆ this round.';
    }
    // A node that keeps something of its own -- a page and what is typed into
    // it, a data node, a trigger -- is news by itself: the press that began the
    // round is on the page, whatever the wires into the page carry.
    if (keepsItsOwn(nodeId)) return '';
    const data = into.filter((e) => outputs.has(e.source_node_id));
    if (data.length && data.every((e) => held.has(e.source_node_id))) return 'Nothing new reached it this round.';
    return '';
  };

  // Answered before anything is asked. Put in before the levels rather than
  // inside them, because a node whose result is already known has nothing the
  // loop does to it: no element to find, no upstream failure to inherit, no
  // "nothing to do" to decide, and nothing to report as started.
  const given = new Set<string>();
  for (const [nodeId, produced] of Object.entries(options.given ?? {})) {
    if (!byId.has(nodeId)) throw new Error(`Given a result for "${nodeId}", which is not a node in this graph.`);
    given.add(nodeId);
    outputs.set(nodeId, produced);
    results.push({
      node_id: nodeId, status: 'success', inputs: {}, outputs: produced, error: null,
      messages: ['Handed in from outside: this node was not run.'],
    });
  }

  for (const level of levels) {
    for (const nodeId of level) {
      // Not part of what this event started: left alone, and left out of the
      // report too -- it did not fail and it was not skipped, it was not asked.
      if (only && !only.has(nodeId)) continue;
      if (given.has(nodeId)) continue;
      if (signal?.aborted) continue;
      const node = byId.get(nodeId)!;
      const element = registry.node(node.node_type);

      if (!element) {
        failed.add(nodeId);
        results.push({
          node_id: nodeId, status: 'error', inputs: {}, outputs: {},
          error: `Unknown node type: ${node.node_type}`,
        });
        continue;
      }

      if (dependsOn(nodeId, failed)) {
        failed.add(nodeId);
        results.push({ node_id: nodeId, status: 'skipped', inputs: {}, outputs: {}, error: null });
        continue;
      }

      const inputs = collectInputs(nodeId, edges, outputs, feedback);

      // The ◆ is a gate. Wired, it must be opened by this round: by the event
      // the round began with, or by a `true` some node computed in it. Shut,
      // the node does not run and what it last produced stands. The same goes
      // for a node fed only by nodes that stood still: nothing new reached it.
      const shut = standsStill(nodeId);
      if (shut) {
        const kept = options.latch?.get(latchKey(node));
        if (kept) {
          held.add(nodeId);
          outputs.set(nodeId, kept);
          results.push({ node_id: nodeId, status: 'skipped', inputs, outputs: kept, held: true, error: null, messages: [`${shut} What it produced last stands.`] });
        } else {
          idle.add(nodeId);
          results.push({ node_id: nodeId, status: 'skipped', inputs, outputs: {}, error: null, messages: [`${shut} It has produced nothing yet, so what needs it waits.`] });
        }
        continue;
      }

      // A wired input the node declared it cannot do without, and nothing on
      // it: the node has nothing to do, and neither has what hangs off it.
      // Sending a model "User:" followed by nothing is not a question. Except a
      // node that keeps something of its own: a page's button, a data node's
      // value, is news whatever an idle neighbour did not send.
      const why = dependsOn(nodeId, idle) && !keepsItsOwn(nodeId)
        ? 'What feeds this node had nothing to do, so neither had this.'
        : nothingToDo(element, node, inputs, edges, feedback);
      if (why) {
        idle.add(nodeId);
        results.push({ node_id: nodeId, status: 'skipped', inputs, outputs: {}, error: null, messages: [why] });
        continue;
      }

      runtime.report?.({ type: 'node_start', node_id: nodeId });

      try {
        // What the run reports having received is what came off the wires --
        // the paths, not the megabytes behind them. Only the element sees the
        // contents.
        const arrived = await readInputs(element, node, inputs, runtime, registry);
        // An event is a moment: `true` handed back from an earlier round would
        // open gates for a press that is over.
        const key = element.eventPorts(node).length ? undefined : options.reuse?.key(node, arrived, setting);
        const kept = key && context(nodeId) ? options.reuse!.get(key) : undefined;
        if (kept) {
          outputs.set(nodeId, kept);
          // What it hands on now is what it made last, for a later round its ◆ stays shut in.
          options.latch?.set(latchKey(node), kept);
          results.push({
            node_id: nodeId, status: 'success', inputs, outputs: kept, error: null,
            messages: ['Reused from an earlier run: nothing it depends on has changed.'],
          });
          runtime.report?.({ type: 'node_done', node_id: nodeId, status: 'success' });
          continue;
        }
        const { produced, failures } = await runNode(
          element, node, arrived, withSubgraph(atNode(runtime, nodeId), options, node, depth), signal,
        );
        if (signal?.aborted) throw new Error('Stopped.');
        outputs.set(nodeId, produced);
        if (!failures.length) options.latch?.set(latchKey(node), produced);
        // Kept only when it went through whole: a partial result is not one to hand back.
        if (key && !failures.length) options.reuse!.set(key, produced);
        const result = ranTo(element, node, inputs, produced, failures);
        if (result.status === 'partial') partial.add(nodeId);
        results.push(result);
        runtime.report?.({ type: 'node_done', node_id: nodeId, status: result.status });
      } catch (error) {
        // Stopped in the middle of this node: not the node's failure, and not
        // something a catch-errors port should turn into data.
        if (signal?.aborted) {
          results.push({ node_id: nodeId, status: 'skipped', inputs, outputs: {}, error: null, messages: ['Stopped.'] });
          runtime.report?.({ type: 'node_done', node_id: nodeId, status: 'skipped' });
          continue;
        }
        const result = failedWith(element, node, inputs, error);
        if (result.status === 'partial') {
          outputs.set(nodeId, result.outputs);
          partial.add(nodeId);
        } else {
          failed.add(nodeId);
        }
        results.push(result);
        runtime.report?.({ type: 'node_done', node_id: nodeId, status: result.status });
      }
    }
  }

  // What stood still is not news: a reply held from the last round must not be
  // added to the conversation a second time, nor handed back as this round's result.
  for (const nodeId of held) outputs.delete(nodeId);
  settleMemory(graph, feedback, outputs, results, registry);
  // What finished before a Stop is drawn as it is: showing asks no model and
  // runs no body, so there is nothing in it for Stop to end.
  await showDisplays(graph, results, registry, runtime, held);

  const status: ExecutionResult['status'] = signal?.aborted
    ? 'cancelled'
    : failed.size === 0 && partial.size === 0
      ? 'success'
      : failed.size === (only?.size ?? nodes.length) ? 'error' : 'partial';

  return {
    status,
    node_results: results,
    outputs: finalOutputs(nodes, outputs, registry),
    error: failed.size ? failureSummary(results, byId) : null,
  };
}

/**
 * The runtime of a run that can be stopped.
 *
 * The signal is put on every model call and handed to every body here, once,
 * so no element has to know that stopping exists -- the same place the graph's
 * AI default is applied, for the same reason.
 */
function stoppable(runtime: Runtime, signal: AbortSignal | undefined): Runtime {
  if (!signal) return runtime;
  const { tools } = runtime;
  return {
    ...runtime,
    ai: { ...runtime.ai, complete: (request) => runtime.ai.complete({ ...request, signal }) },
    code: { run: (body, inputs, _signal, context) => runtime.code.run(body, inputs, signal, context) },
    ...(tools ? { tools: { open: (servers) => tools.open(servers, signal) } } : {}),
  };
}

/**
 * How deep a graph may hold a graph.
 *
 * Not a technical ceiling -- nothing here recurses on the stack -- but the
 * depth past which a person has lost the thread, and the thing that ends a
 * graph that somehow came to hold itself.
 */
export const NESTING_LIMIT = 5;

/**
 * The runtime a node that holds a graph is handed: the same one, plus the way
 * to run that graph.
 *
 * Made per node rather than per run, because the inner run's progress is the
 * *outer* node's progress. A page watching a run counts what it was told to
 * expect ("3 of 7"), and inner nodes it never heard of would count past the
 * end; they are forwarded as activity of the node they happened inside.
 */
function withSubgraph(runtime: Runtime, options: NodeRunOptions, node: GraphNode, depth: number): Runtime {
  const inner: Runtime = {
    ...runtime,
    ...(runtime.report ? {
      report: (event) => {
        if (event.type === 'node_start' || event.type === 'node_done') return;
        runtime.report!({ ...event, node_id: node.id });
      },
    } : {}),
  };
  return {
    ...runtime,
    subgraph: {
      elements: options.registry,
      run: (graph, given) => {
        if (depth + 1 > NESTING_LIMIT) {
          throw new Error(`Graphs may hold graphs ${NESTING_LIMIT} deep; "${node.id}" is one deeper than that.`);
        }
        return executeGraph(graph, {
          ...options,
          runtime: inner,
          given,
          depth: depth + 1,
          // The inner graph runs whole. A page event and a single-node run are
          // asked at the level they were asked at, and mean nothing here.
          trigger: null,
          only: undefined,
          // Nothing is held in there: the same inner graph may sit in two
          // nodes, or run once per item, and one's last value is not another's.
          latch: undefined,
          reuse: undefined,
        });
      },
    },
  };
}

/** Whether a value is nothing: not delivered, empty text, a list of nothing -- two empty boxes wired into one port. */
function isNothing(value: unknown): boolean {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.every(isNothing));
}

/**
 * Why this node has nothing to do this round, or '' when it has.
 *
 * Two ways to have nothing to do. A port marked required is wired and brought
 * nothing. Or the element is one that works *on* its inputs (`needsInput`: an
 * ai node) and every wire into it came up empty -- ▶ Run on a chat nobody has
 * typed into, a summarizer before a file is chosen.
 *
 * Only *wired* ports count, both times. An unwired one is how the node was
 * built -- an ai node with nothing but instructions is a legitimate thing to
 * make -- while a wired one that came up empty is this round having nothing to
 * say.
 */
function nothingToDo(
  element: NodeRunner<unknown>,
  node: GraphNode,
  inputs: Record<string, unknown>,
  edges: GraphEdge[],
  feedback: Set<string>,
): string {
  const wired = new Set(edges
    .filter((e) => e.target_node_id === node.id && e.target_port_id !== RUN_PORT && !feedback.has(e.id))
    .map((e) => e.target_port_id));

  for (const port of node.inputs) {
    if (port.required && wired.has(port.id) && isNothing(inputs[port.id])) {
      return `Nothing arrived on "${port.name || port.id}", which this node needs -- so it had nothing to do.`;
    }
  }
  if (element.needsInput(node) && wired.size && [...wired].every((id) => isNothing(inputs[id]))) {
    return 'Nothing arrived on any of its inputs, so there was nothing to ask.';
  }
  return '';
}

/**
 * One node's inputs, obtained by running what feeds it -- and not the node.
 *
 * For trying a node out before the graph has ever run: the file is picked, the
 * CSV parsed, the page's fields read, and what would arrive at this node is
 * handed back, without the model call or the chart the node itself would cost.
 * Feedback edges count here, unlike in a run: a chart on a page is fed across
 * one, and "what would this block be shown" is exactly the question. What
 * computes the ◆ of what feeds it runs too (`neededFor`), or that never opens.
 */
export async function inputsFor(
  graph: Graph,
  nodeId: string,
  options: RunOptions,
): Promise<{ inputs: Record<string, unknown>; upstream: ExecutionResult }> {
  const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, options.registry);
  const into = graph.edges.filter((e) => e.target_node_id === nodeId && e.target_port_id !== RUN_PORT);
  const only = neededFor(graph, into.map((e) => e.source_node_id).filter((id) => id !== nodeId), feedback);
  only.delete(nodeId);
  // A page feeds itself through the graph: its own fields are upstream of its
  // own chart. It is cheap to run and has no side effects, so it runs.
  if (into.some((e) => feedback.has(e.id))) only.add(nodeId);

  const upstream = await executeGraph(graph, { ...options, trigger: null, only });
  const produced = new Map(upstream.node_results.map((r) => [r.node_id, r.outputs]));
  return { inputs: collectInputs(nodeId, graph.edges, produced, new Set()), upstream };
}

/**
 * Run one node by itself, on inputs someone supplies.
 *
 * For trying a node out while writing it: the prompt against last run's
 * values, or against a sentence typed for the purpose. It goes through the
 * same steps a node in a run does -- wired files read into text, fan-out over
 * a list -- because a test that skipped one of them would pass on something
 * the run then does differently.
 *
 * Nothing is settled and nothing downstream runs. A failure is the result,
 * not an exception: the person asked what this node does with these inputs,
 * and "it fails, like this" is an answer -- the answer a run would give: a
 * node with nothing to do stands still, one that catches its failures puts
 * them on its error port, and what does not fit its output.js is said.
 */
export async function executeNode(
  graph: Graph,
  nodeId: string,
  inputs: Record<string, unknown>,
  options: NodeRunOptions,
): Promise<NodeResult> {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const element = node && options.registry.node(node.node_type);
  if (!node || !element) {
    return { node_id: nodeId, status: 'error', inputs, outputs: {}, error: `No such node: ${nodeId}` };
  }
  const why = nothingToDo(element, node, inputs, graph.edges, memoryFeedbackEdges(graph.nodes, graph.edges, options.registry));
  if (why) return { node_id: nodeId, status: 'skipped', inputs, outputs: {}, error: null, messages: [why] };
  const runtime = stoppable(options.runtime, options.signal);
  try {
    const arrived = await readInputs(element, node, inputs, runtime, options.registry);
    const { produced, failures } = await runNode(
      element, node, arrived, withSubgraph(runtime, options, node, options.depth ?? 0), options.signal,
    );
    return ranTo(element, node, inputs, produced, failures);
  } catch (error) {
    return failedWith(element, node, inputs, error);
  }
}

/**
 * One call of a node's body on *inputs* as the body is handed them -- the
 * example in its input.js: no file is read, because the example already holds
 * what a read file gives, and nothing fans out, because the example is one
 * item. What one call returns is what its output.js describes, so it comes
 * back as the call returned it, to be held to that (`examples.ts`).
 */
export async function callNode(
  graph: Graph,
  nodeId: string,
  inputs: Record<string, unknown>,
  options: NodeRunOptions,
): Promise<NodeResult> {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const element = node && options.registry.node(node.node_type);
  if (!node || !element) {
    return { node_id: nodeId, status: 'error', inputs, outputs: {}, error: `No such node: ${nodeId}` };
  }
  try {
    const runtime = withSubgraph(stoppable(options.runtime, options.signal), options, node, options.depth ?? 0);
    const outputs = reconcileOutputs(node, await element.execute(node, inputs, runtime));
    return { node_id: nodeId, status: 'success', inputs, outputs, error: null };
  } catch (error) {
    return failedWith(element, node, inputs, error);
  }
}

/**
 * What a node that ran comes to. Some items failed and the rest went through:
 * partial, and said, rather than a success whose gaps are nulls nobody
 * explains. What does not fit its output definition is said, not enforced:
 * the values are what they are, but a node that broke it is named here rather
 * than blamed three nodes later by whatever read the wrong shape.
 */
function ranTo(
  element: NodeRunner,
  node: GraphNode,
  inputs: Record<string, unknown>,
  produced: Record<string, unknown>,
  failures: string[] & { total: number },
): NodeResult {
  const iface = element.outputInterface(node);
  const broken = iface ? mismatches(produced, iface) : [];
  return {
    node_id: node.id, status: failures.length ? 'partial' : 'success', inputs, outputs: produced,
    error: failures.length ? itemFailures(failures) : null,
    ...(broken.length ? { messages: broken.map((line) => `Does not fit its output.js: ${line}`) } : {}),
  };
}

/**
 * What a node that threw comes to. One that catches its own failures turns
 * one into data instead of ending the run: the message goes on its `error`
 * port, its other ports carry null, and whatever that port feeds gets to
 * react -- asked of the element, so one mechanism covers every kind. Still
 * `partial`, never `success`: a node whose outputs are nulls nobody explains
 * is how a broken run comes to look like a clean one.
 */
function failedWith(element: NodeRunner, node: GraphNode, inputs: Record<string, unknown>, error: unknown): NodeResult {
  const message = error instanceof Error ? error.message : String(error);
  if (element.catchesErrors(node)) {
    return { node_id: node.id, status: 'partial', inputs, outputs: failureOutputs(node, message), error: message };
  }
  return { node_id: node.id, status: 'error', inputs, outputs: {}, error: message };
}

/**
 * One node by itself, as `run-node` and the MCP server's `run_node` run it: on
 * the inputs *given*, or -- without them -- on what the nodes feeding it
 * produce, which run for that and nothing else. The graph's questions are
 * answered with what it already holds, as an unattended run answers them.
 * Hands back the inputs it ran on too, since without *given* nobody else knows.
 *
 * What feeds it failing -- or standing still with nothing to hand on, its ◆
 * shut or nothing for it to do -- is this node failing to run, as in a run: it
 * is not run on the nothing that arrived and called a success.
 */
export async function runNodeAlone(
  graph: Graph,
  nodeId: string,
  given: Record<string, unknown> | undefined,
  options: RunOptions,
): Promise<{ inputs: Record<string, unknown>; result: NodeResult }> {
  if (given) return { inputs: given, result: await executeNode(graph, nodeId, given, options) };
  const { inputs, upstream } = await inputsFor(graph, nodeId, options);
  const still = upstream.node_results.find((result) => result.status === 'skipped' && !result.held);
  const stood = still && graph.nodes.find((node) => node.id === still.node_id);
  const why = upstream.node_results.some((result) => result.status === 'error')
    ? `What feeds it failed, so it did not run: ${upstream.error}`
    : stood ? `What feeds it had nothing to hand on, so it did not run: ${nodeName(stood)}: ${still.messages?.[0] ?? 'it stood still.'}` : '';
  if (why) return { inputs, result: { node_id: nodeId, status: 'error', inputs, outputs: {}, error: why } };
  return { inputs, result: await executeNode(graph, nodeId, inputs, options) };
}

/**
 * A node the way a person finds it on the canvas.
 *
 * `code node "Chart transform" (transform_1)`, not `transform_1`: the id is
 * what the report needs and the label is what the reader recognises, and a
 * message that carries only one of them sends them looking for the other.
 */
export function nodeName(node: GraphNode): string {
  return `${node.node_type} node ${node.label && node.label !== node.id ? `"${node.label}" (${node.id})` : `"${node.id}"`}`;
}

/**
 * What the element is given: the wired values, with the file on each input
 * that says "read the file at this path" read into its content.
 *
 * Run once per item, a list it runs over is read an item's file at a time, as
 * many at once as items run at once, and a file that cannot be read costs its
 * item (`readPorts`). Read before any item runs rather than as each does:
 * whether a node run only as context hands back what it made last is decided
 * by what its files say (`reuse.ts`).
 */
async function readInputs(
  element: NodeRunner<unknown>,
  node: GraphNode,
  inputs: Record<string, unknown>,
  runtime: Runtime,
  registry: Runners,
): Promise<Record<string, unknown>> {
  const ports = filePorts(node, registry);
  if (!ports.length) return inputs;
  const each = element.batchMode(node) === 'per_item'
    ? { ports: new Set(node.inputs.filter((port) => port.multi).map((port) => port.id)), atOnce: element.batchConcurrency(node) }
    : undefined;
  try {
    return await readPorts(inputs, ports, runtime.files, each);
  } catch (error) {
    throw unreadable(error);
  }
}

/**
 * A file that could not be read, as the node's failure -- or an item's. The
 * reading is named: a node that never got as far as its own work failed at a
 * missing file, and "ENOENT" on its own reads as though the body went looking
 * for one.
 */
function unreadable(error: unknown): Error {
  return new Error(`Reading its input files: ${error instanceof Error ? error.message : String(error)}`);
}

/** The run's own sentence about what went wrong: which nodes, by name, and why. */
function failureSummary(results: NodeResult[], byId: Map<string, GraphNode>): string {
  const broken = results.filter((result) => result.status === 'error');
  const skipped = results.filter((result) => result.status === 'skipped' && !result.messages?.length).length;
  const named = broken.map((result) => {
    const node = byId.get(result.node_id);
    const first = (result.error ?? '').split('\n')[0].trim();
    return `${node ? nodeName(node) : `node "${result.node_id}"`} failed${first ? `: ${first}` : ''}`;
  });
  // Nothing errored but something is in `failed`: a node that could not run
  // because what feeds it did not. Naming the count keeps the run from
  // claiming success with no reason given.
  if (!named.length) return `${skipped} node${skipped === 1 ? '' : 's'} could not run.`;
  return named.join('; ') + (skipped ? ` (${skipped} more could not run)` : '');
}

/**
 * What a node that caught its own failure hands on.
 *
 * Null on every declared port so anything downstream sees "nothing arrived"
 * rather than a missing key, and the message on `error` -- the port a person
 * wires when they want to do something about it, and may leave unwired when
 * they only want the run to carry on.
 */
function failureOutputs(node: GraphNode, message: string): Record<string, unknown> {
  const produced: Record<string, unknown> = {};
  for (const port of node.outputs) produced[port.id] = null;
  produced[ERROR_PORT] = message;
  return produced;
}

/** A fan-out that lost some items, in one sentence: how many, and the first reason. */
function itemFailures(failures: string[] & { total: number }): string {
  return `${failures.length} of ${failures.total} items failed: ${failures[0]}`;
}

/**
 * Run one node, fanning out if it asked to.
 *
 * A failing item contributes null on every declared port, keeping the results
 * index-aligned with their inputs, and its message is reported rather than
 * ending the batch: one bad row out of two thousand should cost one row.
 *
 * Except on the `error` port of a node that catches its failures. That port
 * promises the reason, and a list with a null per failed item is no reason --
 * it is a list nobody can read, and a non-empty one, so whatever is wired to
 * the port runs on it. It carries the same sentence the node's result does,
 * once for the node, the way a whole-node failure puts one message there.
 */
async function runNode(
  element: NodeRunner<unknown>,
  node: GraphNode,
  inputs: Record<string, unknown>,
  runtime: Runtime,
  signal?: AbortSignal,
): Promise<{ produced: Record<string, unknown>; failures: string[] & { total: number } }> {
  if (element.batchMode(node) !== 'per_item') {
    const produced = reconcileOutputs(node, await element.execute(node, inputs, runtime));
    return { produced, failures: Object.assign([] as string[], { total: 1 }) };
  }

  const { items, fanned } = batchItems(node, inputs);
  const produced: Record<string, unknown>[] = new Array(items.length);
  const failed: { index: number; message: string }[] = [];
  const catches = element.catchesErrors(node);
  let done = 0;

  await atMost(items.length, element.batchConcurrency(node), async (index) => {
    try {
      const unread = Object.values(items[index]).find((value) => value instanceof Unread);
      if (unread) throw unreadable(unread);
      produced[index] = reconcileOutputs(node, await element.execute(node, items[index], runtime));
    } catch (error) {
      // One bad item must not take the other 499 down with it -- but it is
      // not nothing either: it is counted, and the first is quoted.
      produced[index] = Object.fromEntries(node.outputs
        .filter((p) => !(catches && p.id === ERROR_PORT))
        .map((p) => [p.id, null]));
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ index, message });
      runtime.report?.({ type: 'activity', node_id: node.id, message: `item ${index + 1}: ${message}` });
    }
    runtime.report?.({ type: 'batch', node_id: node.id, done: ++done, total: items.length });
  }, signal);
  // In item order, not the order they happened to fail in: the same run says
  // the same thing every time.
  failed.sort((a, b) => a.index - b.index);
  const failures = Object.assign(failed.map(({ index, message }) => `item ${index + 1}: ${message}`), { total: items.length });
  // Every item failed: that is the node failing, with its own message, not a
  // success made of nulls.
  if (items.length && failed.length === items.length) throw new Error(failed[0].message);
  const merged = mergeBatchOutputs(node, produced, fanned);
  if (catches && failures.length) merged[ERROR_PORT] = itemFailures(failures);
  return { produced: merged, failures };
}

/**
 * What memory nodes keep from this round, settled into the graph the round ran on.
 *
 * Two ways a value is kept. A feedback edge's value is handed to the node that
 * remembers it -- for the next round, and into this round's own result, so a
 * page shows the value it just produced instead of the one from last time. And
 * a node that settles on arrival (a data node) keeps whatever an ordinary edge
 * delivered, because "remember this" does not depend on being in a loop.
 *
 * That copy is the whole of it: a session keeps it (`host/session.ts`), and
 * nobody works the same thing out a second time.
 *
 * Per port, as the round delivers: a port fed by several wires keeps the list
 * of what arrived on them, not whichever wire came last.
 */
function settleMemory(
  graph: Graph,
  feedback: Set<string>,
  outputs: Map<string, Record<string, unknown>>,
  results: NodeResult[],
  registry: Runners,
): void {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  const ports = new Map<string, { target: GraphNode; element: NodeRunner; port: string; wires: GraphEdge[]; loops: boolean }>();
  for (const edge of graph.edges) {
    if (edge.target_port_id === RUN_PORT) continue;
    const target = byId.get(edge.target_node_id);
    const element = target && registry.node(target.node_type);
    if (!target || !element?.isMemory) continue;
    const key = JSON.stringify([target.id, edge.target_port_id]);
    const entry = ports.get(key) ?? { target, element, port: edge.target_port_id, wires: [], loops: false };
    entry.wires.push(edge);
    entry.loops ||= feedback.has(edge.id);
    ports.set(key, entry);
  }

  for (const { target, element, port, wires, loops } of ports.values()) {
    if (!loops && !element.settlesOnArrival) continue;
    const delivered = wires.filter((edge) => edge.source_port_id in (outputs.get(edge.source_node_id) ?? {}));
    if (!delivered.length) continue;
    const values = delivered.map((edge) => outputs.get(edge.source_node_id)![edge.source_port_id]);
    const value = wires.length > 1 ? values : values[0];
    element.settleMemory(target, port, value);

    if (!loops) continue;
    // Said as having arrived, because it did -- only after the round rather
    // than in it. A node the event did not ask to run gets a result for this.
    let result = results.find((r) => r.node_id === target.id);
    if (!result) {
      result = { node_id: target.id, status: 'success', inputs: {}, outputs: {}, error: null };
      results.push(result);
    }
    result.inputs = { ...result.inputs, [port]: value };
  }
}

/**
 * What each node shows, worked out once everything has arrived.
 *
 * After settling, not during the node's own run: a chart on a page that also
 * holds the file picker is fed across a feedback edge, so while the page runs
 * its chart has nothing yet -- on every page with both an input and a display,
 * which is most of them.
 *
 * What stood still is shown as it was: the editor and the page keep the
 * display they have, and an image is not read again for nothing. That is a
 * page that stood still, and a port of one that ran which only nodes in *held*
 * are wired to -- over a wire that closes no loop, what they were left
 * holding reached it as it runs.
 */
async function showDisplays(
  graph: Graph,
  results: NodeResult[],
  registry: Runners,
  runtime: Runtime,
  held: Set<string>,
): Promise<void> {
  for (const result of results) {
    const node = graph.nodes.find((n) => n.id === result.node_id);
    const element = node && registry.node(node.node_type);
    if (!node || !element?.hasInterface || result.status === 'error' || result.held) continue;
    const stale = (port: string): boolean => {
      const wires = graph.edges.filter((edge) => edge.target_node_id === node.id && edge.target_port_id === port);
      return wires.length > 0 && wires.every((edge) => held.has(edge.source_node_id));
    };
    const fresh = Object.fromEntries(Object.entries(result.inputs).filter(([port]) => !stale(port)));
    result.display = await element.display(node, fresh, runtime);
  }
}

/**
 * What the run produced, keyed by the graph's output nodes' labels.
 *
 * Two output nodes may well be given one label, and a run's result is not a
 * place where one of them may quietly replace the other. The first keeps the
 * label; one that comes later under a label already taken is told apart by its
 * id (`resultKeys`), and `check` says to give it a label of its own.
 *
 * "First" in the graph, whether or not it produced anything this run: a round
 * started by a page event, or one where the first stood still, would
 * otherwise hand another's value on under its key -- and whoever lays rounds
 * over each other (a session) would lose one of them once more.
 */
function finalOutputs(
  nodes: GraphNode[],
  outputs: Map<string, Record<string, unknown>>,
  registry: Runners,
): Record<string, unknown> {
  const final: Record<string, unknown> = {};
  for (const [nodeId, key] of resultKeys(nodes, registry)) {
    const produced = outputs.get(nodeId);
    if (produced) final[key] = produced;
  }
  return final;
}
