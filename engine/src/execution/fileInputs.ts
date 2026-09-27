// Handing an element a file's content instead of its name.
//
// A code or AI node (`NodeRunner.readsFileInputs`) is handed the text of a file
// on each input that says so: the port typed `file_path`, which is step 1's
// "Read the file at this path" in its dialog. A summary of three stories, not a
// summary of three filenames. The executor does it, for any element that
// declares it, which is why an AI node and a code node behave the same here
// without either implementing it.
//
// **Only the port decides.** Not a setting on the node beside it, and not the
// wire: a node that read every string as a filename would fail the moment a
// sentence was wired in -- "no such file: Once upon a time" -- and a reader that
// takes a picker's path twice, once to read and once to keep the name, needs
// the second left a path. Drawing a wire from a port that hands on paths ticks
// the box where nobody has said anything yet (`graphStore.connect`); that is
// the editor saying it once, not the run guessing it every time.

import type { GraphNode } from '../graph.ts';
import type { FileService, Runtime } from '../elements/Runtime.ts';

/** The input ports of *node* that are read: the ones typed `file_path`. */
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
