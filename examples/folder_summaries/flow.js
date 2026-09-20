// Summarize a folder
// Choose a folder and read a summary of every text file in it. One page, one model: the AI
// node runs once per file, and the page shows the summaries one under the other. Choosing
// a folder starts it. Paths are relative to the working directory, so run this from the
// repository root.
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
  // Folder summaries · gui · engine/src/elements/nodes/gui/GuiNodeRunner.ts › execute
  // The page this tool shows
  // starts a round: folder_out
  const page = await node.page();

  // Each file · ai · nodes/summarize/run.js
  // Summarizes one file; runs once per file in the folder
  const summarize = await node.summarize(
    { story: page.folder_out },
    { each: true, readFiles: true },
  );

  // Once the round is done.
  node.page.next({ summaries_in: summarize.output });
}
