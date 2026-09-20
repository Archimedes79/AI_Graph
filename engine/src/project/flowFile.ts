// `flow.js`: what a graph does, from first node to last, said as code.
//
// A graph is kept as data -- `graph.json`: nodes in one list, wires in another
// -- which is the right way to keep it and a poor way to read it. Each node's
// folder says what that node is (`interface.json`) and holds what it runs
// (`code.js`, `run.js`); nothing said what happens *between* them. This does:
// one call per node, in the order a whole run takes, each handed what its wires
// carry, by name.
//
// **Rendered, never read back, never executed.** There is one implementation
// of a run and it is the executor; a second one that happened to be readable
// would be right on the day it was written. So this file has no imports and
// nothing calls it: it is the wiring, in the notation programmers read fastest.
// It is valid JavaScript all the same, so an editor colours it and a mistake in
// how it is written shows.

import type { Graph, GraphEdge, GraphNode } from '../graph.ts';
import { memoryFeedbackEdges, topologicalLevels } from '../execution/executor.ts';
import { RUN_PORT } from '../execution/triggers.ts';
import { registry } from '../elements/registry.ts';
import { folderName } from './names.ts';

export const FLOW_FILE = 'flow.js';

const HEADER = [
  'Written by AI-Graph on every save, from graph.json: read it, do not edit it.',
  'It is never run -- the engine runs graph.json -- and says the same thing as code:',
  'one call per node, in the order a whole run takes, each handed what its wires carry.',
  '',
  '  gate:      the node runs only in a round that opens its ◆ -- by the event the',
  '             round began with, or by a true -- and keeps what it made otherwise',
  '  each:      once per item of the list that arrives, not once for the list',
  '  readFiles: a file path that arrives is read, and the node is handed its content',
  '  next(...): handed over once the round is done -- how a page is shown an answer,',
  '             and what a data node starts the next round with',
];

const RESERVED = new Set(['node', 'flow', 'await', 'async', 'function', 'const', 'let', 'var', 'return', 'new', 'class', 'default',
  'export', 'import', 'delete', 'in', 'of', 'do', 'if', 'else', 'for', 'while', 'switch', 'case', 'this', 'null', 'true', 'false',
  'void', 'typeof', 'yield', 'static', 'enum', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'arguments', 'eval', 'try', 'catch', 'finally', 'throw', 'with', 'super', 'break', 'continue', 'debugger', 'instanceof']);

/** A node id as a JavaScript name: `node-3-1755` has to become something a `const` can be called. */
function names(nodes: GraphNode[]): Map<string, string> {
  const taken = new Set<string>();
  const found = new Map<string, string>();
  for (const node of nodes) {
    let name = node.id.replace(/[^A-Za-z0-9_$]/g, '_');
    if (!name || /^[0-9]/.test(name) || RESERVED.has(name)) name = `_${name}`;
    const base = name;
    for (let n = 2; taken.has(name); n += 1) name = `${base}_${n}`;
    taken.add(name);
    found.set(node.id, name);
  }
  return found;
}

const isName = (text: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
const key = (text: string): string => (isName(text) ? text : JSON.stringify(text));
const member = (object: string, property: string): string => (isName(property) ? `${object}.${property}` : `${object}[${JSON.stringify(property)}]`);
/** Whatever it is, as one line of text: a graph.json written by hand may hold a number where a name belongs. */
const oneLine = (text: unknown): string => (typeof text === 'string' ? text : text == null ? '' : JSON.stringify(text) ?? String(text)).replace(/\s+/g, ' ').trim();

/** A sentence as comment lines no wider than a page of code. */
function wrapped(text: unknown, indent = ''): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of oneLine(text).split(' ')) {
    if (line && line.length + word.length + 1 > 88 - indent.length) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((each) => `${indent}// ${each}`);
}

const WIDTH = 100;

/** `{ a: x, b: y }`: on one line while it fits, one entry a line when it does not. */
function object(entries: string[], room: number, indent: string): string {
  if (!entries.length) return '{}';
  const flat = `{ ${entries.join(', ')} }`;
  return flat.length <= room ? flat : `{\n${entries.map((entry) => `${indent}  ${entry},`).join('\n')}\n${indent}}`;
}

