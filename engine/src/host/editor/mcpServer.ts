// AI-Graph, offered to an assistant outside it.
//
// A Model Context Protocol server over stdio: Claude Code, Claude Desktop or any
// other MCP client can have a graph designed, check one, save it and run it.
// `ai/mcp.ts` is the other direction -- a graph's model calling out to somebody's
// tools. This is somebody's model calling in.
//
// **One file, one door.** Everything the outside can reach is the six tools
// below, and everything they can reach is one folder. Three layers, so each can
// be read and tested without the others:
//
//   createGraphTools   what the tools do. No transport, no process, no globals:
//                      a test hands it a temp folder and a fake model.
//   serveStdio         JSON-RPC over two streams. Knows nothing about graphs.
//   runMcpServer       the real machine wired into the two above; `cli.ts`
//                      calls it for `--mcp`, and nothing else does.
//
// No SDK, for the reason the client has none: the engine has no runtime
// dependencies. It lives under `host/editor/` because it is authoring, and
// authoring is what a bundle does not carry -- `bundle.ts` skips every `editor/`
// folder, which is why `cli.ts` reaches this file with a dynamic import.
//
// THE CONFINEMENT RULES. The caller is a model acting on text it read somewhere,
// so every argument is treated as written by a stranger. Each rule has a test.
//
//   1. Every path argument is resolved against the root and must stay inside
//      it -- `..`, an absolute path elsewhere and another drive are all the same
//      refusal. Checked twice: as written, and again where the path *really*
//      leads once links are followed, because a link inside the root is a door
//      out of it.
//   2. Only `.json` is read or written, and never under a dot-folder or
//      `node_modules`: what `list_graphs` would not show, nothing else touches.
//   3. A file that exists is overwritten only if it is already a graph. That is
//      what stops `save_graph` from being "write any JSON file" -- it cannot
//      replace `package.json`, because `package.json` has no `nodes`.
//   4. `ai-settings.json` is never opened by a tool, under any name that reaches
//      it. It holds the keys.
//   5. Nothing returned contains an environment variable, a key or settings
//      content. A provider's error message passes through, because it is how a
//      person finds out their model name is wrong; whatever in it matches a
//      configured secret is blanked first, and so is every other result.
//   6. What comes in is bounded (a description, a graph, one protocol line) and
//      so is what goes out: a run reports each value cut to a few hundred
//      characters, because a graph that reads a 5 MB file should not push 5 MB
//      through a model's context.
//
// What this does **not** confine is a graph that runs. `run_graph` executes code
// nodes, in the same sandbox every run uses (`nodeCode` in `host/node.ts`): no
// child processes, no native addons, no workers -- but files and the network
// stay open, because reading files is most of what a graph is for. So the root
// is a fence around what the *tools* touch, not around what a graph's own code
// touches. Point it at a project folder, not at a home directory.

import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import type { AiService, Runtime, ToolSpec } from '../../elements/Runtime.ts';
import { parseGraph, type Graph, type GraphNode } from '../../graph.ts';
import { ERROR_PORT, executeGraph, memoryFeedbackEdges, topologicalLevels } from '../../execution/executor.ts';
import { RUN_PORT, type Trigger } from '../../execution/triggers.ts';
import { registry } from '../../elements/registry.ts';
import { applyRuntimeValues, runtimeRequirements, withDefaults } from '../../execution/runtimeValues.ts';
import { parseWidget } from '../../elements/nodes/gui/GuiNodeElement.ts';
import { candidatePaths, configuredMcpServers, configuredSettings, SETTINGS_FILENAME } from '../../ai/settings.ts';
import { nodeRuntime } from '../node.ts';
import { generateGraph } from './generate.ts';
import { GRAPH_SYSTEM } from './graphPrompt.ts';
import { generationTarget } from './settings.ts';
import { apply, authoredItems, nodeDir, parse } from './project.ts';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_DESCRIPTION_CHARS = 20_000;
const MAX_GRAPH_BYTES = 2 * 1024 * 1024;
/** One protocol line: the largest graph, plus room for JSON's own escaping around it. */
const MAX_LINE_CHARS = 2 * MAX_GRAPH_BYTES;
/** How much of one value a run reports. Enough to see what it is; not enough to be it. */
const VALUE_LIMIT = 600;
const ERROR_LIMIT = 1_500;
const LIST_DEPTH = 4;
const LIST_LIMIT = 200;
/** How many `.json` files a listing opens before it stops looking. */
const LIST_EXAMINED = 1_000;
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist']);

// ---------------------------------------------------------------------------
// Confinement
// ---------------------------------------------------------------------------

/**
 * The tool said no, and the sentence is for the model that asked.
 *
 * Its own type so that the one place turning failures into results can tell a
 * refusal it wrote from an exception it did not expect -- both come back as
 * `isError`, but only one of them is worded for a reader.
 */
class Refused extends Error {}

/**
 * The refusal that is about the document rather than about where it is.
 * `validate_graph` reports this one as a finding: "is this a graph?" was the
 * question, and "no, because" is an answer to it, not a failure to answer.
 */
class NotAGraph extends Refused {}

const fold = (path: string): string => (process.platform === 'win32' ? path.toLowerCase() : path);

