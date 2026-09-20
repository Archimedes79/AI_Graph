// Nested statistics
// A part of the work built as its own graph: the counting lives inside one node, and the
// graph above it reads as a sentence.
//
// Written by AI-Graph on every save, from graph.json: read it, do not edit it.
// It is never run -- the engine runs graph.json -- and says the same thing as code:
// one call per node, in the order a whole run takes, each handed what its wires carry.
//
//   gate:      the node runs only in a round that opens its ◆ -- by the event the
//              round began with, or by a true -- and keeps what it made otherwise
//   each:      once per item of the list that arrives, not once for the list
//   readFiles: a file path that arrives is read, and the node is handed its content
//   next(...): handed over once the round is done -- how a page is shown an answer,
//              and what a data node starts the next round with

async function flow(node) {
  // Paragraph · input · engine/src/elements/nodes/input/InputNodeElement.ts › execute
  // The text to measure
  const paragraph = await node.paragraph();

  // Statistics · subgraph · engine/src/elements/nodes/subgraph/SubgraphNodeElement.ts › execute
  // A graph of its own: open it to see how the counting is done
  const statistics = await node.statistics({ text: paragraph.output });

  // Report · output · engine/src/elements/nodes/output/OutputNodeElement.ts › execute
  await node.report({ value: statistics.numbers });
}
