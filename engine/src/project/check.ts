// What is wrong with a graph, and with a project folder.
//
// One list of problems for every reader: `node engine/src/main.ts check`
// prints it and fails a CI job on it, the MCP server hands it to a model before
// saving, and each entry says where, what, and how to fix it -- the reader may
// be a person or a model, and both fix what they are told precisely.

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Graph, GraphNode } from '../graph.ts';
import { NESTING_LIMIT, memoryFeedbackEdges, topologicalLevels } from '../execution/executor.ts';
import { RUN_PORT } from '../execution/triggers.ts';
import { names, wiringProblems, type Problem } from '../execution/wiring.ts';
import { registry } from '../elements/registry.ts';
import { mismatches, readInterface } from '../execution/interface.ts';
import { parseExamples } from '../execution/examples.ts';
import { INTERFACE_FILE } from './interfaceFile.ts';
import { FLOW_FILE } from './flowFile.ts';
import { GRAPH_FILE, LAYOUT_FILE, NODES_DIR, loadGraph, nodeFolder, projectFolderOf, projectTexts } from './folder.ts';

export { names, type Problem } from '../execution/wiring.ts';

/** The nodes a cycle is made of: whatever is left once everything with a free end is taken away. */
function knot(graph: Graph, feedback: Set<string>): string[] {
  const left = new Set(graph.nodes.map((node) => node.id));
  for (let changed = true; changed;) {
    changed = false;
    const live = graph.edges.filter((edge) => !feedback.has(edge.id)
      && left.has(edge.source_node_id) && left.has(edge.target_node_id));
    for (const id of [...left]) {
      if (live.some((edge) => edge.target_node_id === id) && live.some((edge) => edge.source_node_id === id)) continue;
      left.delete(id);
      changed = true;
    }
  }
  return [...left];
}

/**
 * Everything that would make *graph* parse, open, and then not work.
 *
 * These are the mistakes a model actually makes, and each one is silent at run
 * time: an edge to a port that does not exist delivers nothing and fails
 * nothing; a graph ending in a code node computes the answer and shows nobody.
 * So they are found here, by name, with the repair spelled out -- the reader is
 * a model, and a model fixes what it is told precisely.
 */
