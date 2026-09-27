// The files a node's example reads, kept with the node.
//
//     nodes/chart/
//       examples.md          ```json input  { "csv": "example/three_countries.csv" }
//       example/
//         three_countries.csv
//
// An example whose input reads a file names it "example/<name>", and the file
// is the node's own: copied there from the graph or from a file someone
// picked, or written by ✨. So the example runs wherever the project goes, and
// does not break when the file it was first taken from moves or changes.
//
// In the graph they are one setting, `example_files`: a map from that name to
// the file's text. A project folder keeps each as a file of its own
// (`project/folder.ts`). They are read wherever a node runs on its example --
// ▶ Try it, `test`, ✨'s probe, `run-node` -- through a `FileService` that
// looks among them first (`withExampleFiles`); a graph's run never does.

import type { GraphNode } from '../graph.ts';
import type { FileService } from '../elements/Runtime.ts';

/** The folder in a node's folder that holds them, and what each name an example gives one begins with. */
export const EXAMPLE_DIR = 'example';

/** The config key that holds them. */
export const EXAMPLE_FILES = 'example_files';

/**
 * How much text one example file holds at most, when it is written or copied
 * in: 200 KB. An example is there to be read by a person and shown to a
 * model; what is larger stays where it is, and the example names it there.
 */
export const EXAMPLE_FILE_LIMIT = 200 * 1024;

/** *name* with its slashes one way: "example\\a.csv" and "example/a.csv" are one file. */
const normal = (name: string): string => name.replace(/\\/g, '/');

/**
 * Whether *name* names an example file: "example/<name>", one level down, and
 * nothing that could lead out of the node's folder -- no "..", no drive, no
 * leading slash, no ":" (on Windows, a stream of another file).
 */
export function isExampleFileName(name: string): boolean {
  const parts = normal(name).split('/');
  if (parts.length !== 2 || parts[0] !== EXAMPLE_DIR) return false;
  const file = parts[1];
  return !!file.trim() && file !== '.' && file !== '..' && !/[:\0]/.test(file);
}

/** *node*'s example files, by the name an example gives each ("example/rows.csv"): what is well named and text. */
export function exampleFilesOf(node: Pick<GraphNode, 'config'>): Record<string, string> {
  const held = node.config[EXAMPLE_FILES];
  if (!held || typeof held !== 'object' || Array.isArray(held)) return {};
  return Object.fromEntries(Object.entries(held as Record<string, unknown>)
    .filter(([name, text]) => isExampleFileName(name) && typeof text === 'string')
    .map(([name, text]) => [normal(name), text as string]));
}

/** *text* as a file read in binary mode arrives: its UTF-8 bytes, in base64. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // In pieces: a spread of 200 KB of arguments is more than a call takes.
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/**
 * *files*, with the example files in *held* answered first: `read` and
 * `exists` of "example/<name>" -- either slash -- are answered from *held*,
 * and every other path, and everything else, is handed on as it was.
 */
export function withExampleFiles(files: FileService, held: Record<string, string>): FileService {
  const own = new Map(Object.entries(held).map(([name, text]) => [normal(name), text]));
  if (!own.size) return files;
  return {
    resolve: (path) => files.resolve(path),
    exists: async (path) => own.has(normal(path)) || files.exists(path),
    read: async (path, mode) => {
      const text = own.get(normal(path));
      if (text === undefined) return files.read(path, mode);
      return mode === 'binary' ? base64(text) : text;
    },
    write: (path, content, mode) => files.write(path, content, mode),
    list: (path, options) => files.list(path, options),
    ...(files.remove ? { remove: (path: string) => files.remove!(path) } : {}),
  };
}
