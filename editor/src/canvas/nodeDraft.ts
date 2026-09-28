import type { GraphNode, Port } from '@/graph';
import { derivedNodePorts } from '@/document/guiWidgets';
import { useGraphStore } from '@/store/graphStore';
import { portRenames, renamedPorts, untracked } from '@/store/portRenames';
import { definitionFollowingPorts } from '@/authoring/definitionPorts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { ERROR_PORT, errorOutput } from '@engine/execution/wiring.ts';

/** What the output a node grows when it is told to catch its own failures says it is. */
const CAUGHT = 'Why this node failed. Optional to wire: unwired, the run simply carries on.';

/**
 * The node panel's *draft* with its setting *key* set to *value*, and its
 * ports following the setting where they are derived from it.
 *
 * *value* may be a function of the setting as *draft* holds it: a change that
 * lands after a wait is made to what is there by then (`NodePanelProps.setConfig`).
 */
export function withSetting(draft: GraphNode, key: string, value: unknown): GraphNode {
  const settled = typeof value === 'function'
    ? (value as (current: unknown) => unknown)((draft.config as Record<string, unknown>)[key])
    : value;
  const next = { ...draft, config: { ...draft.config, [key]: settled } };
  // A setting an element derives its ports from has just changed, so the
  // ports follow it here and now. They used to follow only on the next
  // load, which is why ticking "catch failures" on an input node grew its
  // error port sometime later, to a person who had gone looking for it.
  // A derived port is the port of its name, or new: the write keeps the
  // wires of the one and lets those of a port that is gone go (`portRenames`).
  const derived = derivedNodePorts(next);
  if (derived) return { ...next, ...derived };
  // Ticking "catch failures" is what puts the port on the node. Nobody
  // should have to add an output by hand and guess that it must be called
  // `error` for the executor to fill it. Which setting that is, the element
  // says (`catchesErrors`), and the port is touched only when its answer turns.
  const element = engineRegistry.node(draft.node_type);
  const catches = element?.catchesErrors(next) ?? false;
  if (element && catches !== element.catchesErrors(draft)) {
    const without = next.outputs.filter((port) => port.id !== ERROR_PORT);
    next.outputs = catches ? [...without, errorOutput(CAUGHT)] : without;
  }
  return next;
}

/**
 * The node panel's *draft* with the ports edited in the ports editor, and its
 * definitions keyed by the names the ports have now.
 *
 * A definition is keyed by port. A port renamed or removed carried its wire
 * along (`portRenames`), but its key stayed under the old name: ▶ Try ran the
 * body with the value where it no longer looks, and `check` said the
 * definition names an input the node does not have. Each edit carries the keys
 * along with the port it renames, or takes them away with the port it removes
 * (`definitionFollowingPorts`).
 */
export function withPorts(draft: GraphNode, ports: { inputs: Port[]; outputs: Port[] }): GraphNode {
  const { node, names } = renamedPorts(draft, { ...draft, ...ports });
  const input = definitionFollowingPorts(String(draft.config.input_definition ?? ''), names.inputs);
  const output = definitionFollowingPorts(String(draft.config.output_definition ?? ''), names.outputs);
  if (input === String(draft.config.input_definition ?? '') && output === String(draft.config.output_definition ?? '')) return node;
  return { ...node, config: { ...node.config, input_definition: input, output_definition: output } };
}

/**
 * What the node panel writes: *draft* into the store as node *nodeId*, its
 * wires following its ports. *before* is the node as the store holds it;
 * *coalesce* names the change, so the change of the same fields just before
 * it takes the same undo step (`graphStore.commit`).
 *
 * A port's id is the name a body reads it by, so it is edited in the panel --
 * and an edge points at the old one. Each port of the draft remembers the id it
 * had in *before* (`trackPorts`), so a renamed port takes its wires along and a
 * removed one takes them away. It used to be worked out by position, which read
 * removing a port as renaming it to the one that slid into its row, and handed
 * that port the removed one's wire.
 *
 * A function rather than a few lines inside the panel, so a test writes a
 * panel's change the way the panel does (`nodePanel.write`).
 */
export function saveDraft(nodeId: string, before: GraphNode | undefined, draft: GraphNode, coalesce?: string): void {
  useGraphStore.getState().updateNode(nodeId, untracked(draft), portRenames(before, draft), coalesce);
}
