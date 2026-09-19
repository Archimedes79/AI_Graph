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

import type { Graph, GraphEdge, GraphNode, ExecutionResult, MemoryWrite, NodeResult, NodeStatus } from '../graph.ts';
import type { NodeElement } from '../elements/NodeElement.ts';
import type { Runtime } from '../elements/Runtime.ts';
import { batchItems, mergeBatchOutputs, reconcileOutputs } from './batching.ts';
import { readFileInputs } from './fileInputs.ts';
import { RUN_PORT, firedNodes, triggeredNodes, upstreamOf, type Trigger } from './triggers.ts';
import type { LastOutputs } from './reuse.ts';
import { mismatches } from './interface.ts';

export interface Registry {
  node(type: string): NodeElement<unknown> | undefined;
}

/** Ids of the fewest edges that must be ignored to make the graph acyclic. */
export function memoryFeedbackEdges(
  nodes: GraphNode[],
  edges: GraphEdge[],
  registry: Registry,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const feedback = new Set<string>();

  const remembers = (nodeId: string): boolean => {
    const node = byId.get(nodeId);
    return node ? registry.node(node.node_type)?.isMemory === true : false;
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

    // Cut one more edge into a node that remembers. If there is none, the cycle
    // is a real one and `topologicalLevels` reports it as such.
    const candidate = active.find((e) => !visited.has(e.target_node_id) && remembers(e.target_node_id));
    if (!candidate) return feedback;
    feedback.add(candidate.id);
  }
}

/**
 * The graph's own runtime AI default, applied to every node that names none.
 *
 * `metadata.ai_defaults` is what "configure the AI once for this graph" saves,
 * and the editor promises that an AI node left on "use the graph's default"
 * follows it. It sits below anything the machine configured -- a settings file
 * or an environment variable still wins, which is how one graph is moved to a
 * different provider without editing it -- and above the provider layer's own
 * fallback. A graph that names nothing changes nothing.
 */
export function withGraphDefaults(runtime: Runtime, graph: Graph): Runtime {
  const wanted = graph.metadata?.ai_defaults;
  const provider = wanted?.provider && wanted.provider !== 'default' ? wanted.provider : '';
  const model = wanted?.model ?? '';
  if (!provider && !model) return runtime;
  return {
    ...runtime,
    ai: {
      complete: (request) => runtime.ai.complete({
        ...request,
        provider: request.provider && request.provider !== 'default' ? request.provider : (provider || request.provider),
        model: request.model || model,
      }),
    },
  };
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
  registry: Registry;
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
}

/**
 * Run the graph once.
 *
 * A node that throws is recorded as failed and its dependents are skipped
 * rather than the run being abandoned: the report should say what happened
 * everywhere, not only where it stopped first.
 */
