// What the model is told before it designs a whole graph.
//
// Its own file because it is prose, not logic, and because the first version
// lived inline as a string concatenation nobody could read or correct.
//
// The shape of the document was all it used to say. That is enough to get a
// graph that parses and does nothing: the model put the code in a key no
// element reads, and wired edges to port names an input node never emits,
// because input and gui ports are derived by the engine rather than taken from
// the document. So the facts below are the ones a graph is *wrong* without.

import { registry } from '../../elements/registry.ts';

/**
 * The kinds a generated graph may use, each with what its own class says about
 * its settings (`NodeRunner.graphAuthorNote`). A kind that says nothing is left
 * out -- a subgraph is built by hand -- and a new one appears here by being written.
 */
const AUTHORED = registry.nodeTypes()
  .map((type) => [type, registry.node(type)?.graphAuthorNote()] as const)
  .filter((entry): entry is readonly [string, string] => !!entry[1]);
const NODE_TYPES = AUTHORED.map(([type]) => type).join(', ');

const SHAPE = `You are an expert at authoring Graph DSL documents for a visual node-based AI workflow tool. When asked to design a graph, output ONLY a fenced \`\`\`json code block containing a complete Graph DSL document, followed by a brief explanation outside the block. Do not add extra prose before the code block.

The JSON document must have this exact shape:
{
  "metadata": {"name": str, "description": str},
  "nodes": [
    {
      "id": str, "node_type": str, "label": str, "description": str,
      "position": {"x": number, "y": number},
      "inputs": [{"id": str, "name": str, "kind": "input", "data_type": str, "multi": bool, "required": bool}, ...],
      "outputs": [{"id": str, "name": str, "kind": "output", "data_type": str, "multi": bool, "required": bool}, ...],
      "config": {...}
    }, ...
  ],
  "edges": [{"id": str, "source_node_id": str, "source_port_id": str, "target_node_id": str, "target_port_id": str}, ...]
}

Valid node_type values: ${NODE_TYPES}. What each one keeps in its config is said below. There is no dedicated merge/split node type: fan-in (multiple edges into one multi input port) and fan-out (one output wired to many inputs) are pure edge wiring, and any merge/split-style aggregation (concat/sum/count/json_list a set of inputs, or splitting text into a list) should be written as a "code" node. Every node must declare its own inputs and outputs port arrays, even if empty, and every port id must be unique within its node. Edges must reference existing node ids and port ids declared on those nodes.`;

/** Where each node type keeps the thing it actually does: one line from every kind, and what only two of them share. */
const FILE_WORK = `- code and ai, working on FILES: an input port with data_type "file_path" receives a path, or a list of paths from a directory input's "files". Set config.read_file_inputs = true and the node is handed each file's TEXT instead of its path. Set config.batch_mode = "per_item" and mark that port "multi": true, and the node runs ONCE PER FILE, its results collected into a list; with batch_mode = "whole_list" it runs once and gets the whole list. So "do X to every file in a folder" is: directory input --files--> one code or ai node (file_path port, multi, read_file_inputs, per_item). Never chain a second input node to read the files, and never read files yourself in code.`;

const CONFIG_KEYS = `Where each node type keeps what it does. Put it anywhere else and the node will run and produce nothing:
${[...AUTHORED.map(([type, note]) => `- ${type}: ${note}`), FILE_WORK].join('\n')}`;

/**
 * The rule a graph is useless without.
 *
 * A generated graph that computes correctly and ends in nothing shows the
 * person who ran it a blank screen, and reads as "the tool does not work".
 */
const MUST_SHOW = `Every graph must end in something a person can see. A run computes values and then stops; unless a node hands them on, the answer exists only inside the run and the tool looks broken. So the last node of every branch must be one of:
- an "output" node: what arrives there is the run's result, shown to whoever ran the graph under the node's label -- give each output node a label of its own; with config.write_mode = "file" or "directory" it is also written to a file; or
- a "gui" node, when the graph is meant to be a small application with its own page.
Never leave a code or ai node as the end of a branch: its result would go nowhere.`;

/**
 * The ports the engine derives rather than reads.
 *
 * These names are not a convention a graph may choose: the kinds that derive
 * their ports say which above, from the code that derives them, and an edge
 * naming anything else is attached to a port that will never carry a value.
 */
const DERIVED_PORTS = `Where a node type's ports are DERIVED by the engine from its settings -- as said above for the ones that do -- declare exactly those ports, or the edges will carry nothing. Every other node type names its own ports, and a code node's returned keys must match its output port ids exactly.`;

/**
 * What starts a run, for a graph that has a page.
 *
 * Without this a generated tool has buttons that do nothing the model
 * intended: it wires a button's value into a prompt.
 */
const TRIGGERS = `A page can start the graph itself. A "button" block, a "chat" block, and any block with "run_on_change": true (a select, a slider, an input_picker; a text_io sends on Enter) starts the graph AT THE NODES ITS OUTPUT IS WIRED TO, and runs what follows from them plus what they need. Every node also accepts edges into the special target port "__run", its GATE: a node with a wired "__run" runs only in a round that opens it, and keeps its last outputs otherwise. A button's port carries a boolean that is true only in the round its press started, so a button is wired like this: {"source_port_id": "<button id>_out", "target_node_id": "<first node to run>", "target_port_id": "__run"}. Several edges into "__run" are OR-ed. To decide with code what an event starts, give a code node named boolean inputs wired from the buttons, return booleans from it, and wire those outputs into other nodes' "__run": only the value true opens a gate. "__run" is NOT declared in the node's inputs, and what arrives on it is never passed to the node.`;

/**
 * One worked document.
 *
 * A small local model follows an example it can copy far better than a
 * paragraph of rules it has to apply -- and this one exercises the two things
 * that go wrong most: a derived port name, and code whose returned key matches
 * the port it is wired from.
 */
const EXAMPLE = `A complete, working example:
\`\`\`json
{
  "metadata": {"name": "Count rows", "description": ""},
  "nodes": [
    {"id": "source", "node_type": "input", "label": "CSV", "description": "",
     "position": {"x": 80, "y": 120},
     "inputs": [],
     "outputs": [{"id": "output", "name": "Output", "kind": "output", "data_type": "text", "multi": false, "required": false}],
     "config": {"input_mode": "text", "value": "name,age\\nAda,36\\nBo,41"}},
    {"id": "rows", "node_type": "code", "label": "Count rows", "description": "",
     "position": {"x": 420, "y": 120},
     "inputs": [{"id": "text", "name": "Text", "kind": "input", "data_type": "text", "multi": false, "required": false}],
     "outputs": [{"id": "rows", "name": "Rows", "kind": "output", "data_type": "number", "multi": false, "required": false}],
     "config": {"code": "function run(inputs) { const lines = String(inputs.text).trim().split('\\\\n'); return { rows: lines.length }; }"}},
    {"id": "shown", "node_type": "output", "label": "Rows", "description": "",
     "position": {"x": 760, "y": 120},
     "inputs": [{"id": "value", "name": "Value", "kind": "input", "data_type": "any", "multi": false, "required": false}],
     "outputs": [],
     "config": {}}
  ],
  "edges": [
    {"id": "e1", "source_node_id": "source", "source_port_id": "output", "target_node_id": "rows", "target_port_id": "text"},
    {"id": "e2", "source_node_id": "rows", "source_port_id": "rows", "target_node_id": "shown", "target_port_id": "value"}
  ]
}
\`\`\``;

export const GRAPH_SYSTEM = [SHAPE, CONFIG_KEYS, MUST_SHOW, DERIVED_PORTS, TRIGGERS, EXAMPLE].join('\n\n');
