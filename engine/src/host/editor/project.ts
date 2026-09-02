// A project on disk: the graph, and one text file per authored node beside it.
//
// A graph used to be one JSON file with its code embedded as escaped strings:
// a one-line change showed up in `git diff` as a rewritten JSON line full of
// `\n`, and editing it meant a textarea in a modal while a real editor — with
// a language server and the rest — sat unused two windows away.
//
// So the graph keeps the wiring and points at a file (`config.code_file`); the
// file keeps what a person writes. The engine is untouched: the element's body
// field is still what executes, and loading fills it in from the file.
//
// **One mechanism, not one per node type.** Which config key holds an
// element's body is the element's own `Logic`, asked through `authoredIn` —
// nothing here learns what a code node is. A node and a block inside a page
// are the same thing at two levels, and go through the same code.
//
// The file carries a header — the prompt, the context it was generated from —
// so it stands on its own: opening `Analyse.js` says what it is for without
// opening the graph. Which of those flow back is deliberate and narrow: the
// body, the prompt, the label and the context file are authored, so the file
// wins; ports are derived from the wiring and are written purely so you can
// see them while writing `run(inputs)` — a text file allowed to rename one
// would silently detach edges.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { authoredIn, type AuthoredSpec } from '../../describe.ts';
import { parseGraph, type Graph, type GraphNode } from '../../graph.ts';
import { renderSkeleton } from './skeleton.ts';

