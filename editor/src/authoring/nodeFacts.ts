import type { Edge } from 'reactflow';
import type { ExecutionResult, GraphNode } from '@/graph';
import type { GenerationRequest } from './generation';
import { inputOrigins, lastRunInputs, outputTargets, readFilePorts } from './generationContext';
import { outputExampleText, outputFormatText } from './outputFormat';
import { sampleFor, sampleOrigin } from './tryValues';
import { NODE_BUILDERS } from '@/elements/registry';

/**
 * Before any run: what the nodes wired in hold without running -- a typed
 * text, a stored value. Only when every wired input has one: half a sample
 * would be tried on the code as if the other half were empty.
 */
function restingValues(
  node: GraphNode, nodes: GraphNode[], edges: Edge[],
): { values: Record<string, unknown>; origin: string } | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const values: Record<string, unknown> = {};
  const from = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== node.id || !edge.targetHandle) continue;
    const source = byId.get(edge.source);
    const value = source && edge.sourceHandle ? NODE_BUILDERS[source.node_type]?.restingValue(source, edge.sourceHandle) : undefined;
    if (value === undefined) return undefined;
    values[edge.targetHandle] = value;
    from.add(`"${source!.label}"`);
  }
  return Object.keys(values).length ? { values, origin: `what ${[...from].join(' and ')} holds now` } : undefined;
}

/**
 * Everything a node says about itself that ✨ Generate writes its body from,
 * as facts rather than sentences: the engine turns them into one brief
 * (`engine/src/host/editor/brief.ts`), the same for code and for a system
 * prompt, and cuts what is long to a budget.
 *
 *     task            the node's request (the element's prompt field)
 *     what comes in   each input: type, description, where from and what
 *                     that node hands on, and one sample
 *     what goes out   each output: description, where to and what the node
 *                     there wants; the format in words; an example; the
 *                     shape a run kept
 *     examples        the node's `examples.md`
 *
 * The node dialog, the graph sweep and "what ✨ sends" all ask this one
 * function, so none of them can tell the model less than the others.
 */
export function nodeFacts(
  node: GraphNode,
  nodes: GraphNode[],
  edges: Edge[],
  executionResult: ExecutionResult | null,
): Omit<GenerationRequest<GraphNode>, 'element' | 'generation' | 'subject' | 'fields'> {
  const inputs = node.inputs.map((port) => port.id);
  const observed = lastRunInputs(node.id, executionResult);
  const whole = node.config.batch_mode === 'whole_list';
  const tried = sampleFor(node.id, inputs, observed);
  const resting = tried ? undefined : restingValues(node, nodes, edges);
  return {
    ports: { inputs, outputs: node.outputs.map((port) => port.id) },
    exampleFile: node.config.example_file,
    sampleInputs: tried ?? resting?.values,
    sampleOrigin: tried ? sampleOrigin(node.id, inputs, observed) : resting?.origin,
    inputSources: inputOrigins(node.id, nodes, edges),
    readFilePorts: readFilePorts(node),
    // What a body is handed on each port: one item of a list input, unless the
    // node takes lists whole.
    inputTypes: Object.fromEntries(node.inputs.map((port) => {
      const base = port.data_type === 'list' ? 'any' : port.data_type;
      const list = port.data_type === 'list' || (port.multi && whole);
      return [port.id, list ? `list of ${base === 'any' ? 'values' : base}` : base];
    })),
    batchMode: node.inputs.some((port) => port.multi) ? (whole ? 'whole_list' : 'per_item') : undefined,
    portNotes: {
      inputs: Object.fromEntries(node.inputs.map((port) => [port.id, port.description ?? ''])),
      outputs: Object.fromEntries(node.outputs.map((port) => [port.id, port.description ?? ''])),
    },
    outputTargets: outputTargets(node.id, nodes, edges, true),
    outputFormat: outputFormatText(node.config),
    outputExample: outputExampleText(node.config),
    outputSchema: node.config.output_schema,
    examples: node.config.examples,
    messageTemplate: node.config.prompt_template,
  };
}
