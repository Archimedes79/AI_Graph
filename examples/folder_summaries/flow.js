// Summarize a folder
// Every text file in a folder is summarized on its own — the AI node runs once per file —
// and a second AI node then says what the files have in common. Paths are relative to the
// working directory, so run this from the repository root.
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
  // starts a round: go_out
  const page = await node.page();

  // Each file · ai · nodes/per_file/run.js
  // Summarize one story in exactly two sentences.
  const per_file = await node.per_file(
    { story: page.folder_out },
    { gate: page.go_out, each: true, readFiles: true },
  );

  // Table rows · code · nodes/rows/code.js
  // Puts each file name beside its summary
  const rows = await node.rows({ files: page.folder_out, summaries: per_file.output });

  // In common · ai · nodes/overall/run.js
  // Say what the stories share, from their summaries.
  const overall = await node.overall({ summaries: per_file.output });

  // Once the round is done.
  node.page.next({ table_in: rows.rows, overall_in: overall.output });
}
