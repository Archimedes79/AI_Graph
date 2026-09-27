// A wire as the canvas holds it, turned into the edge a graph file saves.

import type { GraphEdge, Wire } from '@/graph';

/**
 * *wire* as a saved `GraphEdge`: the ends named for the file. A handle the
 * canvas left out is the port a node has when it has one -- `output` and
 * `input`, as a saved graph has always read it -- so what the authoring rules
 * ask of the wiring is what a run, reading the saved file, will find. A wire
 * without an id is given one by its place, *at*.
 *
 * It was written out four times -- in exporting the graph, in naming a new
 * wire, in the graph sweep and in asking the engine which ports carry paths --
 * and the copies disagreed on a missing handle (`output` in the file, '' in
 * the others).
 */
export function graphEdge(wire: Wire & { id?: string }, at = 0): GraphEdge {
  return {
    id: wire.id || `e${at}`,
    source_node_id: wire.source,
    source_port_id: wire.sourceHandle || 'output',
    target_node_id: wire.target,
    target_port_id: wire.targetHandle || 'input',
  };
}
