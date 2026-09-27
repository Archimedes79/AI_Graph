// What the graph needs from a person before it can run.
//
// An input node set to ask, an output node set to ask where to write, a file
// picker on the page with nothing chosen yet. Each is a question with a key, so
// the same list serves a dialog in the editor, prompts on a terminal, and a
// `--inputs name=value` on a command line.
//
// The engine asks the elements rather than looking for node types itself; a new
// element that wants to prompt says so in its own file and nothing here changes.
// What only the wires say -- that a text asked for is a file to read -- is added here.

import type { Graph, GraphNode } from '../graph.ts';
import type { Runners } from '../elements/NodeRunner.ts';
import { filePorts } from './fileInputs.ts';

export interface RuntimeRequirement {
  /** `nodeId`, or `nodeId::widgetId` for a block inside a page. */
  key: string;
  label: string;
  kind: 'text' | 'file' | 'directory';
  /** Reading it or writing it — the difference between "which file" and "where". */
  direction: 'input' | 'output';
  /** What it holds now, offered as the default. */
  current: string;
}

export function runtimeRequirements(graph: Graph, registry: Runners): RuntimeRequirement[] {
  const asked: RuntimeRequirement[] = [];
  for (const node of graph.nodes) {
    const element = registry.node(node.node_type);
    if (!element) continue;
    for (const requirement of element.runtimeRequirements(node)) {
      asked.push(requirement.kind === 'text' && readAsFile(graph, node.id, registry) ? { ...requirement, kind: 'file' } : requirement);
    }
  }
  return asked;
}

/**
 * Whether what *nodeId* hands on is the path of a file to read: it is wired
 * into an input the node there reads the file at (`filePorts`, of an element
 * that `readsFileInputs`). A text asked for when the run starts is then asked
 * for as a file, with the file browser -- a text input is the one way left to
 * name a file from outside a page, and it was asked for in a bare text box.
 * Only the graph knows the wire, so it is asked here and not of the element.
 */
function readAsFile(graph: Graph, nodeId: string, registry: Runners): boolean {
  return graph.edges.some((edge) => {
    if (edge.source_node_id !== nodeId) return false;
    const target = graph.nodes.find((node) => node.id === edge.target_node_id);
    return !!target && !!registry.node(target.node_type)?.readsFileInputs && filePorts(target).includes(edge.target_port_id);
  });
}

/**
 * Write the answers back into the graph.
 *
 * A key of `nodeId::widgetId` reaches a block inside a page; a plain node id
 * reaches the node. The element decides where the value lands, because only it
 * knows what it stores — the same reason it decides what it remembers.
 *
 * Returns the ids of the nodes it wrote into, for a caller that keeps the
 * answers beyond this run: the key is read here and nowhere else.
 */
export function applyRuntimeValues(
  graph: Graph,
  values: Record<string, string>,
  registry: Runners,
): Set<string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const answered = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    const [nodeId, widgetId] = key.split('::');
    const node = byId.get(nodeId);
    if (!node) continue;
    registry.node(node.node_type)?.applyRuntimeValue(node, widgetId ?? null, value);
    answered.add(nodeId);
  }
  return answered;
}

/** The default an unanswered question falls back to. */
export function withDefaults(
  asked: RuntimeRequirement[],
  answers: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = { ...answers };
  for (const requirement of asked) {
    if (!resolved[requirement.key]) resolved[requirement.key] = requirement.current;
  }
  return resolved;
}

export type { GraphNode };
