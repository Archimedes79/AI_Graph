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

import type { Graph, GraphEdge, GraphNode, ExecutionResult, NodeResult, NodeStatus } from './graph.ts';
import type { NodeElement, Runtime } from './element.ts';
import { batchItems, mergeBatchOutputs, reconcileOutputs } from './batching.ts';
import { readFileInputs } from './fileInputs.ts';

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
function withGraphDefaults(runtime: Runtime, graph: Graph): Runtime {
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
  const runtime = withGraphDefaults(options.runtime, graph);
  const { nodes, edges } = graph;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const feedback = memoryFeedbackEdges(nodes, edges, registry);
  const levels = topologicalLevels(nodes, edges, feedback);

  const outputs = new Map<string, Record<string, unknown>>();
  const results: NodeResult[] = [];
  const failed = new Set<string>();
  const partial = new Set<string>();

  const dependsOnFailure = (nodeId: string): boolean =>
    edges.some((e) => e.target_node_id === nodeId && !feedback.has(e.id) && failed.has(e.source_node_id));

  for (const level of levels) {
    for (const nodeId of level) {
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

      if (dependsOnFailure(nodeId)) {
        failed.add(nodeId);
        results.push({ node_id: nodeId, status: 'skipped', inputs: {}, outputs: {}, error: null });
        continue;
      }

      const inputs = collectInputs(nodeId, edges, outputs, feedback);
      runtime.report?.({ type: 'node_start', node_id: nodeId });

      try {
        // What the run reports having received is what came off the wires --
        // the paths, not the megabytes behind them. Only the element sees the
        // contents.
        const given = element.readsFileInputs(node)
          ? await readFileInputs(node, inputs, runtime)
          : inputs;
        const { produced, failures } = await runNode(element, node, given, runtime);
        outputs.set(nodeId, produced);
        // Some items failed and the rest went through: the node is partial and
        // says so, rather than a success whose gaps are nulls nobody explains.
        const status = failures.length ? 'partial' : 'success';
        if (failures.length) partial.add(nodeId);
        results.push({
          node_id: nodeId, status, inputs, outputs: produced,
          error: failures.length ? `${failures.length} of ${failures.total} items failed: ${failures[0]}` : null,
        });
        runtime.report?.({ type: 'node_done', node_id: nodeId, status });
      } catch (error) {
        failed.add(nodeId);
        const message = error instanceof Error ? error.message : String(error);
        results.push({ node_id: nodeId, status: 'error', inputs, outputs: {}, error: message });
        runtime.report?.({ type: 'node_done', node_id: nodeId, status: 'error' });
      }
    }
  }

  settleMemoryFeedback(graph, feedback, outputs, results, registry);

  const status: ExecutionResult['status'] = failed.size === 0 && partial.size === 0
    ? 'success'
    : failed.size === nodes.length ? 'error' : 'partial';

  return {
    status,
    node_results: results,
    outputs: finalOutputs(nodes, outputs, registry),
    error: failed.size ? [...failed].map((id) => `${id} failed`).join('; ') : null,
  };
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
      if (index >= items.length) return;
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
 * Hand each feedback edge's fresh value to the node that remembers it, for the
 * next round — and into this round's own result, so a page shows the value it
 * just produced instead of the one from last time.
 */
function settleMemoryFeedback(
  graph: Graph,
  feedback: Set<string>,
  outputs: Map<string, Record<string, unknown>>,
  results: NodeResult[],
  registry: Registry,
): void {
  if (!feedback.size) return;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const edge of graph.edges) {
    if (!feedback.has(edge.id)) continue;
    const source = outputs.get(edge.source_node_id);
    if (!source || !(edge.source_port_id in source)) continue;

    const target = byId.get(edge.target_node_id);
    const element = target && registry.node(target.node_type);
    if (!target || !element) continue;

    const value = source[edge.source_port_id];
    element.settleMemory(target, edge.target_port_id, value);

    const result = results.find((r) => r.node_id === target.id);
    if (result) result.inputs = { ...result.inputs, [edge.target_port_id]: value };
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
