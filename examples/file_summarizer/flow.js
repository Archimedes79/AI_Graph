// File reader & summarizer
// Pick a text file, read it, and have a model summarize it. Choosing a file or pressing
// Summarize starts the graph at the reader; changing the length re-runs only the summary.
// Paths are relative to the working directory, so run this from the repository root.
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
  // Summarizer · gui · engine/src/elements/nodes/gui/GuiNodeElement.ts › execute
  // The page this tool shows
  // starts a round: file_out, length_out, go_out
  const page = await node.page();

  // Read file · code · nodes/reader/code.js
  // Reads the chosen file and says what it is
  const reader = await node.reader(
    { file: page.file_out, path: page.file_out },
    { gate: page.go_out, readFiles: true },
  );

  // Summarize · ai · nodes/summarizer/run.js
  // Summarize the text faithfully, at the length asked for.
  const summarizer = await node.summarizer({ text: reader.text, length: page.length_out });

  // Once the round is done.
  node.page.next({ summary_in: summarizer.output, about_in: reader.info, content_in: reader.text });
}
