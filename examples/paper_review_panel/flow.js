// Paper review panel
// A pre-submission review panel: five AI reviewers — scientific soundness, an adversarial
// referee, evidence and claims, references, figures and tables — read the same manuscript
// in parallel, and a judge consolidates their findings into one ranked list with a
// recommendation. The AI advises; the researcher decides. The sample paper is fictional
// and has problems planted in it. Paths are relative to the working directory, so run this
// from the repository root.
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
  // Review panel · gui · engine/src/elements/nodes/gui/GuiNodeElement.ts › execute
  // The page this tool shows
  // starts a round: go_out
  const page = await node.page();

  // Read manuscript · code · nodes/read/code.js
  // Reads the chosen file once, for every reviewer
  const read = await node.read({ file: page.paper_out }, { gate: page.go_out, readFiles: true });

  // Scientific · ai · nodes/scientific/run.js
  // Scientific reviewer: scientific soundness.
  const scientific = await node.scientific({ paper: read.text });

  // Adversarial · ai · nodes/adversarial/run.js
  // Adversarial reviewer: to argue against the paper as a hostile but fair referee would.
  const adversarial = await node.adversarial({ paper: read.text });

  // Evidence & claims · ai · nodes/claims/run.js
  // Evidence & claims reviewer: whether each claim is backed by the evidence in the paper.
  const claims = await node.claims({ paper: read.text });

  // References · ai · nodes/references/run.js
  // References reviewer: the references.
  const references = await node.references({ paper: read.text });

  // Figures & tables · ai · nodes/figures/run.js
  // Figures & tables reviewer: the figures and tables.
  const figures = await node.figures({ paper: read.text });

  // Judge · ai · nodes/judge/run.js
  // Merges the five reviews into one ranked list and a recommendation
  const judge = await node.judge({
    scientific: scientific.output,
    adversarial: adversarial.output,
    claims: claims.output,
    references: references.output,
    figures: figures.output,
  });

  // Once the round is done.
  node.page.next({
    scientific_in: scientific.output,
    adversarial_in: adversarial.output,
    claims_in: claims.output,
    references_in: references.output,
    figures_in: figures.output,
    verdict_in: judge.output,
  });
}