export class FileChanged extends Error {
  readonly fileName: string;
  constructor(fileName: string) {
    super(`${fileName} was changed outside the editor since it was opened. `
      + 'Reload the node files to take those changes, or save to a different path.');
    this.fileName = fileName;
  }
}
export class NotFound extends Error {}
export class NotAGraph extends Error {}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** A file name from a label, because the point of files is that the tree reads like the graph. */
export function slug(label: string): string {
  const cleaned = label.replace(/[^\p{L}\p{N}_\-. ]/gu, '').trim().replace(/[\s.]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'node';
}

/** `Analyse` + `.js` -> `Analyse.js`, made unique against *taken*: two nodes may share a label. */
export function defaultFileName(label: string, extension: string, taken: Iterable<string> = []): string {
  const lower = new Set([...taken].map((name) => name.toLowerCase()));
  const base = slug(label);
  let candidate = `${base}${extension}`;
  for (let index = 2; lower.has(candidate.toLowerCase()); index += 1) candidate = `${base}_${index}${extension}`;
  return candidate;
}

/** `my_graph.json` -> `my_graph.nodes/`, beside it. */
export function nodeDir(graphPath: string): string {
  const name = basename(graphPath);
  return join(dirname(graphPath), `${name.slice(0, name.length - extname(name).length)}.nodes`);
}

// ---------------------------------------------------------------------------
// One view of "a thing with a name and some text somebody wrote"
// ---------------------------------------------------------------------------

/**
 * A node or a block, seen through its `AuthoredSpec`.
 *
 * Everything about putting one in a file is identical — the name, the header,
 * which keys flow back, the conflict check — so the difference is captured
 * once, here, and every function below never learns which of the two it holds.
 */
export class Authored {
  readonly ident: string;
  readonly spec: AuthoredSpec;
  /** The object the body and the file pointer live on: a node's config, or the block itself. */
  private readonly holder: Record<string, unknown>;
  /** Where the label and, for an ai node, the request live: the node, or the block. */
  private readonly subject: Record<string, unknown>;
  readonly inputs: string[];
  readonly outputs: string[];

  constructor(
    ident: string,
    spec: AuthoredSpec,
    holder: Record<string, unknown>,
    subject: Record<string, unknown>,
    inputs: string[],
    outputs: string[],
  ) {
    this.ident = ident;
    this.spec = spec;
    this.holder = holder;
    this.subject = subject;
    this.inputs = inputs;
    this.outputs = outputs;
  }

  get label(): string { return String(this.subject.label || this.ident); }
  set label(value: string) { this.subject.label = value; }

  get body(): string { return String(this.holder[this.spec.body_field] ?? ''); }
  set body(value: string) { this.holder[this.spec.body_field] = value; }

  get prompt(): string {
    if (!this.spec.prompt_field) return '';
    const from = this.spec.prompt_on_node ? this.subject : this.holder;
    return String(from[this.spec.prompt_field] ?? '');
  }
  set prompt(value: string) {
    if (!this.spec.prompt_field) return;
    (this.spec.prompt_on_node ? this.subject : this.holder)[this.spec.prompt_field] = value;
  }

  get fileName(): string { return String(this.holder.code_file ?? '').trim(); }
  set fileName(value: string) { this.holder.code_file = value; }

  get contextFile(): string { return String(this.holder.example_file ?? ''); }
  set contextFile(value: string) { this.holder.example_file = value; }
}

/** Every file-bearing thing in the graph, with the folder it belongs in. */
export function authoredItems(graph: Graph, directory: string): { folder: string; item: Authored }[] {
  const specs = new Map(authoredIn(graph).map((spec) => [`${spec.node_id}::${spec.widget_id}`, spec]));
  const items: { folder: string; item: Authored }[] = [];
  for (const node of graph.nodes) {
    const config = node.config as Record<string, unknown>;
    const own = specs.get(`${node.id}::`);
    if (own) {
      items.push({
        folder: directory,
        item: new Authored(node.id, own, config, node as unknown as Record<string, unknown>,
          node.inputs.map((p) => p.id), node.outputs.map((p) => p.id)),
      });
    }
    const widgets = Array.isArray(config.gui_widgets) ? config.gui_widgets as Record<string, unknown>[] : [];
    for (const widget of widgets) {
      const spec = specs.get(`${node.id}::${String(widget.id)}`);
      if (!spec) continue;
      const id = String(widget.id);
      // A gui node authors nothing itself; its slot on disk is a folder holding
      // one file per block. A block's ports are named by convention, and are
      // what the surrounding graph wires to, so they are worth stating.
      items.push({
        folder: join(directory, slug(node.label)),
        item: new Authored(id, spec, widget, widget, [`${id}_in`], [`${id}_out`]),
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Render / parse
// ---------------------------------------------------------------------------

const BANNER = '--- ai-graph ---';

/** How a header is fenced in one kind of file. Markdown cannot use `#` (a heading), so it gets front matter. */
interface CommentStyle { prefix: string; opening: string; closing: string }
const JAVASCRIPT: CommentStyle = { prefix: '// ', opening: `// ${BANNER}--------`, closing: `// ${'-'.repeat(24)}` };
const MARKDOWN: CommentStyle = { prefix: '', opening: '---', closing: '---' };
const STYLES: Record<string, CommentStyle> = { '.js': JAVASCRIPT, '.md': MARKDOWN, '.txt': MARKDOWN };

function styleFor(fileName: string): CommentStyle {
  return STYLES[extname(fileName).toLowerCase()] ?? JAVASCRIPT;
}

function headerLines(item: Authored, style: CommentStyle): string[] {
  const lines = [style.opening, `${style.prefix}node:    ${item.label}`, `${style.prefix}id:      ${item.ident}`];
  if (item.prompt.trim()) {
    lines.push(`${style.prefix}prompt: |`);
    for (const line of item.prompt.trim().split('\n')) lines.push(`${style.prefix}  ${line}`);
  }
  if (item.contextFile.trim()) lines.push(`${style.prefix}context-file: ${item.contextFile.trim()}`);
  // Informational: regenerated every write, never read back.
  if (item.inputs.length) lines.push(`${style.prefix}inputs:  ${item.inputs.join(', ')}`);
  if (item.outputs.length) lines.push(`${style.prefix}outputs: ${item.outputs.join(', ')}`);
  lines.push(style.closing);
  return lines;
}

/** Recognise the fence by shape, not an exact dash count: these files are edited by hand. */
function isOpening(line: string, style: CommentStyle): boolean {
  const text = line.trim();
  if (!style.prefix) return text === '---';
  return text.startsWith(style.prefix.trim()) && text.includes(BANNER);
}

function isClosing(line: string, style: CommentStyle): boolean {
  const text = line.trim();
  if (!style.prefix) return text === '---';
  if (!text.startsWith(style.prefix.trim())) return false;
  const rest = text.slice(style.prefix.trim().length).trim();
  return rest.length > 0 && /^-+$/.test(rest);
}

/**
 * The full file: header, blank line, then the authored text.
 *
 * Code with no body yet gets the skeleton instead of an empty file — the
 * signature it has to fill in, one line per port. Written, never read back: if
 * the stub is left untouched it is simply a function returning placeholders.
 */
export function render(item: Authored, fileName: string): string {
  const style = styleFor(fileName);
  let body = item.body.replace(/\n+$/, '');
  if (!body.trim() && extname(fileName).toLowerCase() === '.js') {
    body = renderSkeleton(item.inputs, item.outputs).replace(/\n+$/, '');
  }
  return `${headerLines(item, style).join('\n')}\n\n${body}\n`;
}

/**
 * Split a node file into header and body.
 *
 * A file with no recognisable header is not an error: somebody wrote it by
 * hand, and its whole content is the body. Being lenient here is what lets the
 * format be edited by a person rather than only by this module.
 */
export function parse(text: string, fileName = 'node.js'): { header: Record<string, string>; body: string } {
  const style = styleFor(fileName);
  const lines = text.split('\n');
  const trim = (s: string) => s.replace(/^\n+|\n+$/g, '');
  if (!lines.length || !isOpening(lines[0], style)) return { header: {}, body: trim(text) };

  const header: Record<string, string> = {};
  let blockKey: string | null = null;
  let block: string[] = [];
  let end = lines.length;
  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (isClosing(rawLine, style)) { end = index + 1; break; }
    if (style.prefix && !rawLine.trim().startsWith(style.prefix.trim())) { end = index; break; }
    // Strip the comment marker but KEEP the indentation after it: two spaces
    // is what marks a `prompt: |` continuation line.
    let content = rawLine.replace(/\s+$/, '');
    if (style.prefix) {
      content = content.replace(/^\s+/, '').slice(style.prefix.trim().length);
      if (content.startsWith(' ')) content = content.slice(1);
    }
    if (blockKey !== null && (content.startsWith('  ') || !content.trim())) {
      block.push(content.startsWith('  ') ? content.slice(2) : '');
      continue;
    }
    if (blockKey !== null) {
      header[blockKey] = trim(block.join('\n'));
      blockKey = null; block = [];
    }
    const match = /^\s*([\w-]+):\s*(.*)$/.exec(content);
    if (!match) continue;
    const [, key, value] = match;
    if (value.trim() === '|') { blockKey = key; block = []; } else header[key] = value.trim();
  }
  if (blockKey !== null) header[blockKey] = trim(block.join('\n'));
  return { header, body: trim(lines.slice(end).join('\n')) };
}

/**
 * Write a parsed file back — authored fields only.
 *
 * `id` is what matched this file to this element and is never applied; ports
 * are derived from the wiring, so a header that disagrees is stale text.
 */
export function apply(item: Authored, header: Record<string, string>, body: string): void {
  item.body = body;
  if (header.node) item.label = header.node;
  if ('prompt' in header) item.prompt = header.prompt;
  if ('context-file' in header) item.contextFile = header['context-file'];
}

// ---------------------------------------------------------------------------
// "Changed on disk since we last looked"
// ---------------------------------------------------------------------------
//
// Two editors write the same files: this one on save, and whatever the folder
// is open in. Without a check, whoever saves last wins and the other's work is
// gone with no message -- the single worst thing a sync mechanism can do. So
// every read and write records what the file looked like, and a write refuses
// when the file no longer matches. Per process, deliberately: a local tool,
// and a guard that forgets on restart is honest about what it can promise.

const seen = new Map<string, string>();

async function signature(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return null;
  }
}

export async function remember(path: string): Promise<void> {
  const now = await signature(path);
  if (now !== null) seen.set(path, now);
}

/** Whether *path* differs from the last time this process read or wrote it. Never seen counts as unchanged: new, not conflicted. */
export async function changedSinceSeen(path: string): Promise<boolean> {
  const known = seen.get(path);
  if (known === undefined) return false;
  const now = await signature(path);
  return now !== null && now !== known;
}

export function forgetAll(): void {
  seen.clear();
}

// ---------------------------------------------------------------------------
// The three things the editor does with a project
// ---------------------------------------------------------------------------

/** Read the graph file, migrated, or say precisely why not. */
async function readGraph(graphPath: string): Promise<Graph> {
  if (!existsSync(graphPath)) throw new NotFound(`File not found: ${graphPath}`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(graphPath, 'utf8'));
  } catch (error) {
    throw new NotAGraph(`Invalid graph JSON: ${(error as Error).message}`);
  }
  try {
    return parseGraph(raw);
  } catch (error) {
    throw new NotAGraph(`Invalid graph JSON: ${(error as Error).message}`);
  }
}

/**
 * Fill each authored field from its file. The file is authoritative for what a
 * person writes, so this runs on load and the editor never sees a stale copy.
 * A missing file is left alone rather than blanking the element: a graph whose
 * sibling folder was not copied should still open with what the JSON carries.
 */
async function readNodeFiles(graph: Graph, graphPath: string): Promise<void> {
  for (const { folder, item } of authoredItems(graph, nodeDir(graphPath))) {
    if (!item.fileName) continue;
    const path = join(folder, item.fileName);
    if (!existsSync(path)) continue;
    const { header, body } = parse(await readFile(path, 'utf8'), item.fileName);
    apply(item, header, body);
    await remember(path);
  }
}

/**
 * Write one file per element that has opted into having one, named after the
 * element: renaming it on the canvas renames its file, which is the whole
 * reason the name is derived from the label rather than the id.
 */
async function writeNodeFiles(graph: Graph, graphPath: string): Promise<void> {
  const taken = new Map<string, Set<string>>();
  for (const { folder, item } of authoredItems(graph, nodeDir(graphPath))) {
    const current = item.fileName;
    if (!current) continue;
    const used = taken.get(folder) ?? new Set<string>();
    taken.set(folder, used);
    const wanted = defaultFileName(item.label, item.spec.extension, used);
    used.add(wanted);

    await mkdir(folder, { recursive: true });
    const oldPath = join(folder, current);
    const newPath = join(folder, wanted);
    // Never overwrite an edit made outside this app.
    for (const candidate of new Set([oldPath, newPath])) {
      if (await changedSinceSeen(candidate)) throw new FileChanged(basename(candidate));
    }
    if (current !== wanted && existsSync(oldPath) && !existsSync(newPath)) await rename(oldPath, newPath);
    item.fileName = wanted;
    await writeFile(newPath, render(item, wanted), 'utf8');
    await remember(newPath);
  }
}

/** The JSON to write: a node whose text lives in a file does not repeat it here. */
function withoutExternalisedBodies(graph: Graph): Graph {
  const copy = JSON.parse(JSON.stringify(graph)) as Graph;
  for (const { item } of authoredItems(copy, '')) {
    if (item.fileName) item.body = '';
  }
  return copy;
}

/** A graph as the editor sent it, parsed and migrated but otherwise as is. */
export function asGraph(raw: unknown): Graph {
  try {
    return parseGraph(raw);
  } catch (error) {
    throw new NotAGraph(`Invalid graph: ${(error as Error).message}`);
  }
}

/** The editor's "Open": the graph, with every node file read back into it. */
export async function load(graphPath: string): Promise<Graph> {
  const graph = await readGraph(graphPath);
  await readNodeFiles(graph, graphPath);
  return graph;
}

/** The editor's "Save": node files first, then the JSON without their bodies. */
export async function save(graphPath: string, graph: Graph): Promise<Graph> {
  graph.metadata.updated_at = new Date().toISOString();
  await writeNodeFiles(graph, graphPath);
  await mkdir(dirname(graphPath), { recursive: true });
  await writeFile(graphPath, `${JSON.stringify(withoutExternalisedBodies(graph), null, 2)}\n`, 'utf8');
  return graph;
}

/** Re-read the node files for an open graph: the case the conflict check exists for. */
export const reloadNodes = load;

export type { GraphNode };
