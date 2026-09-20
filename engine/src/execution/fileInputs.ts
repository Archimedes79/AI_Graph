// Handing an element a file's content instead of its name.
//
// A node that says `read_file_inputs` wants the text, not the path — a summary
// of three stories, not a summary of three filenames. The executor does it, for
// any element that asks, which is why an AI node and a code node behave the
// same here without either implementing it.
//
// **Only ports typed `file_path`.** A node that read every string input as a
// filename would break the moment someone wired a sentence into it, and the
// error would arrive as "no such file: Once upon a time".

import type { GraphNode } from '../graph.ts';
import type { FileService, Runtime } from '../elements/Runtime.ts';

/** The ports of *node* whose wired value is a path. */
export function filePorts(node: GraphNode): string[] {
  return node.inputs.filter((port) => port.data_type === 'file_path').map((port) => port.id);
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
): Promise<Record<string, unknown>> {
  return readPorts(inputs, filePorts(node), runtime.files);
}
