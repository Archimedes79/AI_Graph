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
import { ERROR_PORT, memoryFeedbackEdges, topologicalLevels } from '../execution/executor.ts';
import { RUN_PORT } from '../execution/triggers.ts';
import { registry } from '../elements/registry.ts';
import { parseWidget } from '../elements/nodes/gui/GuiNodeElement.ts';
import { ALL_INPUTS, placeholders } from '../elements/nodes/ai/prompt.ts';
import { mismatches, readInterface } from '../execution/interface.ts';
import { parseExamples } from '../execution/examples.ts';
import { NODES_DIR, loadGraph, nodeFolder, projectFolderOf, projectTexts } from './folder.ts';

/** One thing to fix: where it is, what it is, and what to do about it. */
export interface Problem {
  where: string;
  problem: string;
  fix: string;
}

export const names = (ids: Iterable<string>): string => [...ids].map((id) => `"${id}"`).join(', ') || '(none)';

/** The ports *node* really has -- derived where the engine derives them, declared where a person names them. */
function portsOf(node: GraphNode): { inputs: Set<string>; outputs: Set<string>; derived: boolean } {
  const element = registry.node(node.node_type);
  let derived: ReturnType<NonNullable<typeof element>['derivedPorts']> = null;
  try {
    derived = element?.derivedPorts(node) ?? null;
  } catch {
    // Settings too broken to derive from. The declared ports are the best guess left.
  }
  const ids = (ports: unknown): string[] => (Array.isArray(ports) ? ports : [])
    .map((port) => (port as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === 'string');

  const inputs = new Set(ids(derived ? derived.inputs : node.inputs));
  const outputs = new Set(ids(derived ? derived.outputs : node.outputs));
  // The input every node has and none declares.
  inputs.add(RUN_PORT);
  // A node told to catch its own failure grows the port the executor puts it on.
  if (element?.catchesErrors(node)) outputs.add(ERROR_PORT);
  return { inputs, outputs, derived: derived !== null };
}

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
export function problemsIn(graph: Graph): Problem[] {
  const problems: Problem[] = [];

  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const node of graph.nodes) (seen.has(node.id) ? duplicated : seen).add(node.id);
  for (const id of duplicated) {
    problems.push({
      where: `node "${id}"`,
      problem: 'More than one node has this id.',
      fix: 'Give every node its own id, and point each edge at the one it means.',
    });
  }

  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  for (const node of graph.nodes) {
    const where = `node "${node.id}"`;
    const element = registry.node(node.node_type);
    if (!element) {
      problems.push({
        where,
        problem: `Unknown node_type "${node.node_type}".`,
        fix: `Use one of: ${registry.nodeTypes().join(', ')}. Anything else -- a merge, a split, a filter -- is a "code" node.`,
      });
      continue;
    }

    if (node.node_type === 'code' && !String(node.config.code ?? '').trim()) {
      problems.push({
        where,
        problem: 'A code node with no config.code: it fails the moment it runs.',
        fix: 'Put the body in config.code as "function run(inputs) { ... }", returning an object keyed by this node\'s output port ids.',
      });
    }

    problems.push(...interfaceProblems(node, where));
    problems.push(...exampleProblems(graph, node, where));

    // A placeholder nobody fills is sent to the model as the literal "{{name}}".
    const template = String(node.config.prompt_template ?? '');
    if (node.node_type === 'ai' && template.trim()) {
      const inputs = new Set(node.inputs.map((port) => port.id));
      for (const name of placeholders(template)) {
        if (name === ALL_INPUTS || inputs.has(name)) continue;
        problems.push({
          where,
          problem: `Its message template asks for {{${name}}}, and it has no input "${name}".`,
          fix: `Use one of its inputs: ${names(inputs)} -- or add an input with that id.`,
        });
      }
    }

    if (element.hasInterface && Array.isArray(node.config.gui_widgets)) {
      const blocks = new Set<string>();
      for (const raw of node.config.gui_widgets) {
        const block = parseWidget(raw);
        if (!block.id) {
          problems.push({ where, problem: `A "${block.kind}" block has no id.`, fix: 'Give every block an id; its ports are named after it ("<id>_in", "<id>_out").' });
        } else if (blocks.has(block.id)) {
          problems.push({ where, problem: `More than one block has the id "${block.id}".`, fix: 'Give every block on the page its own id.' });
        }
        blocks.add(block.id);
        if (!registry.widget(block.kind)) {
          problems.push({
            where: `${where}, block "${block.id}"`,
            problem: `Unknown block kind "${block.kind}".`,
            fix: `Use one of: ${registry.widgetKinds().join(', ')}.`,
          });
        }
      }
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    const where = `edge "${edge.id}"`;
    if (edgeIds.has(edge.id)) {
      problems.push({ where, problem: 'More than one edge has this id.', fix: 'Give every edge its own id.' });
    }
    edgeIds.add(edge.id);

    for (const end of ['source', 'target'] as const) {
      const nodeId = end === 'source' ? edge.source_node_id : edge.target_node_id;
      const portId = end === 'source' ? edge.source_port_id : edge.target_port_id;
      const node = byId.get(nodeId);
      if (!node) {
        problems.push({
          where,
          problem: `Its ${end} is node "${nodeId}", and there is no such node.`,
          fix: `Point it at one of: ${names(byId.keys())} -- or add the node.`,
        });
        continue;
      }
      // An unknown node type has been reported already, and has no ports to be wrong about.
      if (!registry.node(node.node_type)) continue;
      const ports = portsOf(node);
      const side = end === 'source' ? ports.outputs : ports.inputs;
      if (side.has(portId)) continue;
      const kind = end === 'source' ? 'output' : 'input';
      problems.push({
        where,
        problem: `Its ${end} port "${portId}" is not an ${kind} of node "${nodeId}".`,
        fix: ports.derived
          ? `The ports of a${node.node_type === 'input' ? 'n' : ''} ${node.node_type} node are derived from its settings, not from what the document declares. `
            + `Its ${kind}s are: ${names([...side].filter((id) => id !== RUN_PORT))}. Wire to one of those, or change the settings that produce them.`
          : `Its ${kind}s are: ${names([...side].filter((id) => id !== RUN_PORT))}. Wire to one of those, or declare "${portId}" in the node's ${kind}s.`,
      });
    }
  }

  // With two nodes sharing an id the ordering cannot be trusted either way, and
  // the duplicate is the thing to fix first.
  if (!duplicated.size) {
    const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, registry);
    try {
      topologicalLevels(graph.nodes, graph.edges, feedback);
    } catch {
      problems.push({
        where: `nodes ${names(knot(graph, feedback))}`,
        problem: 'These nodes feed each other in a circle, so none of them can run first.',
        fix: 'A loop is only allowed through a node that remembers: a gui block (the page keeps what it shows) closes one. '
          + 'Route the value back through a gui node, or remove one of the edges.',
      });
    }
  }

  if (!graph.nodes.some((node) => node.node_type === 'output' || registry.node(node.node_type)?.hasInterface)) {
    problems.push({
      where: 'graph',
      problem: 'Nothing a person can see: there is no gui node and no output node, so a run computes its answer and shows nobody.',
      fix: 'End every branch in an "output" node (config.write_mode "window" plus an output_label, or "file"), or in a "gui" node with a block that displays the value.',
    });
  }

  return problems;
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
  const readsFiles = node.config.read_file_inputs === true;
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
