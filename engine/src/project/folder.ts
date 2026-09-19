// A graph as a folder: the project.
//
//     my_tool/
//       graph.json          nodes, their settings and ports, the edges
//       layout.json         where each node sits on the canvas, and its size
//       nodes/
//         summarize/        one folder per node that keeps any writing, by id
//           system.md       what the element keeps in files: `Element.texts`
//           output.md
//         page/
//           chart/code.js   a block of a page, one level down
//
// Structure and writing are split because they are edited differently. The
// wiring is what the canvas edits, and it is one document the canvas reads and
// writes whole. The writing -- code, prompts, output interfaces -- is what a
// person edits in their own editor, reviews in a diff and greps for, so each
// piece is a file with a name that says what it is. Positions are split off
// the structure again so that moving a node on the canvas is not a change to
// what the graph does.
//
// **The file wins, the JSON is the fallback.** A text is read from its file
// when the file exists and taken from `graph.json` otherwise. That one rule is
// what lets a deploy bundle -- a folder whose `graph.json` carries everything
// inline -- open as a project, and a single-file graph still open at all.
//
// **Everything reads through here.** The editor, a command line run, a served
// tool and the MCP server open a project the same way, which is the point: a
// node's code in `code.js` is the node's code wherever the graph is run from.

import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { parseGraph, type Graph, type GraphNode } from '../graph.ts';
import { registry, NODES, WIDGETS } from '../elements/registry.ts';
import { parseWidget } from '../elements/nodes/gui/GuiNodeElement.ts';
import { readLegacyNodeFiles } from './legacy.ts';

export const GRAPH_FILE = 'graph.json';
export const LAYOUT_FILE = 'layout.json';
export const NODES_DIR = 'nodes';

export class NotFound extends Error {}
export class NotAGraph extends Error {}
export class FileChanged extends Error {
  readonly fileName: string;
  constructor(fileName: string) {
    super(`${fileName} was changed outside the editor since it was last read. `
      + 'Reload the project to take that change, or save it somewhere else.');
    this.fileName = fileName;
  }
}

/**
 * A hook every file read and written goes through, for a caller that must
 * confine what may be touched (the MCP server). It throws to refuse.
 */
export type Guard = (path: string) => Promise<void>;

// ---------------------------------------------------------------------------
// Where things are
// ---------------------------------------------------------------------------

/** A folder with a `graph.json` in it. */
export function isProjectFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, GRAPH_FILE));
  } catch {
    return false;
  }
}

/**
 * The project folder *path* means, or null for a plain graph file.
 *
 * A folder is one; so is its `graph.json`, named directly -- which is how a
 * tool that only deals in `.json` paths (the MCP server, a shell's tab
 * completion) reaches one.
 */
export function projectFolderOf(path: string): string | null {
  const full = resolve(path);
  if (isProjectFolder(full)) return full;
  if (basename(full) === GRAPH_FILE && existsSync(join(dirname(full), NODES_DIR))) return dirname(full);
  if (basename(full) === GRAPH_FILE && existsSync(join(dirname(full), LAYOUT_FILE))) return dirname(full);
  return null;
}

/** A folder name from an id: ids come from the file format and may hold anything. */
function folderName(id: string): string {
  return id.replace(/[^\p{L}\p{N}_.-]/gu, '_').replace(/^\.+/, '_') || '_';
}

/** Where a node's writing goes, relative to the project folder. */
export function nodeFolder(nodeId: string): string {
  return `${NODES_DIR}/${folderName(nodeId)}`;
}

/** One piece of writing in a graph: whose it is, which field holds it, and where its file goes. */
export interface ProjectText {
  node_id: string;
  /** The block inside a page, or `''` for the node's own. */
  widget_id: string;
  field: string;
  /** Relative to the project folder, with `/`. */
  path: string;
  json: boolean;
  /** The object the field lives on: a node's config, or the block itself. */
  holder: Record<string, unknown>;
}

