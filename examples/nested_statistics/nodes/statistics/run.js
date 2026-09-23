// ai-graph template: subgraph@1
//
// What this node does when it runs. It runs the graph in this folder once:
// what arrived stands in for its input nodes, and what reaches its output
// nodes goes out on the ports of the same name.
//
// Left as it is, this file is kept up to date for you. Change it and it is
// yours: node.graph(inputs) runs the graph and resolves to its outputs, so it
// can run once per item, again until an answer passes a check, or feed one
// run's outputs into the next -- at most 100 times a run.
async function run(inputs, node) {
  return await node.graph(inputs);
}