/** A call: on one line while it fits; otherwise its arguments a line each. */
function call(start: string, given: string[], options: string[]): string {
  if (!given.length && !options.length) return `${start});`;
  const how = options.length ? `{ ${options.join(', ')} }` : '';
  const flat = `${start}${object(given, WIDTH, '')}${how ? `, ${how}` : ''});`;
  if (flat.length <= WIDTH) return flat;
  if (!how) return `${start}${object(given, 0, '  ')});`;
  return `${start}\n    ${object(given, WIDTH - 5, '    ')},\n    ${how},\n  );`;
}

export function describeFlow(graph: Graph): string {
  const called = names(graph.nodes);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, registry);
  let order: string[];
  try {
    order = topologicalLevels(graph.nodes, graph.edges, feedback).flat();
  } catch {
    // A circle nothing remembers: `check` says so. Here, the order they were drawn in.
    order = graph.nodes.map((node) => node.id);
  }

  const from = (edge: GraphEdge): string => member(called.get(edge.source_node_id) ?? '_', edge.source_port_id);
  const lines: string[] = [`// ${oneLine(graph.metadata?.name || 'This graph')}`];
  if (graph.metadata?.description) lines.push(...wrapped(graph.metadata.description));
  lines.push('//', ...HEADER.map((line) => (line ? `// ${line}` : '//')));
  lines.push('', 'async function flow(node) {');

  // What reaches a node once the round is done, gathered per node.
  const later = new Map<string, string[]>();
  order.forEach((nodeId, index) => {
    const node = byId.get(nodeId);
    if (!node) return;
    const element = registry.node(node.node_type);
    const name = called.get(nodeId)!;
    const into = graph.edges.filter((edge) => edge.target_node_id === nodeId && byId.has(edge.source_node_id));

    // What it is, and what runs: the same words as its panel and its interface.json.
    const runs = element?.whatRuns(node);
    if (index) lines.push('');
    // A body is a file in this project; the engine's own work is named by class.
    const where = !runs ? '' : runs.where.startsWith('engine/') ? runs.where : `nodes/${folderName(node.id)}/${runs.where}`;
    lines.push(`  // ${oneLine(node.label || node.id)} · ${node.node_type}${where ? ` · ${where}` : ''}${name !== node.id ? ` · id ${JSON.stringify(node.id)}` : ''}`);
    if (node.description) lines.push(...wrapped(node.description, '  '));
    const events = element?.eventPorts(node) ?? [];
    if (events.length) lines.push(`  // starts a round: ${events.join(', ')}`);

    const ports = new Map<string, string[]>();
    for (const edge of into) {
      if (edge.target_port_id === RUN_PORT || feedback.has(edge.id)) continue;
      ports.set(edge.target_port_id, [...(ports.get(edge.target_port_id) ?? []), from(edge)]);
    }
    const given = [...ports].map(([port, sources]) => `${key(port)}: ${sources.length > 1 ? `[${sources.join(', ')}]` : sources[0]}`);
    const gate = into.filter((edge) => edge.target_port_id === RUN_PORT).map(from);
    const how = [
      ...(gate.length ? [`gate: ${gate.length > 1 ? `[${gate.join(', ')}]` : gate[0]}`] : []),
      ...(element?.batchMode(node) === 'per_item' ? ['each: true'] : []),
      ...(element?.readsFileInputs(node) ? ['readFiles: true'] : []),
    ];
    const used = graph.edges.some((edge) => edge.source_node_id === nodeId);
    const start = `  ${used ? `const ${name} = ` : ''}await ${member('node', name)}(`;
    lines.push(call(start, given, how));

    for (const edge of into) {
      if (feedback.has(edge.id)) later.set(name, [...(later.get(name) ?? []), `${key(edge.target_port_id)}: ${from(edge)}`]);
    }
  });

  if (later.size) {
    lines.push('', '  // Once the round is done.');
    for (const [name, handed] of later) {
      lines.push(call(`  ${member('node', name)}.next(`, handed, []));
    }
  }
  lines.push('}', '');
  return lines.join('\n');
}
