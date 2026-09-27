// Files, read the way a run reads them.
//
// Step 1's example can come from a file, an input node shows what it will hand
// on, and a folder listing shows the files it lists. Each of those is a read,
// and each is done by the engine's own element, run on its own by the route
// "▶ Try it" uses (`runNode`): the same path resolved against the same folder,
// the same text read, the same extensions and recursion applied to a listing.
// A second way of reading a file here would be a second answer to "what does
// the node get".

import type { GraphNode, GuiWidget } from '@/graph';
import { call } from '@/api/client';
import { NODE_KINDS } from '@/document/nodeKinds';
import { derivedNodePorts, syncGuiNodePorts } from '@/document/guiWidgets';
import { useGraphStore } from '@/store/graphStore';
import type { TryResult } from './TryItInline';

/**
 * A node, run by itself: nothing else of the graph is sent or run, with the
 * graph's metadata as a run has it.
 */
function runAlone(node: GraphNode): Promise<TryResult> {
  const graph = { metadata: useGraphStore.getState().metadata, nodes: [node], edges: [] };
  return call('runNode', { ...graph, node_id: node.id, inputs: {} });
}

/**
 * What *node* hands on, run by itself. A failure is thrown, not caught: a node
 * told to catch its failures puts the reason on its error port and hands on
 * nothing, so a folder that does not exist was listed as "0 files".
 */
async function readAlone(node: GraphNode): Promise<Record<string, unknown>> {
  const result = await runAlone(node);
  if (result.status === 'error') throw new Error(result.error || 'It could not be read.');
  return result.outputs ?? {};
}

/** A copy of *node* with *config* changed, and the ports that follow from it. */
function reading(node: GraphNode, config: Partial<GraphNode['config']>): GraphNode {
  const next = { ...node, config: { ...node.config, ...config, catch_errors: false, prompt_at_runtime: false } };
  return { ...next, ...(derivedNodePorts(next) ?? {}) };
}

/** The text of the file at *path*, as an input node in file mode hands it on. */
export async function readFileAsRun(path: string): Promise<string> {
  const node = reading(NODE_KINDS.input.create('read'), { input_mode: 'file', value: path });
  return String((await readAlone(node)).content ?? '');
}

/** The files an input node in directory mode lists, as a run lists them. */
export async function listAsRun(node: GraphNode): Promise<string[]> {
  const listed = (await readAlone(reading(node, {}))).files;
  return Array.isArray(listed) ? listed.map(String) : [];
}

/** The files a folder picker on a page lists, as a run lists them: the block on a page of its own. */
export async function listBlockAsRun(widget: GuiWidget): Promise<string[]> {
  const blank = NODE_KINDS.gui.create('page');
  const page = syncGuiNodePorts({ ...blank, config: { ...blank.config, gui_widgets: [{ ...widget, catch_errors: false }] } });
  const listed = (await readAlone(page))[`${widget.id}_out`];
  return Array.isArray(listed) ? listed.map(String) : [];
}

/** What a node is handed when the files are read: JSON when it is JSON, the text otherwise. */
export function contentValue(text: string): unknown {
  const trimmed = text.trim();
  if (!/^[[{"]/.test(trimmed)) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/**
 * *path* as a graph keeps it: relative to *home* -- the folder the engine
 * runs in, which is what a run resolves a relative path against -- when it is
 * inside it, with forward slashes, so the graph opens the same on another
 * machine and in another checkout. Anywhere else it stays as it is.
 */
export function relativeTo(home: string, path: string): string {
  const slashed = (text: string) => text.replace(/\\/g, '/');
  const root = slashed(home).replace(/\/+$/, '');
  const full = slashed(path);
  const windows = /^[A-Za-z]:\//.test(root);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (root && same(full.slice(0, root.length), root) && full[root.length] === '/') return full.slice(root.length + 1);
  return path;
}

let home: Promise<string> | null = null;

/** A picked path as it is stored: see `relativeTo`. The engine's folder is asked once. */
export async function storedPath(path: string): Promise<string> {
  // A failed answer is not kept: the next pick asks again.
  home ??= call('browse', { path: '' }).then((page) => page.path).catch(() => { home = null; return ''; });
  return relativeTo(await home, path);
}
