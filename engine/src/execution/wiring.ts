// Whether a graph's wiring holds together: every node its own id, every edge
// between two nodes that exist, on ports those nodes have.
//
// Asked by two readers, and they want different amounts. `check` lists all of
// it, a mistyped port included -- the ports are what a person reads to see what
// a node takes, and one that is not there is wrong however well the run goes.
//
// A run refuses to start on `fatalProblems` only, which is the shorter list on
// purpose. Values travel along edges and are keyed by the edge's port, not by
// what a node declared, so a graph written by hand with no ports declared runs
// correctly and must keep running. What is fatal is an edge to a node that is
// not there, which can only ever deliver nothing, and two nodes sharing an id,
// which used to be reported as a cycle.

import type { Graph, GraphNode } from '../graph.ts';
import type { Registry } from './executor.ts';
import { RUN_PORT } from './triggers.ts';

/** One thing to fix: where it is, what it is, and what to do about it. */
export interface Problem {
  where: string;
  problem: string;
  fix: string;
}

export const names = (ids: Iterable<string>): string => [...ids].map((id) => `"${id}"`).join(', ') || '(none)';

/**
 * The output a node that catches its own failure grows: empty on success, the
 * reason otherwise. See `failureOutputs` in the executor.
 */
export const ERROR_PORT = 'error';

/** The ports *node* really has -- derived where the engine derives them, declared where a person names them. */
export function portsOf(node: GraphNode, registry: Registry): { inputs: Set<string>; outputs: Set<string>; derived: boolean } {
  const element = registry.node(node.node_type);
  let derived: ReturnType<NonNullable<typeof element>['derivedPorts']> = null;
  try {
    derived = element?.derivedPorts(node) ?? null;
  } catch {
    // Settings too broken to derive from. The declared ports are the best guess left.
  }
  const ids = (ports: unknown): string[] => (Array.isArray(ports) ? ports : [])
    .map((port) => (port as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === 'string');

  const inputs = new Set(ids(derived ? derived.inputs : node.inputs));
  const outputs = new Set(ids(derived ? derived.outputs : node.outputs));
  // The input every node has and none declares.
  inputs.add(RUN_PORT);
  if (element?.catchesErrors(node)) outputs.add(ERROR_PORT);
  return { inputs, outputs, derived: derived !== null };
}

/** Two nodes with one id, and edges that end nowhere: what a run cannot go ahead with. */
export function fatalProblems(graph: Graph): Problem[] {
  const problems: Problem[] = [];

  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const node of graph.nodes) (seen.has(node.id) ? duplicated : seen).add(node.id);
  for (const id of duplicated) {
    problems.push({
      where: `node "${id}"`,
      problem: 'More than one node has this id.',
      fix: 'Give every node its own id, and point each edge at the one it means.',
    });
  }

  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    for (const end of ['source', 'target'] as const) {
      const nodeId = end === 'source' ? edge.source_node_id : edge.target_node_id;
      if (ids.has(nodeId)) continue;
      problems.push({
        where: `edge "${edge.id}"`,
        problem: `Its ${end} is node "${nodeId}", and there is no such node.`,
        fix: `Point it at one of: ${names(ids)} -- or add the node.`,
      });
    }
  }
  return problems;
}

/** Everything `fatalProblems` finds, and the ports besides. */
export function wiringProblems(graph: Graph, registry: Registry): Problem[] {
  const problems = fatalProblems(graph);

  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  for (const edge of graph.edges) {
    for (const end of ['source', 'target'] as const) {
      const nodeId = end === 'source' ? edge.source_node_id : edge.target_node_id;
      const portId = end === 'source' ? edge.source_port_id : edge.target_port_id;
      const where = `edge "${edge.id}"`;
      const node = byId.get(nodeId);
      // Reported already, and an unknown node type has no ports to be wrong about.
      if (!node || !registry.node(node.node_type)) continue;
      const ports = portsOf(node, registry);
      const side = end === 'source' ? ports.outputs : ports.inputs;
      if (side.has(portId)) continue;
      const kind = end === 'source' ? 'output' : 'input';
      const listed = names([...side].filter((id) => id !== RUN_PORT));
      problems.push({
        where,
        problem: `Its ${end} port "${portId}" is not an ${kind} of node "${nodeId}".`,
        fix: ports.derived
          ? `The ports of a${node.node_type === 'input' ? 'n' : ''} ${node.node_type} node are derived from its settings, not from what the document declares. `
            + `Its ${kind}s are: ${listed}. Wire to one of those, or change the settings that produce them.`
          : `Its ${kind}s are: ${listed}. Wire to one of those, or declare "${portId}" in the node's ${kind}s.`,
      });
    }
  }
  return problems;
}

/** *problems* as one message, for a run that will not start. */
export function unrunnable(problems: Problem[]): string {
  return ['The graph cannot run:', ...problems.map((p) => `- ${p.where}: ${p.problem} ${p.fix}`)].join('\n');
}
