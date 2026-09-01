import type { DataType, Port, PortKind } from '../graph.ts';

/**
 * One port, with the defaults spelled out once.
 *
 * Ports were built inline wherever they were needed — in the editor's node
 * creation, again where a node's mode changes, again per widget kind — and each
 * copy repeated `required: false, description: ''` and could quietly differ in
 * `multi`, which decides whether several edges collect into a list.
 */
export function port(
  id: string,
  name: string,
  kind: PortKind,
  dataType: DataType,
  multi = false,
  description = '',
): Port {
  return { id, name, kind, data_type: dataType, multi, required: false, description };
}
