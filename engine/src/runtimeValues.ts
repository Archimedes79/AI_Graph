// What the graph needs from a person before it can run.
//
// An input node set to ask, an output node set to ask where to write, a file
// picker on the page with nothing chosen yet. Each is a question with a key, so
// the same list serves a dialog in the editor, prompts on a terminal, and a
// `--inputs name=value` on a command line.
//
// The engine asks the elements rather than looking for node types itself; a new
// element that wants to prompt says so in its own file and nothing here changes.

import type { Graph, GraphNode } from './graph.js';
import type { NodeElement } from './element.js';

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

export interface Registry {
  node(type: string): NodeElement<unknown> | undefined;
}

export function runtimeRequirements(graph: Graph, registry: Registry): RuntimeRequirement[] {
  const asked: RuntimeRequirement[] = [];
  for (const node of graph.nodes) {
    const element = registry.node(node.node_type);
    if (!element) continue;
    asked.push(...element.runtimeRequirements(node));
  }
  return asked;
}

/**
 * Write the answers back into the graph.
 *
 * A key of `nodeId::widgetId` reaches a block inside a page; a plain node id
 * reaches the node. The element decides where the value lands, because only it
 * knows what it stores — the same reason it decides what it remembers.
 */
export function applyRuntimeValues(
  graph: Graph,
  values: Record<string, string>,
  registry: Registry,
): void {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const [key, value] of Object.entries(values)) {
    const [nodeId, widgetId] = key.split('::');
    const node = byId.get(nodeId);
    if (!node) continue;
    registry.node(node.node_type)?.applyRuntimeValue(node, widgetId ?? null, value);
  }
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
