// Population plotter
// Plot a CSV of names and numbers — here, the population of countries — as sorted bars,
// columns, a line or a donut, with the rows beside it. No model involved, and no drawing
// code: the code node works out what to plot and the chart block draws it, at the size the
// block really is and in the colours of the page. Every control redraws it at once, so
// there is no button. Paths are relative to the working directory, so run this from the
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
  // Plotter · gui · engine/src/elements/nodes/gui/GuiNodeRunner.ts › execute
  // The page this tool shows
  // starts a round: file_out, kind_out, top_out
  const page = await node.page();

  // What to plot · code · nodes/chart/code.js
  // Reads the CSV and says what the chart should show
  const chart = await node.chart(
    { csv: page.file_out, kind: page.kind_out, top: page.top_out },
    { readFiles: true },
  );

  // Once the round is done.
  node.page.next({ plot_in: chart.figure, table_in: chart.rows });
}
