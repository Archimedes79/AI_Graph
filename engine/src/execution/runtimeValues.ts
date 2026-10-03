// What the graph needs from a person before it can run.
//
// An input node set to ask, an output node set to ask where to write, a file
// picker on the page with nothing chosen yet. Each is a question under the
// name of the value that answers it (`graphInterface.ts`), so the same list
// serves a dialog in the editor, prompts on a terminal, a `--inputs
// name=value` on a command line, and a frontend that sends values.
//
// The engine asks the elements rather than looking for node types itself; a new
// element that wants to prompt says so in its own file and nothing here changes.
// What only the wires say -- that a text asked for is a file to read -- is added here.

import type { Graph } from '../graph.ts';
import type { Runners } from '../elements/NodeRunner.ts';
import { filePorts } from './fileInputs.ts';

export interface RuntimeRequirement {
  /** The name the answer is given under: the value the node or block offers (`graphInterface.ts`). */
  key: string;
  label: string;
  kind: 'text' | 'file' | 'directory';
  /** Reading it or writing it — the difference between "which file" and "where". */
  direction: 'input' | 'output';
  /** What it holds now, offered as the default. */
  current: string;
  /**
   * The outputs the answer leaves its node by, where it is one of several --
   * a block's, on a page of many: a round that uses none of them does not ask.
   */
  ports?: string[];
}

/**
 * What *graph* asks before a run -- of everything, or, given *only*, the nodes
 * one event runs (`triggeredNodes`): pressing "Plot" does not ask for the file
 * only "Summarize" reads. A block's question counts where what it answers is
 * wired into a node that runs.
 */
export function runtimeRequirements(graph: Graph, registry: Runners, only: Set<string> | null = null): RuntimeRequirement[] {
  const asked: RuntimeRequirement[] = [];
  const used = (nodeId: string, requirement: RuntimeRequirement): boolean => {
    if (!only) return true;
    if (!requirement.ports) return only.has(nodeId);
    return graph.edges.some((edge) => edge.source_node_id === nodeId && requirement.ports!.includes(edge.source_port_id)
      && edge.target_node_id !== nodeId && only.has(edge.target_node_id));
  };
  for (const node of graph.nodes) {
    const element = registry.node(node.node_type);
    if (!element) continue;
    for (const requirement of element.runtimeRequirements(node)) {
      if (!used(node.id, requirement)) continue;
      asked.push(requirement.kind === 'text' && readAsFile(graph, node.id, registry) ? { ...requirement, kind: 'file' } : requirement);
    }
  }
  return asked;
}

/**
 * Whether what *nodeId* hands on is the path of a file to read: it is wired
 * into an input the node there reads the file at (`filePorts`). A text asked
 * for when the run starts is then asked
 * for as a file, with the file browser -- a text input is the one way left to
 * name a file from outside a page, and it was asked for in a bare text box.
 * Only the graph knows the wire, so it is asked here and not of the element.
 */
function readAsFile(graph: Graph, nodeId: string, registry: Runners): boolean {
  return graph.edges.some((edge) => {
    if (edge.source_node_id !== nodeId) return false;
    const target = graph.nodes.find((node) => node.id === edge.target_node_id);
    return !!target && filePorts(target, registry).includes(edge.target_port_id);
  });
}

/** The default an unanswered question falls back to. The answers are values by name, written by `applyValues`. */
export function withDefaults(
  asked: RuntimeRequirement[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...answers };
  for (const requirement of asked) {
    if (!resolved[requirement.key]) resolved[requirement.key] = requirement.current;
  }
  return resolved;
}
