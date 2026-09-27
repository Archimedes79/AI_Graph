import type { GraphNode, Port } from '@/graph';
import { derivedNodePorts } from '@/document/guiWidgets';
import { NODE_BUILDERS } from '@/elements/registry';

/** The output a node grows when it is told to catch its own failures. */
const ERROR_OUTPUT: Port = {
  id: 'error',
  name: 'Error',
  kind: 'output',
  data_type: 'text',
  multi: false,
  required: false,
  description: 'Why this node failed. Optional to wire: unwired, the run simply carries on.',
};

/**
 * The node dialog's *draft* with its setting *key* set to *value*, and its
 * ports following the setting where they are derived from it.
 *
 * *stored* is the node as the store holds it, whose ports the wires are on.
 * Which new port carries on an old one is asked against it rather than the
 * draft: a person stepping through a mode select passes modes that have no
 * such port (text, then a folder, then one file), and asked against the
 * draft, the step through the folder forgot which port the wire was on.
 */
export function withSetting(draft: GraphNode, stored: GraphNode | undefined, key: string, value: unknown): GraphNode {
  const next = { ...draft, config: { ...draft.config, [key]: value } };
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
  // `error` for the executor to fill it.
  if (key === 'catch_errors') {
    const without = next.outputs.filter((port) => port.id !== 'error');
    next.outputs = value ? [...without, ERROR_OUTPUT] : without;
  }
  return next;
}