export function problemsIn(graph: Graph, inside = '', depth = 0): Problem[] {
  // First: with these wrong, a run refuses to start (see wiring.ts).
  const problems: Problem[] = wiringProblems(graph, registry).map((problem) => within(problem, inside));

  for (const node of graph.nodes) {
    const where = `${inside}node "${node.id}"`;
    const element = registry.node(node.node_type);
    if (!element) {
      problems.push({
        where,
        problem: `Unknown node_type "${node.node_type}".`,
        fix: `Use one of: ${registry.nodeTypes().join(', ')}. Anything else -- a merge, a split, a filter -- is a "code" node.`,
      });
      continue;
    }

    // "Hand me the file's content" is carried out port by port, for the ports
    // that say they carry a path. Ticked on a node with no such port it does
    // nothing at all, silently: the node is handed the file's *name*, and a
    // model summarises that with a straight face.
    if (element.readsFileInputs(node) && !node.inputs.some((port) => port.data_type === 'file_path')) {
      problems.push({
        where,
        problem: 'It is set to read wired files into their content, but none of its inputs is a file path -- so it is handed the path as text.',
        fix: 'Set the data_type of the input that receives the file (or the list of files) to "file_path", or turn read_file_inputs off.',
      });
    }

    // The same trap, one setting over: "once per item" fans out over the inputs
    // declared as lists. With none, the node runs once, on the whole list, and
    // nothing says it was asked to do otherwise.
    // Only where a list really arrives: "once per item" is what every node is
    // created with, and on a node no list reaches it means nothing.
    const listArrives = graph.edges.some((edge) => {
      if (edge.target_node_id !== node.id) return false;
      const source = graph.nodes.find((candidate) => candidate.id === edge.source_node_id);
      const ports = source && (registry.node(source.node_type)?.derivedPorts(source, registry)?.outputs ?? source.outputs);
      return ports?.find((port) => port.id === edge.source_port_id)?.multi === true;
    });
    // And only on a node whose ports are its own to declare: a page's follow from its blocks.
    const ownPorts = element.derivedPorts(node, registry) === null;
    if (ownPorts && listArrives && element.batchMode(node) === 'per_item' && !node.inputs.some((port) => port.multi)) {
      problems.push({
        where,
        problem: 'It is set to run once per item, but none of its inputs is declared as a list -- so it runs once, on everything at once.',
        fix: 'Set "multi": true on the input the list arrives on (and on the output that collects the results), or set batch_mode to "whole_list".',
      });
    }

    problems.push(...interfaceProblems(node, where));
    problems.push(...exampleProblems(graph, node, where));
    problems.push(...nestedProblems(node, where, depth));
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      problems.push({ where: `${inside}edge "${edge.id}"`, problem: 'More than one edge has this id.', fix: 'Give every edge its own id.' });
    }
    edgeIds.add(edge.id);

    // A ◆ is a gate and only `true` opens it. A wire that once only said "run
    // after this" -- from a text, a number -- now keeps its node shut for good,
    // and says nothing while doing so.
    if (edge.target_port_id !== RUN_PORT) continue;
    const source = graph.nodes.find((node) => node.id === edge.source_node_id);
    const element = source && registry.node(source.node_type);
    if (!source || !element || element.eventPorts(source).includes(edge.source_port_id)) continue;
    const ports = element.derivedPorts(source, registry)?.outputs ?? source.outputs;
    const port = ports.find((candidate) => candidate.id === edge.source_port_id);
    if (port && port.data_type !== 'boolean' && port.data_type !== 'any') {
      problems.push({
        where: `${inside}edge "${edge.id}"`,
        problem: `It ends on "${edge.target_node_id}"'s ◆, which only the value true opens, and "${source.id}.${port.id}" is declared as ${port.data_type}: the node would never run.`,
        fix: 'Wire an event into the ◆ (a button, a trigger), or a boolean a code node returns. If this port does carry a boolean, set its data_type to "boolean".',
      });
    }
  }

  // With two nodes sharing an id the ordering cannot be trusted either way, and
  // the duplicate is the thing to fix first.
  if (new Set(graph.nodes.map((node) => node.id)).size === graph.nodes.length) {
    const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, registry);
    try {
      topologicalLevels(graph.nodes, graph.edges, feedback);
    } catch {
      problems.push({
        where: `${inside}nodes ${names(knot(graph, feedback))}`,
        problem: 'These nodes feed each other in a circle, so none of them can run first.',
        fix: 'A loop is only allowed through a node that remembers: a gui block (the page keeps what it shows) closes one. '
          + 'Route the value back through a gui node, or remove one of the edges.',
      });
    }
  }

  // A graph inside a node hands its answer to the node above it, which is
  // somewhere for the answer to go: what this asks for is an output node, and
  // in there an output node *is* a port.
  if (!graph.nodes.some((node) => registry.node(node.node_type)?.isResult || registry.node(node.node_type)?.hasInterface)) {
    problems.push(inside ? {
      where: `${inside}graph`,
      problem: 'Nothing comes out: a graph inside a node hands its answer up through its output nodes, and there are none.',
      fix: 'Add an "output" node inside and wire the result into it. Each one is an output port on the node that holds this graph.',
    } : {
      where: 'graph',
      problem: 'Nothing a person can see: there is no gui node and no output node, so a run computes its answer and shows nobody.',
      fix: 'End every branch in an "output" node (config.write_mode "window" plus an output_label, or "file"), or in a "gui" node with a block that displays the value.',
    });
  }

  return problems;
}

/** The same problem, said about a graph that is inside a node. */
function within(problem: Problem, inside: string): Problem {
  return inside ? { ...problem, where: `${inside}${problem.where}` } : problem;
}

