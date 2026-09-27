import type { ExecutionResult, GraphNode, Wire } from '@/graph';
// This module reads the element registry, so no element's `…GuiBuilder.ts` may import
// it: that would be a cycle through the registry (see `outputFormat.ts`).
import { NODE_BUILDERS } from '@/elements/registry';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { filePorts } from '@engine/execution/fileInputs.ts';

/**
 * What the ✨ Generate buttons tell the AI about the world around a node.
 *
 * A node's own description says what the user wants; these say what the node is
 * actually wired to and what really flowed through it. Without them a model has
 * to guess the shape of its inputs, and a small local model guesses badly.
 *
 * They are facts, not sentences: which node feeds each input and what it hands
 * on (`inputSources`), where each output goes and what the node there wants
 * (`outputTargets`), what arrived on the last run (`lastRunInputs`). The
 * engine's brief (`engine/src/host/editor/brief.ts`) is the one place they are
 * put into words, for a body, a system prompt and a data node's format alike.
 * They used to reach a data node's and a file selector's ✨ a second time, as
 * sentences written here, beside the brief.
 */

/**
 * What a node emits, in one line.
 *
 * This was a `switch (node.node_type)` -- the last one in shared editor code.
 * Each element answers for itself now (`NodeGuiBuilder.describeOutput`),
 * so a new node type describes its output in its own file and nothing here
 * changes.
 */
export function describeNodeOutput(node: GraphNode): string {
  return NODE_BUILDERS[node.node_type]?.describeOutput(node) ?? '';
}

/**
 * The input ports a running node is handed a file's text on: the ones step 1
 * ticks "Read the file at this path", of a kind that reads its files -- the
 * engine's own rule (`fileInputs.ts#filePorts`), asked of its element, so the
 * two cannot disagree on which.
 *
 * A sample holds what came off the wire -- the path. The server reads these
 * before it shows the sample to the model or tries the code on it, as a run
 * does. And a file picked or dropped as step 1's example for one of them is
 * kept as its path, which is what a run hands the node there.
 */
export function readFilePorts(node: GraphNode): string[] {
  return engineRegistry.node(node.node_type)?.readsFileInputs ? filePorts(node) : [];
}

/**
 * The raw values this node's input ports received on the last run: shown to
 * the model as the sample, and what the server runs the generated function
 * against, repairing the code if it fails (see
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
 * Which node, and which of its ports, feeds each of *nodeId*'s input ports.
 *
 * The wiring is the one thing a generation request cannot otherwise carry, and
 * it is what turns a skeleton line from `files: list[str]` into
 * `files: list[str]  // from "Folder" (port "Files")` — provenance, which no
 * type expresses. The port matters as much as the node: an Input in file mode
 * offers both the file's content and its path, and code written against the
 * wrong one reads a CSV as a file name.
 *
 * A port fed by several nodes (fan-in) names them all: that a value is a list
 * *because two nodes write into it* is exactly the case generated code gets
 * wrong when it assumes a scalar.
 *
 * *withEmits*, for ✨: each source followed by what that node says it hands
 * on, so the model is told the wire and the declaration behind it in one line.
 */
export function inputSources(
  nodeId: string,
  nodes: GraphNode[],
  edges: Wire[],
  withEmits = false,
): Record<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byPort: Record<string, string[]> = {};
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const source = byId.get(edge.source);
    if (!source) continue;
    const port = source.outputs.find((p) => p.id === edge.sourceHandle);
    let said = port ? `"${source.label}" (port "${port.name}")` : `"${source.label}"`;
    // The port's own words first, then what the node declares of its output.
    const emits = withEmits
      ? [...new Set([port?.description?.trim(), describeNodeOutput(source)].filter(Boolean))].join('; ')
      : '';
    if (emits) said += `, which hands on: ${emits}`;
    (byPort[edge.targetHandle ?? 'input'] ??= []).push(said);
  }
  return Object.fromEntries(
    Object.entries(byPort).map(([port, origins]) => [port, [...new Set(origins)].join(' + ')]),
  );
}

/**
 * Where each of *nodeId*'s output ports goes, by port id: `"Chart" (port
 * "Points")`. The other half of `inputSources`, for the dialog: a port says
 * what it is connected to, so "how does this reach that" is answered where the
 * port is named rather than by squinting at the canvas.
 */
export function outputTargets(
  nodeId: string,
  nodes: GraphNode[],
  edges: Wire[],
  withWants = false,
): Record<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byPort: Record<string, string[]> = {};
  for (const edge of edges) {
    if (edge.source !== nodeId) continue;
    const target = byId.get(edge.target);
    if (!target) continue;
    const port = target.inputs.find((p) => p.id === edge.targetHandle)?.name;
    let said = port ? `"${target.label}" (port "${port}")` : `"${target.label}"`;
    // For ✨: what the node there wants, said by that node (a chart: points).
    const wants = withWants && edge.targetHandle ? NODE_BUILDERS[target.node_type]?.wantsOn(target, edge.targetHandle) : undefined;
    if (wants) said += `, which wants ${wants}`;
    (byPort[edge.sourceHandle ?? 'output'] ??= []).push(said);
  }
  return Object.fromEntries(
    Object.entries(byPort).map(([port, targets]) => [port, [...new Set(targets)].join(' + ')]),
  );
}