export async function executeGraph(graph: Graph, options: RunOptions): Promise<ExecutionResult> {
  const { registry } = options;
  const { signal } = options;
  const runtime = stoppable(withGraphDefaults(options.runtime, graph), signal);
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

  const outputs = new Map<string, Record<string, unknown>>();
  const results: NodeResult[] = [];
  const failed = new Set<string>();
  const partial = new Set<string>();
  // Nodes that had nothing to do. Not a failure and not a success: the chat
  // page opened and ▶ Run pressed before anyone has said anything.
  const idle = new Set<string>();

  const dependsOn = (nodeId: string, those: Set<string>): boolean =>
    edges.some((e) => e.target_node_id === nodeId && !feedback.has(e.id) && those.has(e.source_node_id));

  for (const level of levels) {
    for (const nodeId of level) {
      // Not part of what this event started: left alone, and left out of the
      // report too -- it did not fail and it was not skipped, it was not asked.
      if (only && !only.has(nodeId)) continue;
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

      // A wired input the node declared it cannot do without, and nothing on
      // it: the node has nothing to do, and neither has what hangs off it.
      // Sending a model "User:" followed by nothing is not a question.
      const why = dependsOn(nodeId, idle)
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
        const given = element.readsFileInputs(node)
          ? await readFileInputs(node, inputs, runtime)
          : inputs;
        const key = options.reuse?.key(node, given);
        const kept = key && context(nodeId) ? options.reuse!.get(key) : undefined;
        if (kept) {
          outputs.set(nodeId, kept);
          results.push({
            node_id: nodeId, status: 'success', inputs, outputs: kept, error: null,
            messages: ['Reused from an earlier run: nothing it depends on has changed.'],
          });
          runtime.report?.({ type: 'node_done', node_id: nodeId, status: 'success' });
          continue;
        }
        const { produced, failures } = await runNode(element, node, given, runtime, signal);
        if (signal?.aborted) throw new Error('Stopped.');
        outputs.set(nodeId, produced);
        // Kept only when it went through whole: a partial result is not one to hand back.
        if (key && !failures.length) options.reuse!.set(key, produced);
        // Some items failed and the rest went through: the node is partial and
        // says so, rather than a success whose gaps are nulls nobody explains.
        const status = failures.length ? 'partial' : 'success';
        if (failures.length) partial.add(nodeId);
        // Said, not enforced: the values are what they are and the run goes on,
        // but a node that broke its interface is named here rather than blamed
        // three nodes later by whatever read the wrong shape.
        const iface = element.outputInterface(node);
        const broken = iface ? mismatches(produced, iface) : [];
        results.push({
          node_id: nodeId, status, inputs, outputs: produced,
          error: failures.length ? `${failures.length} of ${failures.total} items failed: ${failures[0]}` : null,
          ...(broken.length ? { messages: broken.map((line) => `Does not match its output interface: ${line}`) } : {}),
        });
        runtime.report?.({ type: 'node_done', node_id: nodeId, status });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Stopped in the middle of this node: not the node's failure, and not
        // something a catch-errors port should turn into data.
        if (signal?.aborted) {
          results.push({ node_id: nodeId, status: 'skipped', inputs, outputs: {}, error: null, messages: ['Stopped.'] });
          runtime.report?.({ type: 'node_done', node_id: nodeId, status: 'skipped' });
          continue;
        }

        // A node that catches its own failures turns one into data instead of
        // ending the run: the message goes on its `error` port, its other
        // ports carry null, and whatever that port feeds gets to react. Asked
        // of the element rather than switched on a node type here, so a new
        // element that wants it says so in its own file -- and one mechanism
        // covers every kind rather than a copy inside each.
        //
        // Still `partial`, never `success`: something did go wrong, and a node
        // whose outputs are nulls nobody explains is how a broken run comes to
        // look like a clean one.
        if (element.catchesErrors(node)) {
          const produced = failureOutputs(node, message);
          outputs.set(nodeId, produced);
          partial.add(nodeId);
          results.push({ node_id: nodeId, status: 'partial', inputs, outputs: produced, error: message });
          runtime.report?.({ type: 'node_done', node_id: nodeId, status: 'partial' });
          continue;
        }

        failed.add(nodeId);
        results.push({ node_id: nodeId, status: 'error', inputs, outputs: {}, error: message });
        runtime.report?.({ type: 'node_done', node_id: nodeId, status: 'error' });
      }
    }
  }

  const memory = settleMemory(graph, feedback, outputs, results, registry);
  await showDisplays(graph, results, registry, runtime);

  const status: ExecutionResult['status'] = signal?.aborted
    ? 'cancelled'
    : failed.size === 0 && partial.size === 0
      ? 'success'
      : failed.size === (only?.size ?? nodes.length) ? 'error' : 'partial';

  return {
    status,
    node_results: results,
    outputs: finalOutputs(nodes, outputs, registry),
    memory,
    error: failed.size ? [...failed].map((id) => `${id} failed`).join('; ') : null,
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
  return {
    ...runtime,
    ai: { complete: (request) => runtime.ai.complete({ ...request, signal }) },
    code: { run: (body, inputs) => runtime.code.run(body, inputs, signal) },
  };
}