/**
 * The graph a node holds, checked as a graph -- by the function that checked
 * the one above it, with the node in front of what it found.
 *
 * What is wrong with the *node* is the element's to say (`NodeRunner.problems`);
 * what is here is the walking, and how far it may go.
 */
function nestedProblems(node: GraphNode, where: string, depth: number): Problem[] {
  const element = registry.node(node.node_type);
  if (!element) return [];
  const own = element.problems(node, registry, where);
  const held = element.nestedGraph(node);
  if (!held) return own;

  // Counted, not read off the breadcrumb: a node id may hold anything, this
  // one included.
  if (depth + 1 > NESTING_LIMIT) {
    return [...own, {
      where,
      problem: `Graphs are nested more than ${NESTING_LIMIT} deep here.`,
      fix: 'Flatten one of the levels: past this, nobody can follow what runs where.',
    }];
  }
  return [...own, ...problemsIn(held, `${where} ▸ `, depth + 1)];
}

/** A kept output interface that cannot be read, or that names ports the node does not have. */
function interfaceProblems(node: GraphNode, where: string): Problem[] {
  const stored = node.config.output_schema;
  if (stored === undefined || stored === null || stored === '') return [];
  const schema = readInterface(stored);
  if (!schema) {
    return [{
      where,
      problem: 'Its output interface (output.schema.json) is not a JSON Schema object.',
      fix: 'Set it again from a run, or write an object such as {"type": "object", "properties": {...}}.',
    }];
  }
  const found: Problem[] = [];
  const ports = new Set(node.outputs.map((port) => port.id));
  for (const key of Object.keys(schema.properties ?? {})) {
    if (ports.has(key)) continue;
    found.push({
      where,
      problem: `Its output interface describes "${key}", which is not one of its outputs.`,
      fix: `Its outputs are ${names(ports)}. Set the interface again from a run, or rename the property.`,
    });
  }
  return found;
}

/**
 * What only a project folder can get wrong: a folder under `nodes/` that
 * belongs to no node (the node was deleted, or renamed in \`graph.json\` by
 * hand), and a file in a node's folder that nothing reads -- `prompt.md` where
 * an AI node reads `system.md` is a text somebody wrote and nobody will ever send.
 */
export async function folderProblems(folder: string, graph: Graph): Promise<Problem[]> {
  const found: Problem[] = [];
  const expected = new Map<string, Set<string>>();
  for (const text of projectTexts(graph)) {
    const slash = text.path.lastIndexOf('/');
    const dir = text.path.slice(0, slash);
    if (!expected.has(dir)) expected.set(dir, new Set());
    expected.get(dir)!.add(text.path.slice(slash + 1));
  }
  // Every node and block has a folder it may use, even one that keeps no writing yet.
  for (const node of graph.nodes) {
    const nodeDir = nodeFolder(node.id);
    if (!expected.has(nodeDir)) expected.set(nodeDir, new Set());
    // What goes in and what comes out, written there on every save.
    expected.get(nodeDir)!.add(INTERFACE_FILE);
  }

  // A node that holds a graph holds a project folder: its own graph.json and
  // layout.json belong there, and what is under them is that project's, looked
  // at below by the same function.
  const nested = new Map<string, Graph>();
  for (const node of graph.nodes) {
    const held = registry.node(node.node_type)?.nestedGraph(node);
    if (!held) continue;
    const dir = nodeFolder(node.id);
    nested.set(dir, held);
    // Every node's folder is in `expected` already, from the loop above.
    for (const name of [GRAPH_FILE, LAYOUT_FILE, FLOW_FILE]) expected.get(dir)!.add(name);
  }

  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(folder, relative), { withFileTypes: true });
    } catch {
      return;
    }
    const reads = expected.get(relative);
    for (const entry of entries) {
      const path = `${relative}/${entry.name}`;
      // Its own project: checked as one, not walked as part of this one.
      if (entry.isDirectory() && entry.name === NODES_DIR && nested.has(relative)) {
        found.push(...(await folderProblems(join(folder, relative), nested.get(relative)!))
          .map((problem) => ({ ...problem, where: `${relative}/${problem.where}` })));
        continue;
      }
      if (entry.isDirectory()) {
        const owned = [...expected.keys()].some((dir) => dir === path || dir.startsWith(`${path}/`));
        if (!owned) {
          found.push({
            where: path,
            problem: 'This folder belongs to no node in graph.json.',
            fix: 'Delete it, or give the node it was for this id again.',
          });
          continue;
        }
        await walk(path);
      } else if (reads && !reads.has(entry.name) && !entry.name.startsWith('.')) {
        found.push({
          where: path,
          problem: 'Nothing reads this file.',
          fix: reads.size ? `This element reads ${names(reads)}.` : 'This element keeps no writing in files.',
        });
      }
    }
  };
  if (existsSync(join(folder, NODES_DIR))) await walk(NODES_DIR);
  return found;
}