/**
 * Where *path* really is: its deepest existing ancestor with links followed,
 * and the rest put back on. A file about to be created has no real path of its
 * own, but the folder it would land in does.
 */
async function real(path: string): Promise<string> {
  const rest: string[] = [];
  let head = path;
  for (;;) {
    try {
      return join(await realpath(head), ...rest.reverse());
    } catch {
      const up = dirname(head);
      if (up === head) return path;
      rest.push(basename(head));
      head = up;
    }
  }
}

/** With the separator, or `/work/graphs-old` counts as inside `/work/graphs`. */
const prefixOf = (root: string): string => (root.endsWith(sep) ? root : root + sep);
const isUnder = (root: string, full: string): boolean => fold(full).startsWith(fold(prefixOf(root)));

/** Rules 1, 2 and 4, for one spelling of a path. Throws the refusal; returns nothing. */
function mustBeInside(root: string, full: string, given: string): void {
  const prefix = prefixOf(root);
  if (!isUnder(root, full)) {
    throw new Refused(
      `"${given}" is outside the folder this server is confined to. `
      + 'Give a path relative to that folder, such as "graphs/my_graph.json".',
    );
  }
  const within = full.slice(prefix.length);
  // A colon inside the root is not a drive letter. On Windows it is an
  // alternate data stream: `notes.exe:x.json` ends in `.json` and writes into
  // `notes.exe`.
  if (/[<>:"|?*]/.test(within) || [...within].some((char) => char.charCodeAt(0) < 32)) {
    throw new Refused(`"${given}" contains characters a file name cannot be trusted with.`);
  }
  if (within.split(sep).some((part) => part.startsWith('.') || SKIPPED_FOLDERS.has(part.toLowerCase()))) {
    throw new Refused(`"${given}" is under a dot-folder, node_modules or dist. Graphs do not live there, and this server does not go there.`);
  }
  if (extname(full).toLowerCase() !== '.json') {
    throw new Refused(`"${given}" is not a .json file. A graph is a .json file, and that is the only kind this server reads or writes.`);
  }
  const settings = candidatePaths(root).map((path) => fold(resolve(path)));
  if (basename(full).toLowerCase() === SETTINGS_FILENAME || settings.includes(fold(full))) {
    throw new Refused(`"${given}" is this machine's AI settings file. It holds credentials, and no tool here opens it.`);
  }
}

/** A `{ nodes: [...] }` object. `parseGraph` forgives a missing `nodes`, and `package.json` is missing one. */
function graphShaped(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && Array.isArray((raw as { nodes?: unknown }).nodes);
}

// ---------------------------------------------------------------------------
// What is wrong with a graph
// ---------------------------------------------------------------------------

/** One thing to fix: where it is, what it is, and what to do about it. */
export interface Problem {
  where: string;
  problem: string;
  fix: string;
}

const names = (ids: Iterable<string>): string => [...ids].map((id) => `"${id}"`).join(', ') || '(none)';

/** The ports *node* really has -- derived where the engine derives them, declared where a person names them. */
function portsOf(node: GraphNode): { inputs: Set<string>; outputs: Set<string>; derived: boolean } {
  const element = registry.node(node.node_type);
  let derived: ReturnType<NonNullable<typeof element>['derivedPorts']> = null;
  try {
    derived = element?.derivedPorts(node) ?? null;
  } catch {
    // Settings too broken to derive from. The declared ports are the best guess left.
  }
  const ids = (ports: unknown): string[] => (Array.isArray(ports) ? ports : [])
    .map((port) => (port as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === 'string');

  const inputs = new Set(ids(derived ? derived.inputs : node.inputs));
  const outputs = new Set(ids(derived ? derived.outputs : node.outputs));
  // The input every node has and none declares.
  inputs.add(RUN_PORT);
  // A node told to catch its own failure grows the port the executor puts it on.
  if (element?.catchesErrors(node)) outputs.add(ERROR_PORT);
  return { inputs, outputs, derived: derived !== null };
}

/** The nodes a cycle is made of: whatever is left once everything with a free end is taken away. */
function knot(graph: Graph, feedback: Set<string>): string[] {
  const left = new Set(graph.nodes.map((node) => node.id));
  for (let changed = true; changed;) {
    changed = false;
    const live = graph.edges.filter((edge) => !feedback.has(edge.id)
      && left.has(edge.source_node_id) && left.has(edge.target_node_id));
    for (const id of [...left]) {
      if (live.some((edge) => edge.target_node_id === id) && live.some((edge) => edge.source_node_id === id)) continue;
      left.delete(id);
      changed = true;
    }
  }
  return [...left];
}

/**
 * Everything that would make *graph* parse, open, and then not work.
 *
 * These are the mistakes a model actually makes, and each one is silent at run
 * time: an edge to a port that does not exist delivers nothing and fails
 * nothing; a graph ending in a code node computes the answer and shows nobody.
 * So they are found here, by name, with the repair spelled out -- the reader is
 * a model, and a model fixes what it is told precisely.
 */
function problemsIn(graph: Graph): Problem[] {
  const problems: Problem[] = [];

  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const node of graph.nodes) (seen.has(node.id) ? duplicated : seen).add(node.id);
  for (const id of duplicated) {
    problems.push({
      where: `node "${id}"`,
      problem: 'More than one node has this id.',
      fix: 'Give every node its own id, and point each edge at the one it means.',
    });
  }

  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  for (const node of graph.nodes) {
    const where = `node "${node.id}"`;
    const element = registry.node(node.node_type);
    if (!element) {
      problems.push({
        where,
        problem: `Unknown node_type "${node.node_type}".`,
        fix: `Use one of: ${registry.nodeTypes().join(', ')}. Anything else -- a merge, a split, a filter -- is a "code" node.`,
      });
      continue;
    }

    if (node.node_type === 'code' && !String(node.config.code ?? '').trim()) {
      problems.push({
        where,
        problem: node.config.code_file
          ? `config.code is empty and its code_file "${String(node.config.code_file)}" could not be read from beside the graph.`
          : 'A code node with no config.code: it fails the moment it runs.',
        fix: 'Put the body in config.code as "function run(inputs) { ... }", returning an object keyed by this node\'s output port ids.',
      });
    }

    if (element.hasInterface && Array.isArray(node.config.gui_widgets)) {
      const blocks = new Set<string>();
      for (const raw of node.config.gui_widgets) {
        const block = parseWidget(raw);
        if (!block.id) {
          problems.push({ where, problem: `A "${block.kind}" block has no id.`, fix: 'Give every block an id; its ports are named after it ("<id>_in", "<id>_out").' });
        } else if (blocks.has(block.id)) {
          problems.push({ where, problem: `More than one block has the id "${block.id}".`, fix: 'Give every block on the page its own id.' });
        }
        blocks.add(block.id);
        if (!registry.widget(block.kind)) {
          problems.push({
            where: `${where}, block "${block.id}"`,
            problem: `Unknown block kind "${block.kind}".`,
            fix: `Use one of: ${registry.widgetKinds().join(', ')}.`,
          });
        }
      }
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    const where = `edge "${edge.id}"`;
    if (edgeIds.has(edge.id)) {
      problems.push({ where, problem: 'More than one edge has this id.', fix: 'Give every edge its own id.' });
    }
    edgeIds.add(edge.id);

    for (const end of ['source', 'target'] as const) {
      const nodeId = end === 'source' ? edge.source_node_id : edge.target_node_id;
      const portId = end === 'source' ? edge.source_port_id : edge.target_port_id;
      const node = byId.get(nodeId);
      if (!node) {
        problems.push({
          where,
          problem: `Its ${end} is node "${nodeId}", and there is no such node.`,
          fix: `Point it at one of: ${names(byId.keys())} -- or add the node.`,
        });
        continue;
      }
      // An unknown node type has been reported already, and has no ports to be wrong about.
      if (!registry.node(node.node_type)) continue;
      const ports = portsOf(node);
      const side = end === 'source' ? ports.outputs : ports.inputs;
      if (side.has(portId)) continue;
      const kind = end === 'source' ? 'output' : 'input';
      problems.push({
        where,
        problem: `Its ${end} port "${portId}" is not an ${kind} of node "${nodeId}".`,
        fix: ports.derived
          ? `The ports of a${node.node_type === 'input' ? 'n' : ''} ${node.node_type} node are derived from its settings, not from what the document declares. `
            + `Its ${kind}s are: ${names([...side].filter((id) => id !== RUN_PORT))}. Wire to one of those, or change the settings that produce them.`
          : `Its ${kind}s are: ${names([...side].filter((id) => id !== RUN_PORT))}. Wire to one of those, or declare "${portId}" in the node's ${kind}s.`,
      });
    }
  }

  // With two nodes sharing an id the ordering cannot be trusted either way, and
  // the duplicate is the thing to fix first.
  if (!duplicated.size) {
    const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, registry);
    try {
      topologicalLevels(graph.nodes, graph.edges, feedback);
    } catch {
      problems.push({
        where: `nodes ${names(knot(graph, feedback))}`,
        problem: 'These nodes feed each other in a circle, so none of them can run first.',
        fix: 'A loop is only allowed through a node that remembers: a gui block (the page keeps what it shows) closes one. '
          + 'Route the value back through a gui node, or remove one of the edges.',
      });
    }
  }

  if (!graph.nodes.some((node) => node.node_type === 'output' || registry.node(node.node_type)?.hasInterface)) {
    problems.push({
      where: 'graph',
      problem: 'Nothing a person can see: there is no gui node and no output node, so a run computes its answer and shows nobody.',
      fix: 'End every branch in an "output" node (config.write_mode "window" plus an output_label, or "file"), or in a "gui" node with a block that displays the value.',
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

export interface GraphToolsOptions {
  /** The one folder the tools may touch. */
  root: string;
  /** The model `generate_graph` asks. */
  ai: AiService;
  /** What a run runs on; asked for per run, so a settings change is picked up. */
  runtime: () => Runtime;
  /** Which model generation uses. Empty provider or model means none is configured. */
  target: () => Promise<{ provider: string; model: string }>;
  /** Strings that must never appear in a result, whatever produced it. */
  secrets?: () => string[];
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface GraphTools {
  specs: ToolSpec[];
  /** Never throws: a failure is a result with `isError`, because it is a turn in a conversation. */
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

const SPECS: ToolSpec[] = [
  {
    name: 'authoring_guide',
    description: 'How to write an AI-Graph graph document yourself: the JSON shape, where each node type keeps what it does, '
      + 'the port names the engine derives, how a page starts a run, and one complete example. Read this before writing a '
      + 'graph by hand, then use validate_graph and save_graph. No model on this machine is needed for that route.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'generate_graph',
    description: 'Have the generation model configured on this machine design a whole graph from a description. Returns the '
      + 'graph, the model\'s explanation and any problems validation found. With save_as, a graph without problems is also '
      + 'written there. If no model is configured, use authoring_guide and save_graph instead.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: `What the graph should do, in plain words. At most ${MAX_DESCRIPTION_CHARS} characters.` },
        save_as: { type: 'string', description: 'Optional .json path, relative to the server\'s folder, to save the graph to.' },
      },
      required: ['description'],
      additionalProperties: false,
    },
  },
  {
    name: 'validate_graph',
    description: 'Check a graph without saving or running it. Give either the graph itself or the path of a saved one. '
      + 'Returns a list of problems -- unknown node types, duplicate ids, edges to nodes or ports that do not exist, cycles, '
      + 'code nodes without code, a graph that shows nothing -- each with how to fix it. An empty list means valid.',
    parameters: {
      type: 'object',
      properties: {
        graph: { type: 'object', description: 'A graph document: { metadata, nodes, edges }.' },
        path: { type: 'string', description: 'A saved graph, as a .json path relative to the server\'s folder.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'save_graph',
    description: 'Validate a graph and write it as pretty JSON. Refuses, and returns the problems, when validation finds '
      + 'any. Only .json files inside the server\'s folder; an existing file is replaced only if it is already a graph.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Where to write, as a .json path relative to the server\'s folder.' },
        graph: { type: 'object', description: 'The graph document: { metadata, nodes, edges }.' },
      },
      required: ['path', 'graph'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_graph',
    description: 'Run a saved graph once and report what happened: the overall status, each node\'s status and error, and '
      + `each node's outputs with every value cut to about ${VALUE_LIMIT} characters. Runs the graph's code and calls its `
      + 'models for real. inputs answers what the graph asks (key = node id, or "nodeId::blockId" for a block on a page). '
      + 'trigger runs only what one page event starts, the way pressing that button would.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The saved graph, as a .json path relative to the server\'s folder.' },
        inputs: { type: 'object', additionalProperties: { type: 'string' }, description: 'Values by node id, or by "nodeId::blockId".' },
        trigger: {
          type: 'object',
          properties: { node_id: { type: 'string' }, port_id: { type: 'string' } },
          required: ['node_id'],
          additionalProperties: false,
          description: 'The page event to simulate: the gui node, and the output port of the block that fired ("<block id>_out").',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_graphs',
    description: 'The graphs saved under the server\'s folder: path, name and description of each.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** A run's value, short enough to send. What fits keeps its shape; what does not becomes its own beginning. */
function brief(value: unknown, limit = VALUE_LIMIT): unknown {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  if (text.length <= limit) return value;
  return `${text.slice(0, limit)}… (+${text.length - limit} characters)`;
}

const briefAll = (values: Record<string, unknown> | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, brief(value)]));

/** Shapes a key tends to have, for the one that arrives from somewhere nobody configured. */
const KEY_SHAPED = /\b(sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g;

const json = (value: unknown): string => JSON.stringify(value, null, 2);
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The six tools, over one folder.
 *
 * Everything a tool needs from the machine arrives in *options*; nothing here
 * reads the environment, the settings file or the process. That is what makes
 * the confinement testable: the rules above are this function's, and a test
 * can hold the rest of the world still.
 */
export function createGraphTools(options: GraphToolsOptions): GraphTools {
  const root = resolve(options.root);
  let realRoot: Promise<string> | undefined;

  /** Rules 1, 2 and 4: the path a tool may use, or the refusal. */
  const confine = async (given: unknown, argument: string): Promise<string> => {
    if (typeof given !== 'string' || !given.trim()) {
      throw new Refused(`"${argument}" must be a .json path relative to the server's folder, such as "graphs/my_graph.json".`);
    }
    const full = resolve(root, given.trim());
    mustBeInside(root, full, given);
    // And again where it really leads: a link inside the root is a way out of it.
    realRoot ??= real(root);
    mustBeInside(await realRoot, await real(full), given);
    return full;
  };

  /** The path as the caller may see it: relative, forward slashes, nothing of the machine above the root. */
  const shown = (full: string): string => full.slice(root.length).split(sep).filter(Boolean).join('/');

  const scrub = (text: string): string => {
    let clean = text;
    for (const secret of options.secrets?.() ?? []) {
      if (typeof secret === 'string' && secret.length >= 8) clean = clean.split(secret).join('[redacted]');
    }
    return clean.replace(KEY_SHAPED, '[redacted]');
  };

  /** A graph argument, bounded and parsed. */
  const graphFrom = (raw: unknown, argument: string): Graph => {
    if (!graphShaped(raw)) {
      throw new NotAGraph(`"${argument}" must be a graph document: an object with a "nodes" array and an "edges" array. authoring_guide shows the shape.`);
    }
    if (JSON.stringify(raw).length > MAX_GRAPH_BYTES) {
      throw new Refused(`"${argument}" is larger than ${MAX_GRAPH_BYTES / 1024 / 1024} MB. A graph holds wiring and code, not data: keep the data in a file and read it with an input node.`);
    }
    let graph: Graph;
    try {
      graph = parseGraph(raw);
    } catch (error) {
      throw new NotAGraph(`"${argument}" is not a graph: ${message(error)}`);
    }
    // `parseGraph` is forgiving about shape on purpose; the code below it is
    // not, and "Cannot read properties of null" is not something a model can fix.
    for (const node of graph.nodes) {
      if (!Array.isArray(node.inputs) || !Array.isArray(node.outputs)) {
        throw new NotAGraph(`Node "${node.id}" in "${argument}": "inputs" and "outputs" must be arrays of ports, even when empty.`);
      }
      if (!node.config || typeof node.config !== 'object' || Array.isArray(node.config)) {
        throw new NotAGraph(`Node "${node.id}" in "${argument}": "config" must be an object.`);
      }
      const blocks = node.config.gui_widgets;
      if (Array.isArray(blocks) && blocks.some((block) => !block || typeof block !== 'object' || Array.isArray(block))) {
        throw new NotAGraph(`Node "${node.id}" in "${argument}": every entry of config.gui_widgets must be a block object.`);
      }
    }
    return graph;
  };

  /** A graph file's JSON, or the refusal -- including "that is JSON, but not a graph". */
  const readGraphFile = async (full: string, given: string): Promise<Graph> => {
    let text: string;
    try {
      if ((await stat(full)).size > MAX_GRAPH_BYTES) throw new Refused(`"${given}" is larger than ${MAX_GRAPH_BYTES / 1024 / 1024} MB, which no graph is.`);
      text = await readFile(full, 'utf8');
    } catch (error) {
      if (error instanceof Refused) throw error;
      throw new Refused(`There is no graph at "${given}". list_graphs shows what is saved.`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new NotAGraph(`"${given}" is not valid JSON: ${message(error)}`);
    }
    if (!graphShaped(raw)) throw new NotAGraph(`"${given}" is JSON but not a graph: it has no "nodes" array.`);
    return graphFrom(raw, given);
  };

  /**
   * Fill each body kept in a file beside the graph, the way the editor's Open
   * does: a graph saved from the editor holds `code_file: "Analyse.js"` and an
   * empty `code`, and running that as it stands is running nothing.
   *
   * `code_file` is a string out of the document, so it gets rule 1 like any
   * other path -- except for the extension, which is the node file's own.
   */
  const fillNodeFiles = async (graph: Graph, graphPath: string): Promise<void> => {
    for (const { folder, item } of authoredItems(graph, nodeDir(graphPath))) {
      if (!item.fileName) continue;
      const file = resolve(folder, item.fileName);
      realRoot ??= real(root);
      if (!isUnder(root, file) || !isUnder(await realRoot, await real(file))) {
        throw new Refused(`"${item.ident}" keeps its body in "${item.fileName}", which is outside the folder this server is confined to.`);
      }
      if (!existsSync(file)) continue;
      const { header, body } = parse(await readFile(file, 'utf8'), item.fileName);
      apply(item, header, body);
    }
  };

  const loadGraph = async (given: unknown): Promise<{ graph: Graph; full: string }> => {
    const full = await confine(given, 'path');
    const graph = await readGraphFile(full, String(given));
    await fillNodeFiles(graph, full);
    return { graph, full };
  };

  /**
   * Validate, then write. Returns the problems instead of writing when there
   * are any: a graph saved broken is a graph somebody opens later and blames
   * the editor for.
   */
  const saveGraph = async (given: unknown, argument: string, graph: Graph): Promise<{ saved?: string; problems: Problem[] }> => {
    const full = await confine(given, argument);
    // Rule 3. Looked at before anything is written, and by reading it: a name
    // says nothing about what a file is.
    if (existsSync(full)) {
      try {
        await readGraphFile(full, String(given));
      } catch {
        throw new Refused(`"${String(given)}" already exists and is not a graph, so it is not overwritten. Choose another name.`);
      }
    }

    // A body written into the document is the body. Left beside a `code_file`
    // it would lose to that file the next time the editor opened the graph,
    // and what was saved would not be what ran.
    for (const { item } of authoredItems(graph, '')) {
      if (item.fileName && item.body.trim()) item.fileName = '';
    }

    const checked = parseGraph(JSON.parse(JSON.stringify(graph)));
    await fillNodeFiles(checked, full);
    const problems = problemsIn(checked);
    if (problems.length) return { problems };

    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
    return { saved: shown(full), problems };
  };

  const tools: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
    async authoring_guide() {
      return [
        GRAPH_SYSTEM,
        '---',
        'Using this through the ai-graph MCP server',
        '',
        'The instruction above to answer with a fenced json block is written for a model replying in a chat. Here, build the '
        + 'same document and pass it as the "graph" argument: validate_graph checks it, save_graph writes it, run_graph tries it. '
        + 'Fix what validate_graph reports before saving; save_graph refuses a graph with problems.',
        '',
        `Node types this engine runs: ${registry.nodeTypes().join(', ')}.`,
        `Block kinds a gui node can hold: ${registry.widgetKinds().join(', ')}.`,
        `The port every node accepts without declaring it: "${RUN_PORT}". A node with config.catch_errors = true also has an output "${ERROR_PORT}".`,
        'Paths inside a graph (an input node\'s file, an output node\'s target) are relative to the server\'s folder.',
      ].join('\n');
    },

    async generate_graph(args) {
      const description = args.description;
      if (typeof description !== 'string' || !description.trim()) throw new Refused('"description" must say what the graph should do.');
      if (description.length > MAX_DESCRIPTION_CHARS) {
        throw new Refused(`"description" is ${description.length} characters; the limit is ${MAX_DESCRIPTION_CHARS}. Describe the graph, and leave the data it will read in a file.`);
      }
      // Before the model is asked, not after: a minute of generation that ends
      // in "you cannot save there" is a minute nobody gets back.
      if (args.save_as !== undefined) await confine(args.save_as, 'save_as');

      const otherwise = 'The other way needs no model here: call authoring_guide, write the graph yourself, then validate_graph and save_graph.';
      const target = await options.target();
      if (!target.provider || !target.model) {
        throw new Refused(`No generation model is configured on this machine (Settings in the AI-Graph editor, or AI_GRAPH_GEN_PROVIDER and AI_GRAPH_GEN_MODEL). ${otherwise}`);
      }

      let generated: { graph: unknown; explanation: string };
      try {
        generated = await generateGraph(description, '', { ai: options.ai, target });
      } catch (error) {
        throw new Refused(`Generation with ${target.provider} / ${target.model} failed: ${message(error).slice(0, ERROR_LIMIT)}\n`
          + `If that model is not set up or not running, configure one in the AI-Graph editor's Settings. ${otherwise}`);
      }

      const graph = graphFrom(generated.graph, 'the generated document');
      const report: Record<string, unknown> = { model: `${target.provider} / ${target.model}` };
      if (args.save_as !== undefined) {
        const { saved, problems } = await saveGraph(args.save_as, 'save_as', graph);
        Object.assign(report, saved
          ? { saved, problems }
          : { saved: false, why: 'The generated graph has problems, so it was not written. Fix them and hand the result to save_graph.', problems });
      } else {
        report.problems = problemsIn(graph);
      }
      return json({ ...report, explanation: generated.explanation, graph });
    },

    async validate_graph(args) {
      if ((args.graph === undefined) === (args.path === undefined)) {
        throw new Refused('Give exactly one of "graph" (the document itself) or "path" (a saved one).');
      }
      let graph: Graph;
      try {
        graph = args.path !== undefined ? (await loadGraph(args.path)).graph : graphFrom(args.graph, 'graph');
      } catch (error) {
        // A path that may not be opened is a refusal. A document that is not a
        // graph is an answer to the question that was asked.
        if (!(error instanceof Refused) || /confined to|dot-folder|\.json file|settings file|cannot be trusted|There is no graph/.test(error.message)) throw error;
        return json({ valid: false, problems: [{ where: 'graph', problem: error.message, fix: 'A graph is { "metadata": {...}, "nodes": [...], "edges": [...] }; authoring_guide shows a complete one.' }] });
      }
      const problems = problemsIn(graph);
      return json({ valid: problems.length === 0, problems });
    },

    async save_graph(args) {
      const graph = graphFrom(args.graph, 'graph');
      const { saved, problems } = await saveGraph(args.path, 'path', graph);
      if (!saved) throw new Refused(json({ saved: false, why: 'The graph has problems, so nothing was written.', problems }));
      return json({ saved, nodes: graph.nodes.length, edges: graph.edges.length });
    },

    async run_graph(args) {
      const { graph } = await loadGraph(args.path);

      const given = args.inputs ?? {};
      if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Refused('"inputs" must be an object of values by node id.');
      const inputs = Object.fromEntries(Object.entries(given as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]));
      const nodeIds = new Set(graph.nodes.map((node) => node.id));
      const unknown = Object.keys(inputs).filter((key) => !nodeIds.has(key.split('::')[0]));

      let trigger: Trigger | null = null;
      if (args.trigger !== undefined && args.trigger !== null) {
        const asked = args.trigger as { node_id?: unknown; port_id?: unknown };
        if (typeof asked !== 'object' || typeof asked.node_id !== 'string' || !nodeIds.has(asked.node_id)) {
          throw new Refused(`"trigger.node_id" must name a node of this graph: ${names(nodeIds)}.`);
        }
        trigger = { node_id: asked.node_id, port_id: typeof asked.port_id === 'string' ? asked.port_id : null };
      }

      const asked = runtimeRequirements(graph, registry);
      const answers = withDefaults(asked, inputs);
      applyRuntimeValues(graph, answers, registry);

      const result = await executeGraph(graph, { runtime: options.runtime(), registry, trigger });
      const unanswered = asked.filter((requirement) => !answers[requirement.key]);
      return json({
        status: result.status,
        ...(result.error ? { error: brief(result.error, ERROR_LIMIT) } : {}),
        nodes: result.node_results.map((node) => ({
          id: node.node_id,
          status: node.status,
          ...(node.error ? { error: brief(node.error, ERROR_LIMIT) } : {}),
          outputs: briefAll(node.outputs),
        })),
        // Keyed the way the graph's output nodes asked, which is what "the result" means to whoever built it.
        outputs: Object.fromEntries(Object.entries(result.outputs).map(([label, values]) =>
          [label, briefAll(values as Record<string, unknown>)])),
        ...(unanswered.length ? {
          unanswered: unanswered.map(({ key, label, kind }) => ({ key, label, kind })),
          hint: 'The graph asks for these and got nothing. Pass them in "inputs", by key.',
        } : {}),
        ...(unknown.length ? { ignored_inputs: unknown } : {}),
      });
    },

    async list_graphs() {
      const graphs: { path: string; name: string; description: string; nodes: number }[] = [];
      let examined = 0;
      let cut = false;

      const walk = async (dir: string, depth: number): Promise<void> => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        // Sorted, so the same folder lists the same way twice.
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (graphs.length >= LIST_LIMIT || examined >= LIST_EXAMINED) { cut = true; return; }
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || SKIPPED_FOLDERS.has(entry.name.toLowerCase())) continue;
            if (depth < LIST_DEPTH) await walk(full, depth + 1);
            continue;
          }
          if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.json') continue;
          try {
            // The same door as every other read, so the same files stay shut.
            await confine(full, 'path');
            examined += 1;
            const graph = await readGraphFile(full, entry.name);
            graphs.push({
              path: shown(full),
              name: graph.metadata.name,
              description: graph.metadata.description,
              nodes: graph.nodes.length,
            });
          } catch {
            // Not a graph, or not ours to open. Either way, not in the list.
          }
        }
      };

      await walk(root, 1);
      return json({ graphs, ...(cut ? { truncated: `Stopped after ${graphs.length} graphs; there may be more.` } : {}) });
    },
  };

  return {
    specs: SPECS,

    async call(name, args) {
      const tool = Object.prototype.hasOwnProperty.call(tools, name) ? tools[name] : undefined;
      if (!tool) return { text: `There is no tool named "${name}". The tools are: ${SPECS.map((spec) => spec.name).join(', ')}.`, isError: true };
      try {
        const given = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
        return { text: scrub(await tool(given)) };
      } catch (error) {
        // A refusal is already a sentence for the caller. Anything else is a
        // bug or the machine, and is said briefly: a stack trace is a map of
        // this computer, and nobody asked for one.
        const text = error instanceof Refused ? error.message : `${name} failed: ${message(error).slice(0, ERROR_LIMIT)}`;
        return { text: scrub(text), isError: true };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// stdio: JSON-RPC, one message per line
// ---------------------------------------------------------------------------

/** Newest first. The client's version is echoed when it is one of these; otherwise it is offered the first. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'ai-graph', version: '1.0.0' };

export interface StdioStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Where anything that is not protocol goes. Never `output`. */
  log?: NodeJS.WritableStream;
}

interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

/**
 * Serve *tools* until the input ends.
 *
 * **The output stream carries protocol messages and nothing else.** The client
 * parses every line of it; one stray `console.log` is a parse error on the far
 * side and a tool that "randomly disconnects". Anything worth saying to a
 * person goes to `log`.
 *
 * Requests are answered as they finish, not in the order they arrived: a
 * generation takes a minute, and a `ping` sent meanwhile is the client asking
 * whether this process is still alive. Every line is written whole, so answers
 * cannot interleave.
 *
 * Nothing a client sends ends the loop. A line that is not JSON, a method that
 * does not exist and a tool that throws each get their answer, and the next
 * line is read.
 */
export function serveStdio(
  tools: GraphTools,
  streams: StdioStreams = { input: process.stdin, output: process.stdout, log: process.stderr },
): Promise<void> {
  const { input, output, log } = streams;
  const running = new Set<Promise<void>>();

  const send = (answer: { id: number | string | null; result?: unknown; error?: { code: number; message: string } }): void => {
    output.write(`${JSON.stringify({ jsonrpc: '2.0', ...answer })}\n`);
  };

  const handle = async (line: string): Promise<void> => {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
    } catch {
      // The one answer with no id to carry: the id was in what could not be read.
      return send({ id: null, error: { code: -32700, message: 'Parse error: that line is not JSON. One JSON-RPC message per line.' } });
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      // Batches included: the protocol version this speaks took them out.
      return send({ id: null, error: { code: -32600, message: 'Invalid request: expected one JSON-RPC object.' } });
    }

    const { id, method, params } = request;
    if (typeof method !== 'string') {
      // An answer to a question this server never asked. Nothing to do with it.
      if ('result' in request || 'error' in request) return;
      return send({ id: id ?? null, error: { code: -32600, message: 'Invalid request: no method.' } });
    }
    // Notifications get no answer; that is what makes them notifications.
    // `notifications/initialized` and `notifications/cancelled` both end here.
    if (id === undefined || id === null) return;

    if (method === 'initialize') {
      const wanted = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      return send({
        id,
        result: {
          protocolVersion: typeof wanted === 'string' && PROTOCOL_VERSIONS.includes(wanted) ? wanted : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: 'Designs, checks, saves and runs AI-Graph graphs inside one folder. To write a graph yourself, read '
            + 'authoring_guide first; to have this machine\'s model write one, use generate_graph. Validate before saving.',
        },
      });
    }
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') {
      return send({
        id,
        result: { tools: tools.specs.map((spec) => ({ name: spec.name, description: spec.description, inputSchema: spec.parameters })) },
      });
    }
    if (method === 'tools/call') {
      const { name, arguments: given } = (params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof name !== 'string' || !tools.specs.some((spec) => spec.name === name)) {
        return send({ id, error: { code: -32602, message: `Unknown tool: ${String(name)}` } });
      }
      let result: ToolResult;
      try {
        result = await tools.call(name, (given ?? {}) as Record<string, unknown>);
      } catch (error) {
        // `call` promises not to throw. This is for the day a change breaks that promise.
        result = { text: `${name} failed: ${message(error)}`, isError: true };
      }
      return send({ id, result: { content: [{ type: 'text', text: result.text }], ...(result.isError ? { isError: true } : {}) } });
    }
    return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  };

  const start = (line: string): void => {
    const work: Promise<void> = handle(line)
      .catch((error) => { log?.write(`ai-graph mcp: ${message(error)}\n`); })
      .finally(() => { running.delete(work); });
    running.add(work);
  };

  return new Promise((done) => {
    let buffered = '';
    /** Inside a line that was too long: everything up to its newline is the rest of it. */
    let skipping = false;
    let ended = false;

    const finish = (): void => {
      if (ended) return;
      ended = true;
      // Closing stdin is how a client says goodbye; what it already asked for still gets its answer.
      void Promise.allSettled([...running]).then(() => done());
    };

    input.setEncoding('utf8');
    input.on('data', (chunk: string | Buffer) => {
      buffered += String(chunk);
      let end: number;
      while ((end = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, end).trim();
        buffered = buffered.slice(end + 1);
        if (skipping) { skipping = false; continue; }
        if (line) start(line);
      }
      if (buffered.length > MAX_LINE_CHARS) {
        // Bounded, or one client with no newline key fills this process's memory.
        if (!skipping) send({ id: null, error: { code: -32700, message: `Message too large: a line may be at most ${MAX_LINE_CHARS} characters.` } });
        skipping = true;
        buffered = '';
      }
    });
    input.on('end', finish);
    input.on('close', finish);
    input.on('error', finish);
    // A client that left without saying so: writing to it raises EPIPE on the
    // *stream*, and an unhandled stream error ends the process mid-run.
    output.on('error', () => {});
  });
}

// ---------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------

/** Every string on this machine that a result must not contain. Read fresh each time: keys change while a server runs. */
function machineSecrets(): string[] {
  const found: string[] = Object.values(configuredSettings().apiKeys ?? {});
  const secretive = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
  for (const [name, value] of Object.entries(process.env)) {
    if (value && secretive.test(name)) found.push(value);
  }
  for (const server of Object.values(configuredMcpServers())) {
    if ('headers' in server) found.push(...Object.values(server.headers ?? {}));
    if ('env' in server) {
      for (const [name, value] of Object.entries(server.env ?? {})) if (secretive.test(name)) found.push(value);
    }
  }
  return found.filter((value) => typeof value === 'string' && value.length >= 8);
}

/**
 * `node engine/src/main.ts --mcp [--mcp-root <dir>]`.
 *
 * The root defaults to where the client started this process, which for Claude
 * Code is the project it was opened in. The process moves *into* the root, so
 * a relative path inside a graph -- `data/sales.csv` on an input node -- means
 * the same thing here as the path arguments do.
 */
export async function runMcpServer(options: { root?: string } = {}): Promise<void> {
  const root = resolve(options.root ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`--mcp-root: ${root} is not a folder.`);
  }
  process.chdir(root);

  // stdout belongs to the protocol. Nothing in the engine prints to it, and
  // this is for the dependency-free day somebody adds a `console.log` anyway.
  const toStderr = (...parts: unknown[]): void => { process.stderr.write(`${parts.map(String).join(' ')}\n`); };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;

  // A server a client started is not watched by anyone. One rejected promise
  // in a run must cost that run, not every tool call after it.
  process.on('uncaughtException', (error) => toStderr('ai-graph mcp:', message(error)));
  process.on('unhandledRejection', (error) => toStderr('ai-graph mcp:', message(error)));

  const tools = createGraphTools({
    root,
    // Built per call, like the runtime: a key saved in the editor while this
    // server runs is the key the next generation uses.
    ai: { complete: (request) => nodeRuntime().ai.complete(request) },
    runtime: () => nodeRuntime(),
    target: () => generationTarget('', ''),
    secrets: machineSecrets,
  });

  process.stderr.write(`ai-graph MCP server on stdio, confined to ${root}\n`);
  await serveStdio(tools);
}
