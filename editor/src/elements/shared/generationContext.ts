import type { ExecutionResult, GraphNode } from '../../types/graph';
import { describeDataFormat } from '@engine/elements/data/editor/definition';
// Read inside functions only. The registry imports every element and an element
// imports this module, so touching NODE_ELEMENTS at module scope would read a
// binding that is still being initialised; at call time it is complete.
import { NODE_ELEMENTS } from '../registry';

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
 * Each element answers for itself now (`NodeElementDefinition.describeOutput`),
 * so a new node type describes its output in its own file and nothing here
 * changes.
 */
export function describeNodeOutput(node: GraphNode): string {
  return NODE_ELEMENTS[node.node_type]?.describeOutput?.(node) ?? '';
}

/**
 * The declared output format as a sentence for the model, or nothing when the
 * node emits plain text. Both ai and code generation want it, which is why it
 * is here rather than in either element.
 */
export function outputFormatContext(config: GraphNode['config']): string {
  if (!config.output_format || config.output_format === 'text') return '';
  const custom = config.output_format === 'custom' && config.output_format_prompt
    ? ` (${config.output_format_prompt})`
    : '';
  return `The function must return output in ${config.output_format} format${custom}.`;
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
      // The wording for a data node is kept verbatim: it is the one contract a
      // user writes deliberately, and existing graphs' prompts were tuned to it.
      lines.add(source.node_type === 'data'
        ? `Source data format from "${source.label}": ${described}`
        : `Input from "${source.label}" (${source.node_type} node): ${described}`);
    }
    if (edge.source === nodeId) {
      const target = nodeById.get(edge.target);
      if (!target) continue;
      if (target.node_type === 'data') {
        lines.add(`Target data format required by "${target.label}": ${describeDataFormat(target)}`);
      } else {
        lines.add(`Output goes to "${target.label}" (${target.node_type} node).`);
      }
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
 * This is the machine-readable half: the backend runs the generated function
 * against it and repairs the code if it fails (see backend/app/services/
 * code_refine.py). Undefined when the node has never run, which turns the
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