/** Everything wrong with the graph or project at *path*: the `check` command's answer. */
export async function checkPath(path: string): Promise<{ problems: Problem[]; graph: Graph | null }> {
  let graph: Graph;
  try {
    graph = await loadGraph(path);
  } catch (error) {
    return { problems: [{ where: path, problem: (error as Error).message, fix: 'Fix the file so it can be read.' }], graph: null };
  }
  const problems = problemsIn(graph);
  const folder = projectFolderOf(path);
  if (folder) problems.push(...await folderProblems(folder, graph));
  return { problems, graph };
}

/**
 * A node's examples, held to the node and to its neighbours.
 *
 * To the node: every input an example gives, and every output it expects,
 * must be a port the node has. To its neighbours: an example says what the
 * node needs to receive, and the node wired into that port has an output
 * interface saying what it gives -- when the two disagree, one of them has to
 * change, and this says which port and why, before anything is run.
 */
function exampleProblems(graph: Graph, node: GraphNode, where: string): Problem[] {
  const text = String(node.config.examples ?? '');
  if (!text.trim()) return [];
  const { examples, problems: unreadable } = parseExamples(text);
  const found: Problem[] = unreadable.map((problem) => ({
    where: `${where}, examples.md`, problem, fix: 'Give each "## title" section a ```json input block, and a ```json expect or ```judge block.',
  }));
  const inputs = new Set(node.inputs.map((port) => port.id));
  const outputs = new Set(node.outputs.map((port) => port.id));
  // A port whose path is read into text arrives as the text; the producer's interface describes the path.
  const readsFiles = registry.node(node.node_type)?.readsFileInputs(node) === true;
  const filePorts = new Set(node.inputs.filter((port) => port.data_type === 'file_path').map((port) => port.id));

  for (const example of examples) {
    const at = `${where}, example "${example.title}"`;
    for (const port of Object.keys(example.inputs)) {
      if (!inputs.has(port)) {
        found.push({ where: at, problem: `It gives an input "${port}", which the node does not have.`, fix: `Its inputs are ${names(inputs)}.` });
        continue;
      }
      if (readsFiles && filePorts.has(port)) continue;
      for (const edge of graph.edges.filter((e) => e.target_node_id === node.id && e.target_port_id === port)) {
        const producer = graph.nodes.find((candidate) => candidate.id === edge.source_node_id);
        const iface = producer && registry.node(producer.node_type)?.outputInterface(producer);
        const given = iface?.properties?.[edge.source_port_id];
        if (!given) continue;
        const off = mismatches(example.inputs[port], given, `input "${port}"`);
        if (!off.length) continue;
        found.push({
          where: at,
          problem: `"${producer!.id}" is wired into "${port}", and what this example gives there does not fit its output interface: ${off[0]}.`,
          fix: `Either this example asks for the wrong thing, or "${producer!.id}" has to deliver it: change one, then run it again to set its interface.`,
        });
      }
    }
    for (const port of Object.keys(example.expect ?? {})) {
      if (!outputs.has(port)) {
        found.push({ where: at, problem: `It expects an output "${port}", which the node does not have.`, fix: `Its outputs are ${names(outputs)}.` });
      }
    }
  }
  return found;
}
