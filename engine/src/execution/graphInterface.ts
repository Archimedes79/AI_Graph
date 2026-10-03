// What a graph offers whoever uses it from outside, under names.
//
// A page, a script, a model over MCP, a frontend somebody wrote: each starts a
// round with an event and values, and reads back what it produced -- by name,
// never by node or port. Which names there are is the elements' to say
// (`NodeRunner.offers`): a block on the page by its id, an input, output or
// trigger node by its own. A graph inside a node meets the graph above it the
// same way, through its input and output nodes (`subgraph/boundary.ts`).
//
// Not to be mistaken for `interface.ts`, which is the shape of what one node
// hands on. This is the graph's own: what goes into all of it, and what comes
// out.

import type { DataType, ExecutionResult, Graph, GraphNode } from '../graph.ts';
import type { Runners } from '../elements/NodeRunner.ts';
import type { Trigger } from './triggers.ts';
import { names, type Problem } from './wiring.ts';

export type OfferKind = 'event' | 'value' | 'output';

/** One thing a node offers whoever uses the graph from outside. */
export interface Offer {
  kind: OfferKind;
  /** What a caller calls it: a block by its id, any other node by its own. */
  name: string;
  /** What a person reads: the block's or the node's label. */
  label: string;
  type: DataType;
  /** A list of them. */
  list?: boolean;
  description?: string;
  /** Which of the node's own it is: a block's id, or null for the node itself. */
  key: string | null;
  /** An event's: the port it fires on. */
  port?: string;
}

/** One name, as a caller is told it: no node, no port. */
export interface InterfaceEntry {
  name: string;
  label: string;
  type: DataType;
  list?: boolean;
  description?: string;
}

/** What a graph offers: what starts a round, what a round can be given, and what it hands back. */
export interface GraphInterface {
  events: InterfaceEntry[];
  values: InterfaceEntry[];
  outputs: InterfaceEntry[];
}

/** A name the graph does not offer, asked for by a caller: the caller's mistake, said as one. */
export class NotOffered extends Error {}

interface Offered {
  node: GraphNode;
  offer: Offer;
}

const KINDS: readonly OfferKind[] = ['event', 'value', 'output'];

/** Every offer of *graph*, by kind and name; under a name two nodes offer, the first (`interfaceProblems`). */
function offered(graph: Graph, registry: Runners): Record<OfferKind, Map<string, Offered>> {
  const found: Record<OfferKind, Map<string, Offered>> = { event: new Map(), value: new Map(), output: new Map() };
  for (const node of graph.nodes) {
    for (const offer of registry.node(node.node_type)?.offers(node) ?? []) {
      if (!found[offer.kind].has(offer.name)) found[offer.kind].set(offer.name, { node, offer });
    }
  }
  return found;
}

const entry = ({ name, label, type, list, description }: Offer): InterfaceEntry => ({
  name, label, type, ...(list ? { list } : {}), ...(description ? { description } : {}),
});

/** What *graph* offers, as a caller is told it. */
export function interfaceOf(graph: Graph, registry: Runners): GraphInterface {
  const found = offered(graph, registry);
  const listed = (kind: OfferKind): InterfaceEntry[] => [...found[kind].values()].map(({ offer }) => entry(offer));
  return { events: listed('event'), values: listed('value'), outputs: listed('output') };
}

/** The round the event *name* starts, as the executor is handed it -- none, for the whole graph. */
export function eventOf(graph: Graph, name: string | null | undefined, registry: Runners): Trigger | null {
  if (!name) return null;
  const events = offered(graph, registry).event;
  const found = events.get(name);
  if (!found) throw new NotOffered(`No event called "${name}": this graph starts on ${names(events.keys())}.`);
  return { node_id: found.node.id, port_id: found.offer.port ?? null };
}

/** Refuse *values* if the graph takes one of them under no such name -- before anything is written. */
export function checkValues(graph: Graph, values: Record<string, unknown>, registry: Runners): void {
  const taken = offered(graph, registry).value;
  const unknown = Object.keys(values).filter((name) => !taken.has(name));
  if (unknown.length) {
    throw new NotOffered(`No value called ${names(unknown)}: this graph takes ${names(taken.keys())}.`);
  }
}

/**
 * Put *values* where the nodes that take them keep them, in *graph* -- each
 * element decides where (`NodeRunner.setValue`). A name it does not take is
 * refused before anything is written.
 */
export function applyValues(graph: Graph, values: Record<string, unknown>, registry: Runners): void {
  checkValues(graph, values, registry);
  const taken = offered(graph, registry).value;
  for (const [name, value] of Object.entries(values)) {
    const { node, offer } = taken.get(name)!;
    registry.node(node.node_type)?.setValue(node, offer.key, value);
  }
}

/** What each value *graph* takes holds in it now, by name. */
export function valuesOf(graph: Graph, registry: Runners): Record<string, unknown> {
  return Object.fromEntries([...offered(graph, registry).value].map(([name, { node, offer }]) => (
    [name, registry.node(node.node_type)?.value(node, offer.key) ?? null]
  )));
}

/** What *result* hands back, by name: each output whose node is in it. */
export function outputsOf(graph: Graph, result: ExecutionResult | null, registry: Runners): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  if (!result) return outputs;
  const ran = new Map(result.node_results.map((one) => [one.node_id, one]));
  for (const [name, { node, offer }] of offered(graph, registry).output) {
    const own = ran.get(node.id);
    const shown = own ? registry.node(node.node_type)?.shows(node, own, offer.key) : undefined;
    if (shown !== undefined) outputs[name] = shown;
  }
  return outputs;
}

/**
 * A name two nodes share in one kind: only the first is ever reached. Two
 * blocks of one id on one page are the page's to name (`NodeRunner.problems`).
 */
export function interfaceProblems(graph: Graph, registry: Runners): Problem[] {
  const problems: Problem[] = [];
  for (const kind of KINDS) {
    const first = new Map<string, { node: string; where: string }>();
    for (const node of graph.nodes) {
      for (const offer of registry.node(node.node_type)?.offers(node) ?? []) {
        if (offer.kind !== kind) continue;
        const where = offer.key ? `block "${offer.key}" on "${node.id}"` : `node "${node.id}"`;
        const owner = first.get(offer.name);
        if (!owner) first.set(offer.name, { node: node.id, where });
        else if (owner.node !== node.id) {
          const called = kind === 'event' ? 'an event' : `a ${kind}`;
          problems.push({
            where,
            problem: `It offers the ${kind} "${offer.name}", which ${owner.where} offers already: a caller only ever reaches that one.`,
            fix: `Give it an id of its own: whatever uses the graph from outside calls ${called} by its id.`,
          });
        }
      }
    }
  }
  return problems;
}
