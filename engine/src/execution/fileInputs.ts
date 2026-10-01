// Handing an element a file's content instead of its name.
//
// A code or AI node (`NodeRunner.readsFileInputs`) is handed the text of a file
// on each input that says so: the port typed `file_path`, which is "Read the
// file at this path" among its ports in its panel. A summary of three stories, not a
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
import type { FileService } from '../elements/Runtime.ts';
import type { Runners } from '../elements/NodeRunner.ts';
import { fileContent } from '../elements/documents.ts';
import { atMost } from './batching.ts';

/**
 * The input ports of *node* that are read: the ones typed `file_path`, on a
 * node whose kind reads its files (`readsFileInputs`) -- every other kind is
 * handed the path, whatever its port says. Asked by the run, by `check`, by
 * what a run asks for first and by the editor, so none of them can disagree.
 */
export function filePorts(node: GraphNode, elements: Runners): string[] {
  if (!elements.node(node.node_type)?.readsFileInputs) return [];
  return node.inputs.filter((port) => port.data_type === 'file_path').map((port) => port.id);
}

/**
 * A file one item was to be handed that could not be read. It stands where the
 * text would have, and that item fails with it -- that item, not the others.
 */
export class Unread extends Error {}

/**
 * *inputs* with the paths on *ports* replaced by what the files say.
 *
 * A list on a port in *each* -- one a node runs over an item at a time -- is
 * read a file per item, no more at once than *atOnce*, as its items run: a
 * file of it that cannot be read is an `Unread` in its place, and costs its
 * item. Any other file that cannot be read fails the whole, which every call
 * is handed.
 */
export async function readPorts(
  inputs: Record<string, unknown>,
  ports: string[],
  files: FileService,
  each: { ports: Set<string>; atOnce: number } = { ports: new Set(), atOnce: 1 },
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
    // What is in it, as `documents.ts` says: a Word document as its text, a picture or a PDF as itself.
    const read = (path: unknown): Promise<string> | string => (String(path ?? '').trim() ? fileContent(String(path), files) : '');
    if (Array.isArray(value) && each.ports.has(key)) {
      const texts: unknown[] = new Array(value.length);
      await atMost(value.length, each.atOnce, async (index) => {
        try {
          texts[index] = await read(value[index]);
        } catch (error) {
          texts[index] = new Unread(error instanceof Error ? error.message : String(error));
        }
      });
      resolved[key] = texts;
    } else {
      resolved[key] = Array.isArray(value) ? await Promise.all(value.map(read)) : await read(value);
    }
  }
  return resolved;
}
