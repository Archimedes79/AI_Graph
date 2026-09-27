// What a subgraph node runs, as the file its folder keeps beside the graph.
//
// The same arrangement as an ai node's `run.js` (see `../ai/runTemplate.ts`):
// left alone it is the engine's, which runs the graph once without starting a
// process to say so; changed, it is the person's, a body like any other, and
// `node.graph(inputs)` asks for the graph to be run -- once per item, again
// until an answer passes a check, one run's outputs into the next.

import { isStandardText } from '../../NodeRunner.ts';

/** How often one run of a body may run its graph. A loop that forgot to end must not run forever. */
export const GRAPH_RUNS_PER_BODY = 100;

/** The `run.js` a project is given. */
export const SUBGRAPH_RUN = `// ai-graph template: subgraph@1
//
// What this node does when it runs. It runs the graph in this folder once:
// what arrived stands in for its input nodes, and what reaches its output
// nodes goes out on the ports of the same name.
//
// Left as it is, this file is kept up to date for you. Change it and it is
// yours: node.graph(inputs) runs the graph and resolves to its outputs, so it
// can run once per item, again until an answer passes a check, or feed one
// run's outputs into the next -- at most ${GRAPH_RUNS_PER_BODY} times a run.
async function run(inputs, node) {
  return await node.graph(inputs);
}`;

/** Whether *text* is nobody's own: empty, or the standard. */
export const isStandardGraphRun = (text: string): boolean => isStandardText(text, SUBGRAPH_RUN);
