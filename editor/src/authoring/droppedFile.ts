// A file dropped onto a node on the canvas, or onto step 1's example field:
// it becomes the example, with no browse dialog on the way (📂 stays for who
// would rather look).
//
// What it puts there is what 📂 From a file puts there: the file's path on an
// input that reads the file -- kept relative to the folder the editor runs in,
// as a graph keeps paths -- and otherwise what the file says, parsed when it is
// JSON. A browser hands a page a dropped file's name, size and content, never
// where it is: the path comes from the drop where it names one (a `file:` URI),
// and otherwise the engine is asked for the one file of that name and size under
// the folder it runs in (`findFile`).

import { call } from '@/api/client';
import { useGraphStore } from '@/store/graphStore';
import { NODE_BUILDERS } from '@/elements/registry';
import { contentValue, storedPath } from './readAsRun';
import { readFilePorts } from './generationContext';

/** A dropped file, as far as a browser says what it is. */
export interface Dropped {
  name: string;
  size: number;
  text: () => Promise<string>;
  /** Where it is, when the drop said: a `file:` URI. */
  uri?: string;
}

/**
 * The first file a drop brings, or undefined for one that brings none -- a
 * node dragged from the palette. Read while the drop lasts: afterwards the
 * browser has taken the transfer back.
 */
export function droppedFile(transfer: DataTransfer | null): Dropped | undefined {
  const file = transfer?.files?.[0];
  if (!file) return undefined;
  const uri = (transfer?.getData('text/uri-list') ?? '').split(/\r?\n/).find((line) => line.startsWith('file:'));
  return { name: file.name, size: file.size, text: () => file.text(), ...(uri ? { uri } : {}) };
}

/** A drag that carries files: one to take on. */
export const carriesFiles = (transfer: DataTransfer | null): boolean => !!transfer?.types.includes('Files');

/** The path a `file:` URI names: `file:///D:/data/a.csv` is `D:/data/a.csv`, `file:///home/a.csv` is `/home/a.csv`. */
export function uriPath(uri: string): string {
  const path = decodeURIComponent(new URL(uri).pathname);
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

/** The files of *name* and *size* under the folder the engine runs in. */
async function findFile(name: string, size: number): Promise<string[]> {
  return (await call('findFile', { name, size: String(size) })).paths;
}

/**
 * Where *file* is on the machine the graph runs on: the path its drop named,
 * else the one file of its name and size the engine finds. None, or several,
 * is said, with the way that always works.
 */
export async function droppedPath(file: Dropped, find: (name: string, size: number) => Promise<string[]> = findFile): Promise<string> {
  if (file.uri) return uriPath(file.uri);
  const paths = await find(file.name, file.size);
  if (paths.length === 1) return paths[0];
  throw new Error(paths.length
    ? `${paths.length} files called “${file.name}” are that size: choose the one you mean with 📂 From a file….`
    : `Where “${file.name}” is cannot be told from a drop when it is not under the folder the editor was started in: choose it with 📂 From a file….`);
}

/**
 * What *file* puts into the example on an input: its path where the node
 * *reads* the file there (as a graph keeps a path: `storedPath`), otherwise
 * what it says, parsed when it is JSON.
 */
export async function droppedValue(
  file: Dropped,
  reads: boolean,
  find?: (name: string, size: number) => Promise<string[]>,
  kept: (path: string) => Promise<string> = storedPath,
): Promise<unknown> {
  if (reads) return kept(await droppedPath(file, find));
  return contentValue(await file.text());
}

/**
 * *file*, dropped on node *nodeId* on the canvas, as the example on its
 * *port* (`NodeGuiBuilder.withExampleValue`): one undo step, written into the
 * graph that was open when it was dropped -- and the node's dialog opened on
 * it, where ▶ Try it is one click away.
 */
export async function dropExample(
  nodeId: string,
  port: string,
  file: Dropped,
  find?: (name: string, size: number) => Promise<string[]>,
  kept?: (path: string) => Promise<string>,
): Promise<void> {
  const started = useGraphStore.getState().document;
  const node = () => useGraphStore.getState().rfNodes.find((item) => item.id === nodeId)?.data.graphNode;
  const dropped = node();
  if (!dropped) return;
  const value = await droppedValue(file, readFilePorts(dropped).includes(port), find, kept);
  const store = useGraphStore.getState();
  const now = node();
  if (store.document !== started || !now) return;
  store.updateNode(nodeId, NODE_BUILDERS[now.node_type].withExampleValue(now, port, value));
  store.setEditingNode(nodeId);
}
