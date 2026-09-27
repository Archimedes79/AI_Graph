// Which port became which, across an edit of a node's ports.
//
// A port's id is the name a body reads it by -- `inputs.csv`, `{ figure }` --
// so it is the field the ports editor edits, and it is also what a wire points
// at. When the node dialog writes a change, `updateNode` has to be told which
// id each port had before, or a renamed port loses its wires to the pruning.
//
// That used to be worked out by position: row 2 before is row 2 now. It is
// true of a rename and false of a removal. Remove the first of `prompt` and
// `context` and `context` slides into row 1, so it read as "prompt was renamed
// to context" and the removed port's wire moved onto `context`, which then had
// two -- the ✕ that promises "remove this port, and any wire on it" handed the
// wire to its neighbour instead.
//
// So each port carries the id it has in the graph (`trackPorts`, which the
// dialog puts on the node as stored), and a port is followed by that, not by
// where it stands. It is kept under a symbol: an edit
// that spreads a port (`{ ...port, id }`, which is how the ports editor renames
// one) carries it along, and JSON never sees it, so the draft still compares
// equal to the stored node and nothing of it is ever saved.
import type { GraphNode, Port } from '@/graph';

const WAS = Symbol('the id this port had when its node was opened for editing');
/**
 * Which port this is, through every rename while its node is open -- given to
 * a port added there too, which has no id from before (`renamedPorts`).
 */
const SAME = Symbol('which port this is while its node is open for editing');

type Tracked = Port & { [WAS]?: string; [SAME]?: symbol };

/**
 * For each side, the old id of every port that is now called something else,
 * and `null` for every port that is gone: its wires go with it, even when
 * another port has since been given its name.
 */
export interface PortRenames {
  inputs: Record<string, string | null>;
  outputs: Record<string, string | null>;
}

/** *node* with every port remembering the id it has now, to be edited from here. */
export function trackPorts(node: GraphNode): GraphNode {
  const mark = (port: Port): Tracked => ({ ...port, [WAS]: port.id, [SAME]: Symbol(port.id) });
  return { ...node, inputs: node.inputs.map(mark), outputs: node.outputs.map(mark) };
}

/** *node* as it is stored: its ports without what `trackPorts` put on them. */
export function untracked(node: GraphNode): GraphNode {
  const plain = (port: Tracked): Port => {
    const copy = { ...port };
    delete copy[WAS];
    delete copy[SAME];
    return copy;
  };
  return { ...node, inputs: node.inputs.map(plain), outputs: node.outputs.map(plain) };
}

/**
 * What became of each port of *before* in *after*, for `updateNode`.
 *
 * A port that went through the ports editor says which one it was. One that
 * did not -- added with "+", or put there by the element because a setting
 * changed (a page's blocks, an input's mode, "catch failures") -- is the port
 * of its name, if there was one and no edited port already says it is that one.
 */
export function portRenames(before: GraphNode | undefined, after: GraphNode): PortRenames {
  const side = (was: Port[] = [], now: Tracked[]): Record<string, string | null> => {
    const had = new Set(was.map((port) => port.id));
    const claimed = new Set(now.map((port) => port[WAS]).filter((id): id is string => !!id && had.has(id)));
    const origin = (port: Tracked): string | undefined => {
      const said = port[WAS];
      if (said !== undefined) return had.has(said) ? said : undefined;
      return had.has(port.id) && !claimed.has(port.id) ? port.id : undefined;
    };

    const fate: Record<string, string | null> = {};
    const kept = new Set<string>();
    for (const port of now) {
      const from = origin(port);
      if (from === undefined) continue;
      kept.add(from);
      if (from !== port.id) fate[from] = port.id;
    }
    for (const id of had) if (!kept.has(id)) fate[id] = null;
    return fate;
  };
  return { inputs: side(before?.inputs, after.inputs), outputs: side(before?.outputs, after.outputs) };
}

/**
 * *after* -- *before* with its ports edited once, in the ports editor -- with
 * every port new to it known from here on, and what became of the name of
 * each port of *before*: for what is keyed by a port's name rather than wired
 * to it, the keys of its input.js and output.js (`definitionPorts.ts`).
 *
 * `portRenames` answers the same question from the node as it is stored, for
 * the wires, when the dialog writes; this answers it edit by edit, so the
 * definitions ▶ Try and ✨ read say the name the port has now. A name
 * another port still has belongs to that port, and has no fate here.
 */
export function renamedPorts(before: GraphNode, after: GraphNode): { node: GraphNode; names: PortRenames } {
  const known = (ports: Tracked[]): Tracked[] => ports.map((port) => (port[SAME] ? port : { ...port, [SAME]: Symbol(port.id) }));
  const node = { ...after, inputs: known(after.inputs), outputs: known(after.outputs) };
  const side = (was: Tracked[], now: Tracked[]): Record<string, string | null> => {
    const fate: Record<string, string | null> = {};
    for (const port of was) {
      if (now.some((candidate) => candidate.id === port.id)) continue;
      const same = port[SAME] && now.find((candidate) => candidate[SAME] === port[SAME]);
      fate[port.id] = same ? same.id : null;
    }
    return fate;
  };
  return { node, names: { inputs: side(before.inputs, node.inputs), outputs: side(before.outputs, node.outputs) } };
}
