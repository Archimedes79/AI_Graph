// `interface.json`: what goes into a node and what comes out, in its own folder.
//
// A node's folder held its prompts and its code and said nothing about its
// ports: what arrives, of what type, from where, and what leaves for whom. That
// is in `graph.json` -- the node's ports in one place, the edges in another --
// which is the right place to *keep* it and a poor place to read it from.
//
// It also says **what runs**: the body in this folder, or the engine class whose
// `execute` does the work -- the one thing about a node its folder could not show.
//
// So it is written out beside the node's writing on every save. **Rendered,
// never read back**: the ports belong to the wiring, and a file allowed to
// rename one would silently detach edges. What a person may edit by hand is
// named in the file -- ports in the editor, the shape of the outputs in
// `output.schema.json`.

import type { Graph, GraphNode } from '../graph.ts';
import type { WhatRuns } from '../elements/Element.ts';
import { RUN_PORT } from '../execution/triggers.ts';

export const INTERFACE_FILE = 'interface.json';

const NOTE = 'Written by AI-Graph on every save, from graph.json: read it, do not edit it. '
  + 'Ports are changed in the editor; the shape of the outputs is output.schema.json, where this node keeps one.';

/** `reader.text`, the way a wire's other end is named everywhere else. */
const end = (nodeId: string, portId: string): string => `${nodeId}.${portId === RUN_PORT ? '◆' : portId}`;

export function describeInterface(graph: Graph, node: GraphNode, outputSchema?: unknown, runs?: WhatRuns): Record<string, unknown> {
  const into = graph.edges.filter((edge) => edge.target_node_id === node.id);
  const from = graph.edges.filter((edge) => edge.source_node_id === node.id);
  const gate = into.filter((edge) => edge.target_port_id === RUN_PORT).map((edge) => end(edge.source_node_id, edge.source_port_id));

  return {
    _: NOTE,
    node: node.id,
    type: node.node_type,
    label: node.label,
    ...(node.description ? { about: node.description } : {}),
    // What runs when this node runs: a file in this folder, or the engine class
    // that does the work, and in one sentence what that is (`Element.whatRuns`).
    ...(runs ? { runs } : {}),
    inputs: node.inputs.map((port) => ({
      port: port.id,
      ...(port.name && port.name !== port.id ? { name: port.name } : {}),
      type: port.data_type,
      ...(port.multi ? { list: true } : {}),
      ...(port.required ? { required: true } : {}),
      ...(port.description ? { description: port.description } : {}),
      from: into.filter((edge) => edge.target_port_id === port.id).map((edge) => end(edge.source_node_id, edge.source_port_id)),
    })),
    // Its ◆: what may open it. Absent, it runs whenever a round reaches it.
    ...(gate.length ? { gate } : {}),
    outputs: node.outputs.map((port) => ({
      port: port.id,
      ...(port.name && port.name !== port.id ? { name: port.name } : {}),
      type: port.data_type,
      ...(port.multi ? { list: true } : {}),
      ...(port.description ? { description: port.description } : {}),
      to: from.filter((edge) => edge.source_port_id === port.id).map((edge) => end(edge.target_node_id, edge.target_port_id)),
    })),
    ...(outputSchema && typeof outputSchema === 'object' ? { output_schema: outputSchema } : {}),
  };
}