/** Every piece of writing *graph* can keep in files, whether or not it holds any. */
export function projectTexts(graph: Graph): ProjectText[] {
  const found: ProjectText[] = [];
  const folders = new Map<string, string>();
  const claim = (folder: string, owner: string): string => {
    const other = folders.get(folder);
    if (other !== undefined && other !== owner) {
      throw new NotAGraph(`"${other}" and "${owner}" would share the folder ${folder}. Give one of them another id.`);
    }
    folders.set(folder, owner);
    return folder;
  };

  for (const node of graph.nodes) {
    const folder = claim(nodeFolder(node.id), node.id);
    for (const text of registry.node(node.node_type)?.texts(node) ?? []) {
      found.push({
        node_id: node.id, widget_id: '', field: text.field, path: `${folder}/${text.file}`,
        json: text.json === true, holder: node.config,
      });
    }
    const blocks = Array.isArray(node.config.gui_widgets) ? node.config.gui_widgets as Record<string, unknown>[] : [];
    for (const raw of blocks) {
      const widget = parseWidget(raw);
      const blockFolder = claim(`${folder}/${folderName(widget.id)}`, `${node.id}/${widget.id}`);
      for (const text of registry.widget(widget.kind)?.texts(widget) ?? []) {
        found.push({
          node_id: node.id, widget_id: widget.id, field: text.field, path: `${blockFolder}/${text.file}`,
          json: text.json === true, holder: raw,
        });
      }
    }
  }
  return found;
}

/** Every file name any element keeps writing in: what a save may tidy away, and nothing else. */
function textFileNames(): Set<string> {
  const names = new Set<string>();
  const probeNode = { id: '', node_type: '', label: '', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config: {} } as unknown as GraphNode;
  for (const element of NODES) for (const text of element.texts(probeNode)) names.add(text.file);
  for (const element of Object.values(WIDGETS)) for (const text of element.texts(parseWidget({}))) names.add(text.file);
  return names;
}

// ---------------------------------------------------------------------------
// Text in files
// ---------------------------------------------------------------------------

/**
 * Exactly one newline is added on the way out and taken off on the way in, so
 * what was in the field is what comes back -- and a file saved by an editor
 * that ends every file with a newline reads as the text without it.
 */
function toFile(value: unknown, json: boolean): string {
  return `${json ? JSON.stringify(value, null, 2) : String(value)}\n`;
}

