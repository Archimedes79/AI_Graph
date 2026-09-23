// Handing an element a file's content instead of its name.
//
// A node that says `read_file_inputs` wants the text, not the path — a summary
// of three stories, not a summary of three filenames. The executor does it, for
// any element that asks, which is why an AI node and a code node behave the
// same here without either implementing it.
//
// **Only where a path is declared.** A node that read every string input as a
// filename would break the moment someone wired a sentence into it, and the
// error would arrive as "no such file: Once upon a time".
//
// Declared at *either end of the wire*, though, and that second half was
// missing for a long time. A node is created with its input typed `any` --
// nobody has said what it carries yet -- so ticking "read file contents from
// paths" on one did nothing at all: the box was on, the port was not
// `file_path`, and the body was handed a filename in silence. Meanwhile the
// picker feeding it declares `file_path` perfectly well. So the question is
// asked of the wire: if what arrives was declared a path by whoever sends it,
// reading it is what the person asked for.
//
// The editor says it as well, when the wire is drawn, and its port editor lets
// anyone say it by hand. Neither makes this redundant: a graph written by hand,
// by the MCP server, or before either existed is read correctly all the same.

import type { GraphEdge, GraphNode } from '../graph.ts';
import type { FileService, Runtime } from '../elements/Runtime.ts';
import type { Runners } from '../elements/NodeRunner.ts';

/** A port id and the type its far end declares, for every wire into *node*. */
function declaredBySource(node: GraphNode, graph: FileGraph | undefined, elements?: Runners): Set<string> {
  const paths = new Set<string>();
  if (!graph) return paths;
  const typeOf = new Map<string, string>();
  for (const other of graph.nodes) {
    // A page's ports follow from its blocks, so a file need not spell them out.
    // Asked of the element where it has an opinion, which is the same answer
    // the canvas draws and the wiring is checked against.
    const outputs = elements ? (elements.node(other.node_type)?.derivedPorts(other, elements)?.outputs ?? other.outputs) : other.outputs;
    for (const port of outputs) typeOf.set(`${other.id}.${port.id}`, port.data_type);
  }
  for (const edge of graph.edges) {
    if (edge.target_node_id !== node.id) continue;
    if (typeOf.get(`${edge.source_node_id}.${edge.source_port_id}`) === 'file_path') {
      paths.add(edge.target_port_id);
    }
  }
  return paths;
}

/** Only what this needs of a graph, so a caller with two loose lists can ask too. */
export interface FileGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The ports of *node* whose wired value is a path — by its own type, or, where
 * it declares none, by the wire's.
 *
 * The target's own word wins, and that is not a detail. A file reader takes the
 * same picker output twice: `file`, typed `file_path`, to be read, and `path`,
 * typed `text`, to keep the *name* for the line it prints about the file. Both
 * come from a `file_path` output. So a rule that asked only the wire read both
 * and the summary lost its filename -- which is a test in this repo, and it
 * caught exactly that.
 *
 * `any` is the case with nobody's word on it: the type a code node is created
 * with, and the one the editor cannot change. There the wire decides.
 */
export function filePorts(node: GraphNode, graph?: FileGraph, elements?: Runners): string[] {
  const fromSource = declaredBySource(node, graph, elements);
  return node.inputs
    .filter((port) => port.data_type === 'file_path'
      || (port.data_type === 'any' && fromSource.has(port.id)))
    .map((port) => port.id);
}

/**
 * *inputs* with the paths on *ports* replaced by what the files say.
 *
 * Its own function because a run is not the only thing that must do this:
 * code generated for such a node is tried on a sample before anyone sees it,
 * and a sample still holding the path tries the code on a filename.
 */
export async function readPorts(
  inputs: Record<string, unknown>,
  ports: string[],
  files: FileService,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (!ports.includes(key) || value === null || value === undefined) {
      resolved[key] = value;
      continue;
    }
    // No path is no file, and no file has no content: a picker nobody has used
    // yet hands on "", and the node is there to say "choose a file" -- it used
    // to be told `ENOENT: open ''` instead, before it ran at all.
    const read = (path: unknown): Promise<string> | string => (String(path ?? '').trim() ? files.read(String(path)) : '');
    resolved[key] = Array.isArray(value) ? await Promise.all(value.map(read)) : await read(value);
  }
  return resolved;
}

export function readFileInputs(
  node: GraphNode,
  inputs: Record<string, unknown>,
  runtime: Runtime,
  graph?: FileGraph,
  elements?: Runners,
): Promise<Record<string, unknown>> {
  return readPorts(inputs, filePorts(node, graph, elements), runtime.files);
}
