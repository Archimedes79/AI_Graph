// `interface.json`: what goes into a node and what comes out, in its own folder.
//
// The node's ports, and the shape of what it produced when it keeps one. This
// is where they are kept -- not a copy of something elsewhere, and read back
// on every open. What a port is wired to is not here: that is the flow's, and
// a node that needs to know what arrives follows the wire and reads the other
// node's interface there.

import type { DataType, GraphNode, Port, PortKind } from '../graph.ts';
import { NotAGraph } from '../errors.ts';

export const INTERFACE_FILE = 'interface.json';

/** One port as a person reads it: its id, and only what is not the plain default. */
interface PortOnDisk {
  port: string;
  name?: string;
  type: DataType;
  list?: true;
  required?: true;
  description?: string;
}

function onDisk(port: Port): PortOnDisk {
  return {
    port: port.id,
    ...(port.name && port.name !== port.id ? { name: port.name } : {}),
    type: port.data_type,
    ...(port.multi ? { list: true as const } : {}),
    ...(port.required ? { required: true as const } : {}),
    ...(port.description ? { description: port.description } : {}),
  };
}

function fromDisk(raw: unknown, kind: PortKind, path: string): Port {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (typeof p.port !== 'string' || !p.port) throw new NotAGraph(`${path}: every ${kind} needs a "port" id.`);
  return {
    id: p.port,
    name: typeof p.name === 'string' && p.name ? p.name : p.port,
    kind,
    data_type: (typeof p.type === 'string' ? p.type : 'any') as DataType,
    multi: p.list === true,
    required: p.required === true,
    // A "format" an older save wrote is left out: nothing ever read it.
    description: typeof p.description === 'string' ? p.description : '',
  };
}

/** What a node's `interface.json` says. */
export function describeInterface(node: GraphNode, outputSchema?: unknown): Record<string, unknown> {
  return {
    inputs: node.inputs.map(onDisk),
    outputs: node.outputs.map(onDisk),
    ...(outputSchema && typeof outputSchema === 'object' ? { output_schema: outputSchema } : {}),
  };
}

/** A node's ports and kept output shape, read from what its `interface.json` says. */
export function interfaceFrom(raw: unknown, path: string): { inputs: Port[]; outputs: Port[]; outputSchema?: unknown } {
  if (raw === undefined) return { inputs: [], outputs: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new NotAGraph(`${path} is not an interface: expected an object with "inputs" and "outputs".`);
  const r = raw as Record<string, unknown>;
  const list = (value: unknown, kind: PortKind): Port[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new NotAGraph(`${path}: "${kind}s" must be a list of ports.`);
    return value.map((port) => fromDisk(port, kind, path));
  };
  return {
    inputs: list(r.inputs, 'input'),
    outputs: list(r.outputs, 'output'),
    ...(r.output_schema !== undefined ? { outputSchema: r.output_schema } : {}),
  };
}
