import type { Edge } from 'reactflow';
import type { ExecutionResult, GraphNode } from '@/graph';
import type { GenerationRequest } from './generation';
import { inputSources, lastRunInputs, outputTargets, readFilePorts } from './generationContext';
import { outputFormatText } from './outputFormat';
import { readPair } from './examplePair';
import { NODE_BUILDERS } from '@/elements/registry';

/** A sample, and where it came from. */
interface Sample { values: Record<string, unknown>; origin: string }

/**
 * Before any run: what the nodes wired in hold without running -- a typed
 * text, a stored value. Only when every wired input has one: half a sample
 * would be tried on the code as if the other half were empty.
 *
 * A text naming a file, wired into an input that reads the file at its path,
 * is sent as that path on a port to read (`readFilePorts`): the engine reads
 * it the way a run reads a file before it shows the sample or tries code on
 * it -- so the node is written against that file's rows, not against a guess,
 * before the graph has ever run.
 */
function restingValues(node: GraphNode, nodes: GraphNode[], edges: Edge[]): Sample | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const values: Record<string, unknown> = {};
  const from = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== node.id || !edge.targetHandle) continue;
    const source = byId.get(edge.source);
    const element = source && NODE_BUILDERS[source.node_type];
    if (!element || !edge.sourceHandle) return undefined;
    const value = element.restingValue(source, edge.sourceHandle);
    if (value === undefined) return undefined;
    values[edge.targetHandle] = value;
    from.add(`"${source.label}"`);
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
 *     what comes in   each input: type, where from and what that node hands
 *                     on, and one sample
 *     what goes out   each output: where to and what the node there wants;
 *                     the format in words; the shape a run kept
 *     examples        the node's `examples.md`
 *
 * The sample is the node's example (step 1) when it has one: the engine reads
 * it from `examples` itself, so that what the example expects is checked too.
 * Without one, it is what arrived on the last run, and before any run what the
 * nodes wired in hold now.
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
  const element = NODE_BUILDERS[node.node_type];
  const inputs = node.inputs.map((port) => port.id);
  const whole = node.config.batch_mode === 'whole_list';
  const given = element?.exampleInput(node);
  const example = given && Object.keys(given).length ? given : undefined;
  // The engine reads a complete first pair from `examples.md` by itself, and
  // then also checks what it expects; any other example is sent as it is.
  const pair = readPair(node.config.examples);
  const read = !!example && pair.complete && JSON.stringify(pair.input) === JSON.stringify(example);
  const observed = lastRunInputs(node.id, executionResult);
  const sample: Sample | undefined = read ? undefined
    : example ? { values: example, origin: 'the example in step 1' }
      : observed ? { values: observed, origin: 'the last run' } : restingValues(node, nodes, edges);
  return {
    // All of them: the error port is the executor's, and the engine drops it
    // where a request comes in (`generate`).
    ports: { inputs, outputs: node.outputs.map((port) => port.id) },
    lists: {
      inputs: node.inputs.filter((port) => port.multi).map((port) => port.id),
      outputs: node.outputs.filter((port) => port.multi).map((port) => port.id),
    },
    sampleInputs: sample?.values,
    sampleOrigin: example ? 'the example in step 1' : sample?.origin,
    inputSources: inputSources(node.id, nodes, edges, true),
    readFilePorts: readFilePorts(node),
    // What a body is handed on each port: one item of a list input, unless the
    // node takes lists whole.
    inputTypes: Object.fromEntries(node.inputs.map((port) => {
      const base = port.data_type === 'list' ? 'any' : port.data_type;
      const list = port.data_type === 'list' || (port.multi && whole);
      return [port.id, list ? `list of ${base === 'any' ? 'values' : base}` : base];
    })),
    batchMode: node.inputs.some((port) => port.multi) ? (whole ? 'whole_list' : 'per_item') : undefined,
    // What the node's kind says about each port when it makes it.
    portNotes: {
      inputs: Object.fromEntries(node.inputs.map((port) => [port.id, port.description ?? ''])),
      outputs: Object.fromEntries(node.outputs.map((port) => [port.id, port.description ?? ''])),
    },
    outputTargets: outputTargets(node.id, nodes, edges, true),
    outputFormat: outputFormatText(node.config),
    outputSchema: node.config.output_schema,
    examples: node.config.examples,
    messageTemplate: node.config.prompt_template,
  };
}
