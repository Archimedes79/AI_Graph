// Statistics
// Counts what is in a text. A graph like any other: it runs on its own, and it runs as one
// node of the graph above it.
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
  // Text · input · engine/src/elements/nodes/input/InputNodeElement.ts › execute
  // Handed in by the node above; on its own run, this value
  const text = await node.text();

  // Counts · code · nodes/counts/code.js
  const counts = await node.counts({ text: text.output });

  // Numbers · output · engine/src/elements/nodes/output/OutputNodeElement.ts › execute
  await node.numbers({ value: counts.output });
}
