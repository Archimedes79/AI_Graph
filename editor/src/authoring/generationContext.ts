import type { ExecutionResult, GraphNode } from '@/graph';
// This module reads the element registry, so no element's `…Ui.ts` may import
// it: that would be a cycle through the registry (see `outputFormat.ts`).
import { NODE_UIS } from '@/elements/registry';

/**
 * What the ✨ Generate buttons tell the AI about the world around a node.
 *
 * A node's own description says what the user wants; these say what the node is
 * actually wired to and what really flowed through it. Without them a model has
 * to guess the shape of its inputs, and a small local model guesses badly.
 *
 * Two independent sources, both optional and both cheap:
 *
 *  - `connectedFormatContext` — the *declared* contracts of the neighbours, from
 *    the graph itself.
 *  - `lastRunContext` — the *observed* values from the most recent run. Run once,
 *    then generate, and the model sees real data instead of a description of it.
 */

/** How many characters of a sampled value to include before truncating. */
const SAMPLE_BUDGET = 1200;

/**
 * What a node emits, in one line.
 *
 * This was a `switch (node.node_type)` -- the last one in shared editor code.
 * Each element answers for itself now (`NodeUi.describeOutput`),
 * so a new node type describes its output in its own file and nothing here
 * changes.
 */
export function describeNodeOutput(node: GraphNode): string {
  return NODE_UIS[node.node_type]?.describeOutput?.(node) ?? '';
}

/**
 * The declared contracts of everything wired directly to *nodeId*.
 *
 * This used to consider `data` nodes only, so a code node fed by a file input or
 * by another code node was generated with no idea what it would receive -- which
 * is most graphs.
 */
export function connectedFormatContext(
  nodeId: string,
  nodes: GraphNode[],
  edges: Array<{ source: string; target: string }>,
): string {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // A Set, because two ports wired to the same neighbour are two edges but one
  // fact: repeating it only spends the model's attention on nothing.
  const lines = new Set<string>();

  for (const edge of edges) {
    if (edge.target === nodeId) {
      const source = nodeById.get(edge.source);
      if (!source) continue;
      const described = describeNodeOutput(source);
      if (!described) continue;
      lines.add(NODE_UIS[source.node_type].describeAsSource(source, described));
    }
    if (edge.source === nodeId) {
      const target = nodeById.get(edge.target);
      if (!target) continue;
      lines.add(NODE_UIS[target.node_type].describeAsTarget(target));
    }
  }
  return [...lines].join('\n');
}

function preview(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text === undefined) return String(value);
  return text.length > SAMPLE_BUDGET ? `${text.slice(0, SAMPLE_BUDGET)}\n… (truncated)` : text;
}

/**
 * What actually arrived on this node's input ports the last time the graph ran.
 *
 * The single most informative thing available, and it was going unused: the
 * store already holds it, and a description of a CSV is a poor substitute for
 * eight of its rows. Absent before the first run, which is exactly when there is
 * nothing to say.
 */
/**
 * The raw values this node's input ports received on the last run.
 *
 * `lastRunContext` above renders the same values as prose for the model to read.
 * This is the machine-readable half: the server runs the generated function
 * against it and repairs the code if it fails (see
 * engine/src/host/editor/generate.ts). Undefined when the node has never run, which turns the
 * verification pass off rather than inventing a sample.
 */
export function lastRunInputs(
  nodeId: string,
  result: ExecutionResult | null,
): Record<string, unknown> | undefined {
  const inputs = result?.node_results?.find((r) => r.node_id === nodeId)?.inputs;
  if (!inputs || Object.keys(inputs).length === 0) return undefined;
  return inputs;
}

/**
 * What arrived at one block on a page, last run, shaped as its transform sees it.
 *
 * A block's transform is handed `{value: <what came in>}`, and until this
 * existed it was generated against nothing at all: the node editor passed the
 * last run's inputs and the block editor passed none, so asking for a chart
 * meant asking a model to guess what it would be charting.
 */
export function lastRunWidgetInput(
  nodeId: string,
  widgetId: string,
  result: ExecutionResult | null,
): Record<string, unknown> | undefined {
  const inputs = result?.node_results?.find((r) => r.node_id === nodeId)?.inputs;
  const arrived = inputs?.[`${widgetId}_in`];
  return arrived === undefined ? undefined : { value: arrived };
}

export function lastRunContext(nodeId: string, result: ExecutionResult | null): string {
  const nodeResult = result?.node_results?.find((r) => r.node_id === nodeId);
  const inputs = nodeResult?.inputs;
  if (!inputs || Object.keys(inputs).length === 0) return '';

  const lines = Object.entries(inputs).map(([port, value]) => {
    const shape = Array.isArray(value) ? `list of ${value.length}` : typeof value;
    return `- ${port} (${shape}):\n${preview(value)}`;
  });
  return `Actual values this node received on its last run -- generate against these, not against a guess:\n${lines.join('\n')}`;
}

/**
 * Which node feeds each of *nodeId*'s input ports, by label.
 *
 * The wiring is the one thing a generation request cannot otherwise carry, and
 * it is what turns a skeleton line from `files: list[str]` into
 * `files: list[str]  # from "Ordner"` — provenance, which no type expresses.
 *
 * A port fed by several nodes (fan-in) names them all: that a value is a list
 * *because two nodes write into it* is exactly the case generated code gets
 * wrong when it assumes a scalar.
 */
export function inputSources(
  nodeId: string,
  nodes: GraphNode[],
  edges: Array<{ source: string; target: string; targetHandle?: string | null }>,
): Record<string, string> {
  const labelById = new Map(nodes.map((node) => [node.id, node.label]));
  const byPort: Record<string, string[]> = {};
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const port = edge.targetHandle ?? 'input';
    const label = labelById.get(edge.source);
    if (!label) continue;
    (byPort[port] ??= []).push(label);
  }
  return Object.fromEntries(
    Object.entries(byPort).map(([port, labels]) => [port, [...new Set(labels)].join('" + "')]),
  );
}
