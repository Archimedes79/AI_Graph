// A file dropped onto a node on the canvas, or onto the files line under a
// code or ai node's ✨ Input or ✨ Output: it is taken with no browse dialog on
// the way (📂 stays for who would rather look).
//
// What it gives the node is the element's to say (`NodeGuiBuilder.dropPort`):
// a code or an ai node takes its path, as one more file its input definition
// is written from -- kept relative to the folder the editor runs in, as a graph
// keeps paths -- and a data node what the file says, parsed when it is JSON. A
// browser hands a page a dropped file's name, size and content, never where it
// is: the path comes from the drop where it names one (a `file:` URI), and
// otherwise the engine is asked for the one file of that name and size under
// the folder it runs in (`findFile`).

import { call } from '@/api/client';
import { useGraphStore } from '@/store/graphStore';
import { NODE_BUILDERS } from '@/elements/registry';
import { fileValue } from './readAsRun';

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

/**
 * The path a `file:` URI names: `file:///D:/data/a.csv` is `D:/data/a.csv`,
 * `file:///home/a.csv` is `/home/a.csv` -- and a share on another machine,
 * `file://server/share/a.csv`, is `//server/share/a.csv`, which Windows opens
 * as `\\server\share\a.csv`. Without its server it named a folder on this one.
 */
export function uriPath(uri: string): string {
  const url = new URL(uri);
  const path = decodeURIComponent(url.pathname);
  if (url.host) return `//${url.host}${path}`;
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

/** How a dropped file is looked for (`findFile`): the files found, and where it looked, in words. */
type FindFile = (name: string, size: number) => Promise<{ paths: string[]; searched: string }>;

/** The files of *name* and *size* under the folder the engine runs in. */
const findFile: FindFile = (name, size) => call('findFile', { name, size: String(size) });

/**
 * Where *file* is on the machine the graph runs on: the path its drop named,
 * else the one file of its name and size the engine finds. None, or several,
 * is said -- none with where the engine looked -- with the way that always
 * works.
 */
export async function droppedPath(file: Dropped, find: FindFile = findFile): Promise<string> {
  if (file.uri) return uriPath(file.uri);
  const { paths, searched } = await find(file.name, file.size);
  if (paths.length === 1) return paths[0];
  throw new Error(paths.length
    ? `${paths.length} files called “${file.name}” are that size: choose the one you mean with 📂 Add a file….`
    : `A browser does not say where a dropped file is, and no “${file.name}” of that size is in ${searched}: `
      + 'choose it with 📂 Add a file….');
}

/**
 * *file*, dropped on node *nodeId* on the canvas, taken as *how* says
 * (`NodeGuiBuilder.dropPort`) -- its path, or what it says -- and given to the
 * node (`withDropped`): one undo step, written into the graph that was open
 * when it was dropped, and the node's panel opened on it.
 */
export async function dropExample(
  nodeId: string,
  how: 'path' | 'text',
  file: Dropped,
  find?: FindFile,
  kept?: (path: string) => Promise<string>,
): Promise<void> {
  const started = useGraphStore.getState().document;
  const node = () => useGraphStore.getState().rfNodes.find((item) => item.id === nodeId)?.data.graphNode;
  if (!node()) return;
  const value = await fileValue(how === 'path', () => droppedPath(file, find), file.text, kept);
  const store = useGraphStore.getState();
  const now = node();
  if (store.document !== started || !now) return;
  // A file it has already is no change, and no undo step.
  const next = NODE_BUILDERS[now.node_type].withDropped(now, value);
  if (next !== now) store.updateNode(nodeId, next);
  store.setEditingNode(nodeId);
}