/** Whether a value is nothing: not delivered, empty text, an empty list. */
function isNothing(value: unknown): boolean {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0);
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
  element: NodeElement<unknown>,
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
 * one, and "what would this block be shown" is exactly the question.
 */
export async function inputsFor(
  graph: Graph,
  nodeId: string,
  options: RunOptions,
): Promise<{ inputs: Record<string, unknown>; upstream: ExecutionResult }> {
  const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, options.registry);
  const into = graph.edges.filter((e) => e.target_node_id === nodeId && e.target_port_id !== RUN_PORT);
  const only = upstreamOf(graph, into.map((e) => e.source_node_id).filter((id) => id !== nodeId), feedback);
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
 * same steps a node in a run does -- the graph's AI default, wired files read
 * into text, fan-out over a list -- because a test that skipped one of them
 * would pass on something the run then does differently.
 *
 * Nothing is settled and nothing downstream runs. A failure is the result,
 * not an exception: the person asked what this node does with these inputs,
 * and "it fails, like this" is an answer.
 */
export async function executeNode(
  graph: Graph,
  nodeId: string,
  inputs: Record<string, unknown>,
  options: RunOptions,
): Promise<NodeResult> {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const element = node && options.registry.node(node.node_type);
  if (!node || !element) {
    return { node_id: nodeId, status: 'error', inputs, outputs: {}, error: `No such node: ${nodeId}` };
  }
  const runtime = withGraphDefaults(options.runtime, graph);
  try {
    const given = element.readsFileInputs(node) ? await readFileInputs(node, inputs, runtime) : inputs;
    const { produced, failures } = await runNode(element, node, given, runtime);
    return {
      node_id: nodeId, status: failures.length ? 'partial' : 'success', inputs, outputs: produced,
      error: failures.length ? `${failures.length} of ${failures.total} items failed: ${failures[0]}` : null,
    };
  } catch (error) {
    return {
      node_id: nodeId, status: 'error', inputs, outputs: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * What a node that caught its own failure hands on.
 *
 * Null on every declared port so anything downstream sees "nothing arrived"
 * rather than a missing key, and the message on `error` -- the port a person
 * wires when they want to do something about it, and may leave unwired when
 * they only want the run to carry on.
 */
export const ERROR_PORT = 'error';

function failureOutputs(node: GraphNode, message: string): Record<string, unknown> {
  const produced: Record<string, unknown> = {};
  for (const port of node.outputs) produced[port.id] = null;
  produced[ERROR_PORT] = message;
  return produced;
}

/**
 * Run one node, fanning out if it asked to.
 *
 * A failing item contributes null on every declared port, keeping the results
 * index-aligned with their inputs, and its message is reported rather than
 * ending the batch: one bad row out of two thousand should cost one row.
 */
async function runNode(
  element: NodeElement<unknown>,
  node: GraphNode,
  inputs: Record<string, unknown>,
  runtime: Runtime,
  signal?: AbortSignal,
): Promise<{ produced: Record<string, unknown>; failures: string[] & { total: number } }> {
  if (element.batchMode(node) !== 'per_item') {
    const produced = reconcileOutputs(node, await element.execute(node, inputs, runtime));
    return { produced, failures: Object.assign([] as string[], { total: 1 }) };
  }

  const items = batchItems(node, inputs);
  const produced: Record<string, unknown>[] = new Array(items.length);
  const failures = Object.assign([] as string[], { total: items.length });
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length || signal?.aborted) return;
      try {
        produced[index] = reconcileOutputs(node, await element.execute(node, items[index], runtime));
      } catch (error) {
        // One bad item must not take the other 499 down with it -- but it is
        // not nothing either: it is counted, and the first is quoted.
        produced[index] = Object.fromEntries(node.outputs.map((p) => [p.id, null]));
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`item ${index + 1}: ${message}`);
        runtime.report?.({ type: 'activity', node_id: node.id, message: `item ${index + 1}: ${message}` });
      }
      runtime.report?.({ type: 'batch', node_id: node.id, done: ++done, total: items.length });
    }
  };

  const workers = Math.max(1, Math.min(element.batchConcurrency(node), items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  // Every item failed: that is the node failing, with its own message, not a
  // success made of nulls.
  if (items.length && failures.length === items.length) throw new Error(failures[0].replace(/^item 1: /, ''));
  return { produced: mergeBatchOutputs(node, produced), failures };
}

/**
 * What memory nodes keep from this round, done once and written down.
 *
 * Two ways a value is kept. A feedback edge's value is handed to the node that
 * remembers it -- for the next round, and into this round's own result, so a
 * page shows the value it just produced instead of the one from last time. And
 * a node that settles on arrival (a data node) keeps whatever an ordinary edge
 * delivered, because "remember this" does not depend on being in a loop.
 *
 * The list returned is the whole of it. Whoever holds the long-lived copy of
 * the graph -- the editor, a served page, the scheduler -- replays the list
 * into it instead of working the same thing out a second time, which is what
 * the editor's store used to do, in sixty lines that had already drifted.
 */
function settleMemory(
  graph: Graph,
  feedback: Set<string>,
  outputs: Map<string, Record<string, unknown>>,
  results: NodeResult[],
  registry: Registry,
): MemoryWrite[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const written: MemoryWrite[] = [];

  for (const edge of graph.edges) {
    const source = outputs.get(edge.source_node_id);
    if (!source || !(edge.source_port_id in source) || edge.target_port_id === RUN_PORT) continue;

    const target = byId.get(edge.target_node_id);
    const element = target && registry.node(target.node_type);
    if (!target || !element?.isMemory) continue;
    if (!feedback.has(edge.id) && !element.settlesOnArrival) continue;

    const value = source[edge.source_port_id];
    element.settleMemory(target, edge.target_port_id, value);
    written.push({ node_id: target.id, port_id: edge.target_port_id, value });

    if (!feedback.has(edge.id)) continue;
    // Said as having arrived, because it did -- only after the round rather
    // than in it. A node the event did not ask to run gets a result for this.
    let result = results.find((r) => r.node_id === target.id);
    if (!result) {
      result = { node_id: target.id, status: 'success', inputs: {}, outputs: {}, error: null };
      results.push(result);
    }
    result.inputs = { ...result.inputs, [edge.target_port_id]: value };
  }
  return written;
}

/**
 * What each node shows, worked out once everything has arrived.
 *
 * After settling, not during the node's own run: a chart on a page that also
 * holds the file picker is fed across a feedback edge, so while the page runs
 * its chart has nothing yet. Drawing then meant a block's transform was handed
 * `undefined` and the raw value was shown in its place -- on every page with
 * both an input and a display, which is most of them.
 */
async function showDisplays(
  graph: Graph,
  results: NodeResult[],
  registry: Registry,
  runtime: Runtime,
): Promise<void> {
  for (const result of results) {
    const node = graph.nodes.find((n) => n.id === result.node_id);
    const element = node && registry.node(node.node_type);
    if (!node || !element?.hasInterface || result.status === 'error') continue;
    result.display = await element.display(node, result.inputs, runtime);
  }
}

/** What the run produced, keyed the way the graph's output nodes asked. */
function finalOutputs(
  nodes: GraphNode[],
  outputs: Map<string, Record<string, unknown>>,
  registry: Registry,
): Record<string, unknown> {
  const final: Record<string, unknown> = {};
  for (const node of nodes) {
    if (registry.node(node.node_type)?.nodeType !== 'output') continue;
    const produced = outputs.get(node.id);
    if (!produced) continue;
    const label = String(node.config.output_label ?? '') || node.id;
    final[label] = produced;
  }
  return final;
}

export type { NodeStatus };