function fromFile(content: string, json: boolean, path: string): unknown {
  const text = content.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (!json) return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new NotAGraph(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

/** Nothing written: no file for it. A JSON value that is an empty object says nothing either. */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !value.trim();
  return typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0;
}

// ---------------------------------------------------------------------------
// "Changed on disk since we last looked"
// ---------------------------------------------------------------------------
//
// Two editors write the same files: this one on save, and whatever the folder
// is open in. Every read and write records what a file looked like; a save
// that would overwrite a file changed since then refuses, and the editor asks
// what changed (`changesOnDisk`) to take it in. Per process, deliberately: a
// local tool, and a guard that forgets on restart is honest about what it can
// promise.

const ABSENT = 'absent';
const seen = new Map<string, string>();

async function signature(path: string): Promise<string> {
  try {
    const info = await stat(path);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return ABSENT;
  }
}

async function remember(path: string): Promise<void> {
  seen.set(path, await signature(path));
}

/** Forget every file: for tests, which reuse paths a real session would not. */
export function forgetSeen(): void {
  seen.clear();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function readJson(path: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new NotFound(`No ${what} at ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new NotAGraph(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

function asGraph(raw: unknown, path: string): Graph {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { nodes?: unknown }).nodes)) {
    throw new NotAGraph(`${path} is not a graph: it has no "nodes" list.`);
  }
  try {
    return parseGraph(raw);
  } catch (error) {
    throw new NotAGraph(`${path} is not a graph: ${(error as Error).message}`);
  }
}

/** Where each node sits: from `layout.json` when there is one, in a row when it says nothing. */
function applyLayout(graph: Graph, layout: unknown): void {
  if (!layout || typeof layout !== 'object') return;
  const placed = layout as Record<string, { x?: number; y?: number; width?: number | null; height?: number | null }>;
  graph.nodes.forEach((node, index) => {
    const at = placed[node.id];
    if (!at) {
      node.position = { x: 80 + index * 360, y: 120 };
      return;
    }
    node.position = { x: Number(at.x ?? 0), y: Number(at.y ?? 0) };
    if (at.width != null) node.width = Number(at.width);
    if (at.height != null) node.height = Number(at.height);
  });
}

/** A project folder, with every piece of writing read in from its file. */
export async function readProject(folder: string, guard?: Guard): Promise<Graph> {
  const graphPath = join(folder, GRAPH_FILE);
  await guard?.(graphPath);
  const graph = asGraph(await readJson(graphPath, 'graph'), graphPath);
  const layoutPath = join(folder, LAYOUT_FILE);
  if (existsSync(layoutPath)) {
    await guard?.(layoutPath);
    applyLayout(graph, await readJson(layoutPath, 'layout'));
  }
  for (const text of projectTexts(graph)) {
    const path = join(folder, text.path);
    if (existsSync(path)) {
      await guard?.(path);
      text.holder[text.field] = fromFile(await readFile(path, 'utf8'), text.json, text.path);
    }
    await remember(path);
  }
  return graph;
}

/**
 * Whatever *path* is: a project folder (or its `graph.json`), or a single
 * graph file. The one way anything in this engine opens a graph.
 */
export async function loadGraph(path: string, guard?: Guard): Promise<Graph> {
  const full = resolve(path);
  const folder = projectFolderOf(full);
  if (folder) return readProject(folder, guard);
  if (!existsSync(full)) throw new NotFound(`Nothing at ${full}`);
  if (statSync(full).isDirectory()) throw new NotAGraph(`${full} is a folder without a ${GRAPH_FILE}: not a project.`);
  await guard?.(full);
  const graph = asGraph(await readJson(full, 'graph'), full);
  await readLegacyNodeFiles(graph, full);
  return graph;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Keys in one order, so saving an unchanged graph changes nothing in the file. */
function sorted<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]])) as T;
}

/**
 * Write *graph* as the project folder *folder*.
 *
 * Every text goes to its file and out of `graph.json`; a text that is empty
 * has no file, and one that was emptied loses it. Files a node no longer has
 * -- it was deleted, or its block was -- are removed, but only files with the
 * names elements write: whatever else a person put in the folder stays.
 *
 * Refuses, before writing anything, when a file it would change was changed
 * by someone else since it was last read.
 */
export async function writeProject(folder: string, graph: Graph, guard?: Guard): Promise<void> {
  const copy = JSON.parse(JSON.stringify(graph)) as Graph;
  const texts = projectTexts(copy);

  const planned = new Map<string, string | null>();
  for (const text of texts) {
    const value = text.holder[text.field];
    delete text.holder[text.field];
    planned.set(join(folder, text.path), isBlank(value) ? null : toFile(value, text.json));
  }

  // Look first, write after: half a save is worse than none. Only what exists
  // can be lost -- a file deleted outside since is simply written again.
  for (const [path, content] of planned) {
    const known = seen.get(path);
    const now = await signature(path);
    if (known === undefined || known === now || now === ABSENT) continue;
    if (await readFile(path, 'utf8') !== content) throw new FileChanged(path.slice(folder.length + 1).replace(/\\/g, '/'));
  }

  for (const [path, content] of planned) {
    await guard?.(path);
    if (content === null) {
      if (existsSync(path)) await rm(path);
    } else {
      await mkdir(dirname(path), { recursive: true });
      // Beside, then over: a crash mid-write leaves the old file whole.
      await writeFile(`${path}.tmp`, content, 'utf8');
      await rename(`${path}.tmp`, path);
    }
    await remember(path);
  }
  await tidy(join(folder, NODES_DIR), new Set(planned.keys()), textFileNames());

  const layout: Record<string, Record<string, number>> = {};
  const nodes = copy.nodes.map((node) => {
    layout[node.id] = {
      x: Math.round(node.position?.x ?? 0),
      y: Math.round(node.position?.y ?? 0),
      ...(node.width ? { width: Math.round(node.width) } : {}),
      ...(node.height ? { height: Math.round(node.height) } : {}),
    };
    const { position: _position, width: _width, height: _height, ...rest } = node;
    const config = sorted(rest.config as Record<string, unknown>);
    if (Array.isArray(config.gui_widgets)) {
      config.gui_widgets = (config.gui_widgets as Record<string, unknown>[]).map((block) => sorted(block));
    }
    return { ...rest, config };
  });

  await mkdir(folder, { recursive: true });
  for (const [name, content] of [
    [GRAPH_FILE, { metadata: copy.metadata, nodes, edges: copy.edges }],
    [LAYOUT_FILE, layout],
  ] as const) {
    const path = join(folder, name);
    await guard?.(path);
    await writeFile(path, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  }
}

/** Remove element files nothing claims any more, and the folders that leaves empty. */
async function tidy(directory: string, claimed: Set<string>, names: Set<string>): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await tidy(path, claimed, names)) await rmdir(path);
      else empty = false;
    } else if (names.has(entry.name) && !claimed.has(path)) {
      await rm(path);
    } else {
      empty = false;
    }
  }
  return empty;
}

/** A single graph file, everything inline: what a download, a bundle and an import carry. */
export async function writeGraphFile(path: string, graph: Graph, guard?: Guard): Promise<void> {
  await guard?.(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
}

/** Save to *path* as what it names: a `.json` path outside a project is one file, anything else a folder. */
export async function saveGraph(path: string, graph: Graph, guard?: Guard): Promise<void> {
  const full = resolve(path);
  const folder = projectFolderOf(full);
  if (folder) return writeProject(folder, graph, guard);
  if (extname(full).toLowerCase() === '.json') return writeGraphFile(full, graph, guard);
  return writeProject(full, graph, guard);
}

/**
 * The file a node's (or a block's) body lives in, relative to the project's
 * `nodes/` folder -- `count/code.js`, `say/system.md` -- created empty when
 * nothing has been written yet, so there is something to open.
 */
export async function bodyFileOf(folder: string, nodeId: string, widgetId = ''): Promise<string> {
  const graphPath = join(folder, GRAPH_FILE);
  const graph = asGraph(await readJson(graphPath, 'graph'), graphPath);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new NotFound(`No node "${nodeId}" in ${graphPath}. Save the graph first.`);
  const raw = widgetId
    ? (Array.isArray(node.config.gui_widgets) ? node.config.gui_widgets as Record<string, unknown>[] : []).find((w) => w.id === widgetId)
    : undefined;
  const logic = raw ? registry.widget(parseWidget(raw).kind)?.logic(parseWidget(raw)) : registry.node(node.node_type)?.logic(node);
  const texts = projectTexts(graph).filter((text) => text.node_id === nodeId && text.widget_id === widgetId);
  const body = texts.find((text) => text.field === logic?.fields.body) ?? texts[0];
  if (!body) throw new NotFound(`"${nodeId}" keeps nothing in files.`);
  const path = join(folder, body.path);
  if (!existsSync(path)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '', 'utf8');
    await remember(path);
  }
  return body.path.slice(NODES_DIR.length + 1);
}

// ---------------------------------------------------------------------------
// What changed on disk
// ---------------------------------------------------------------------------

/** A piece of writing someone changed outside the editor. */
export interface TextChange {
  node_id: string;
  widget_id: string;
  field: string;
  /** What the file says now; empty when it was deleted. */
  value: unknown;
}

/**
 * The texts of the project in *folder* whose files changed since this process
 * last read or wrote them -- edited in another editor, restored by git,
 * deleted -- with what they say now. Each is then taken as seen: asking twice
 * reports it once. Only texts are watched; `graph.json` changing under an
 * open editor is a reload, not a patch.
 */
export async function changesOnDisk(folder: string): Promise<TextChange[]> {
  const graphPath = join(folder, GRAPH_FILE);
  const graph = asGraph(await readJson(graphPath, 'graph'), graphPath);
  const changes: TextChange[] = [];
  for (const text of projectTexts(graph)) {
    const path = join(folder, text.path);
    const known = seen.get(path);
    const now = await signature(path);
    if (known === undefined || known === now) continue;
    const value = now === ABSENT ? (text.json ? null : '') : fromFile(await readFile(path, 'utf8'), text.json, text.path);
    seen.set(path, now);
    changes.push({ node_id: text.node_id, widget_id: text.widget_id, field: text.field, value });
  }
  return changes;
}
