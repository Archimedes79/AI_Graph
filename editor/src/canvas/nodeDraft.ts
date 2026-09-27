import type { GraphNode, Port } from '@/graph';
import { derivedNodePorts } from '@/document/guiWidgets';
import { NODE_BUILDERS } from '@/elements/registry';
import { useGraphStore } from '@/store/graphStore';
import { portRenames, renamedPorts, untracked } from '@/store/portRenames';
import { examplesFollowPorts } from '@/authoring/examplePair';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { ERROR_PORT, errorOutput } from '@engine/execution/wiring.ts';

/** What the output a node grows when it is told to catch its own failures says it is. */
const CAUGHT = 'Why this node failed. Optional to wire: unwired, the run simply carries on.';

/**
 * The node dialog's *draft* with its setting *key* set to *value*, and its
 * ports following the setting where they are derived from it.
 *
 * *value* may be a function of the setting as *draft* holds it: a change that
 * lands after a wait is made to what is there by then (`NodePanelProps.setConfig`).
 *
 * *stored* is the node as the store holds it, whose ports the wires are on.
 * Which new port carries on an old one is asked against it rather than the
 * draft: a person stepping through a mode select passes modes that have no
 * such port (text, then a folder, then one file), and asked against the
 * draft, the step through the folder forgot which port the wire was on.
 */
export function withSetting(draft: GraphNode, stored: GraphNode | undefined, key: string, value: unknown): GraphNode {
  const settled = typeof value === 'function'
    ? (value as (current: unknown) => unknown)((draft.config as Record<string, unknown>)[key])
    : value;
  const next = { ...draft, config: { ...draft.config, [key]: settled } };
  // A setting an element derives its ports from has just changed, so the
  // ports follow it here and now. They used to follow only on the next
  // load, which is why ticking "catch failures" on an input node grew its
  // error port sometime later, to a person who had gone looking for it.
  // A derived port that carries on an old one's work takes its wires,
  // where the element says so (`continuePorts`).
  const derived = derivedNodePorts(next);
  if (derived) return NODE_BUILDERS[draft.node_type].continuePorts(stored ?? draft, { ...next, ...derived });
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
 * The node dialog's *draft* with the ports edited in the ports editor, and its
 * examples keyed by the names the ports have now.
 *
 * An example is an object keyed by input port. A port renamed or removed in
 * step 1 carried its wire along (`portRenames`), but its value stayed under
 * the old name: Try it and ✨ ran the body with the value where it no longer
 * looks, and after Save `check` said the example gives an input the node does
 * not have. Each edit carries the keys along with the port it renames, or takes
 * them away with the port it removes.
 */
export function withPorts(draft: GraphNode, ports: { inputs: Port[]; outputs: Port[] }): GraphNode {
  const { node, names } = renamedPorts(draft, { ...draft, ...ports });
  const examples = draft.config.examples;
  if (typeof examples !== 'string') return node;
  const followed = examplesFollowPorts(examples, names);
  return followed === examples ? node : { ...node, config: { ...node.config, examples: followed } };
}

/**
 * The node dialog's Save: *draft* into the store as node *nodeId*, its wires
 * following its ports. *before* is the node as the store holds it.
 *
 * A port's id is the name a body reads it by, so it is edited in the dialog --
 * and an edge points at the old one. Each port of the draft remembers the id it
 * had when the dialog opened (`trackPorts`), so a renamed port takes its wires
 * along and a removed one takes them away. It used to be worked out by
 * position, which read removing a port as renaming it to the one that slid
 * into its row, and handed that port the removed one's wire.
 *
 * A function rather than a few lines inside `NodeEditor`, so a test saves a
 * dialog the way the dialog does and not a copy of it that forgot a step.
 */
export function saveDraft(nodeId: string, before: GraphNode | undefined, draft: GraphNode): void {
  // What it is published as follows what it is asked to do (`publishedDescription`).
  const kept = { ...untracked(draft), description: NODE_BUILDERS[draft.node_type].publishedDescription(draft) };
  useGraphStore.getState().updateNode(nodeId, kept, portRenames(before, draft));
}
