// What the bar under the canvas is on, where what is said there goes, and what
// a change of the whole graph would change -- the parts of the bar that are
// rules rather than drawing, so a test can hold them.

import type { Graph, GraphNode, Port } from '@/graph';
import { NODE_BUILDERS } from '@/elements/registry';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import { derivedNodePorts } from '@/document/guiWidgets';
import { savedNode } from '@/document/nodeKinds';
import { wireOf } from '@engine/project/flow.ts';

/** What the bar is on: the node whose panel is open -- or, with none, the whole graph (null). */
export function changeTarget(nodes: GraphNode[], openId: string | null): GraphNode | null {
  return nodes.find((node) => node.id === openId) ?? null;
}

/** The bar's "on: …", in words. */
export function targetName(target: GraphNode | null): string {
  return target ? target.label || target.id : 'the whole graph';
}

/**
 * Where a change said on *target* goes: to the node's panel, which changes the
 * body ✨ writes for it (`generation`) -- or to the graph, as a change of that
 * node, for a node whose settings are all it is: an input's text, a page's
 * blocks, an output's file. Those are the graph's to change, wires and all.
 */
export function changeGoesTo(target: GraphNode | null): 'panel' | 'graph' {
  return target && NODE_BUILDERS[target.node_type]?.generation ? 'panel' : 'graph';
}

/** What ✨ AI Graph is asked to do, for *text* said on *target*. */
export function graphRequest(target: GraphNode | null, text: string): string {
  return target ? `In the node "${target.label || target.id}" (id "${target.id}"): ${text}` : text;
}

/** What a change of the whole graph changes: nodes by id, and wires by what they join. */
export interface GraphChange {
  added: GraphNode[];
  removed: GraphNode[];
  /** Kept, and different in what they say or hold -- as the change has them. */
  changed: GraphNode[];
  wires: { added: number; removed: number };
}

/**
 * A node as far as a change of it matters to a person: its kind, its words,
 * its ports and the settings that are not their default. Not where it stands,
 * and not a default spelled out or left out -- a model asked to hand the graph
 * back writes some keys a file leaves out, and a node it did not touch is not
 * a node it changed.
 */
function said(node: GraphNode): string {
  const full = { ...node, config: { ...baseNodeConfig(), ...node.config } };
  const ports = derivedNodePorts(full) ?? full;
  const named = (list: Port[]) => list.map((port) => [port.id, port.name, port.data_type, !!port.multi]);
  return JSON.stringify([node.node_type, node.label, node.description ?? '', named(ports.inputs), named(ports.outputs), savedNode(full).config]);
}

/** What *after* changes of *before*: the nodes it adds, removes and changes, and how many wires come and go. */
export function graphChange(before: Graph, after: Graph): GraphChange {
  const was = new Map(before.nodes.map((node) => [node.id, node]));
  const now = new Set(after.nodes.map((node) => node.id));
  const wiresBefore = new Set(before.edges.map(wireOf));
  const wiresAfter = new Set(after.edges.map(wireOf));
  return {
    added: after.nodes.filter((node) => !was.has(node.id)),
    removed: before.nodes.filter((node) => !now.has(node.id)),
    changed: after.nodes.filter((node) => was.has(node.id) && said(was.get(node.id)!) !== said(node)),
    wires: {
      added: [...wiresAfter].filter((wire) => !wiresBefore.has(wire)).length,
      removed: [...wiresBefore].filter((wire) => !wiresAfter.has(wire)).length,
    },
  };
}

/** *change* in a line or two: what it adds, removes and changes -- or that it changes nothing. */
export function describeChange(change: GraphChange): string[] {
  const names = (nodes: GraphNode[]) => nodes.map((node) => node.label || node.id).join(', ');
  const { added, removed } = change.wires;
  const lines = [
    change.added.length ? `Adds ${names(change.added)}.` : '',
    change.removed.length ? `Removes ${names(change.removed)}.` : '',
    change.changed.length ? `Changes ${names(change.changed)}.` : '',
    added || removed ? `Wires: ${added} added, ${removed} removed.` : '',
  ].filter(Boolean);
  return lines.length ? lines : ['Nothing in the graph changes.'];
}
