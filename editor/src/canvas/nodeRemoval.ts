import type { GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

/**
 * Whether *key*, pressed on the canvas, deletes what is selected there: Delete
 * and Backspace, while the canvas is the view on screen (*active*). Only a key
 * pressed *on* the canvas is asked about -- a node or the empty canvas clicked
 * last. A node's panel is open beside the canvas whenever a node is selected,
 * and a key pressed in it is the panel's; so is one pressed after a button in
 * it went away under the focus -- ✨ Fix, once it has fixed -- which hands the
 * key to the page, where Backspace deleted the node the panel was open on.
 */
export function deletes(key: string, active: boolean): boolean {
  return active && (key === 'Delete' || key === 'Backspace');
}

/**
 * What to ask before *nodes* go, or null when nothing goes with them that
 * Ctrl+Z is not the place to find out about: the blocks of a page -- every
 * block, every field, every heading, which to the canvas is one node like any
 * other -- and the *wires* into and out of them. One question, whichever way
 * they go: Delete on the canvas, or a card's ✕. A node with nothing on it and
 * nothing wired goes without a word: a confirmation for that is the kind of
 * prompt people learn to click through. Which blocks a node holds is the
 * element's to say (`NodeRunner.blocks`).
 */
export function removalQuestion(nodes: GraphNode[], wires: number): string | null {
  const blocks = nodes.reduce((sum, node) => sum + (engineRegistry.node(node.node_type)?.blocks(node).length ?? 0), 0);
  if (!blocks && !wires) return null;
  const counted = (count: number, what: string) => `${count} ${what}${count === 1 ? '' : 's'}`;
  const lost = [...(blocks ? [counted(blocks, 'block')] : []), ...(wires ? [counted(wires, 'connection')] : [])];
  const goes = blocks + wires === 1 ? 'goes' : 'go';
  if (nodes.length > 1) return `Delete ${nodes.length} nodes? Their ${lost.join(' and ')} ${goes} with them.`;
  return `Delete ${blocks ? 'the page' : `"${nodes[0].label}"`}? Its ${lost.join(' and ')} ${goes} with it.`;
}

/**
 * Delete nodes *nodeIds* and wires *wireIds* -- the nodes' own wires with
 * them -- once *confirm* said yes to what goes with them (`removalQuestion`):
 * one question, one undo step, and on a no nothing at all. ReactFlow took a
 * node's wires before it asked about the node, so a page kept on Cancel was
 * left with none, and a wired node cost two presses of Ctrl+Z.
 */
export function askToDelete(nodeIds: string[], wireIds: string[], confirm: (question: string) => boolean): void {
  const store = useGraphStore.getState();
  const going = new Set(nodeIds);
  const nodes = store.rfNodes.filter((node) => going.has(node.id)).map((node) => node.data.graphNode as GraphNode);
  if (!nodes.length && !wireIds.length) return;
  const wired = store.rfEdges.filter((edge) => going.has(edge.source) || going.has(edge.target)).length;
  const question = removalQuestion(nodes, wired);
  if (question && !confirm(question)) return;
  store.deleteNodes(nodes.map((node) => node.id), wireIds);
}

/** Delete what is selected on the canvas: its nodes, and the wires selected besides (`askToDelete`). */
export function deleteSelected(confirm: (question: string) => boolean): void {
  const { rfNodes, rfEdges } = useGraphStore.getState();
  askToDelete(
    rfNodes.filter((node) => node.selected).map((node) => node.id),
    rfEdges.filter((edge) => edge.selected).map((edge) => edge.id),
    confirm,
  );
}
