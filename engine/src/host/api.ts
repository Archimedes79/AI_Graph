// The wire between the page and the engine: every route, and what travels each way.
//
// Two processes talk over HTTP -- Node runs graphs, the browser draws them --
// and they used to describe the conversation twice: the server built its
// replies by hand in `serve.ts`, and the page declared what it expected in
// `api/client.ts`. The two had drifted. The deployed tool's settings dialog read
// fields the server never sent and saved to a route that did not exist; its
// file picker expected entries with names and got entries without.
//
// So this file is the conversation, once. The server serves exactly this table
// (`serve.ts` fails to start if a route has no handler), the page calls it by
// name (`editor/src/api/client.ts`), and both are type-checked against the same
// request and response here. Types and one plain table only -- nothing that
// needs Node or a browser -- so either side can import it, and a bundle, which
// carries it, pays for a list.
//
// `for` is the security boundary. A `tool` route is what a deployed tool
// serves to whoever opens it; an `editor` route exists only while building,
// and a server without the editor answers it with 404.

import type { ExecutionResult, Graph, GraphNode, NodeResult } from '../graph.ts';
import type { Trigger } from '../execution/triggers.ts';
import type { ScheduleState } from './schedule.ts';
import type { TextChange } from '../project/changes.ts';
import type { ExampleRun } from '../execution/examples.ts';
import type { RuntimeRequirement } from '../execution/runtimeValues.ts';

export type { TextChange };

// ---------------------------------------------------------------------------
// What travels
// ---------------------------------------------------------------------------

/** The page event that asked for a run: the port it fired on. */
export type RunTrigger = Trigger;

/**
 * A run in flight, as a watching page sees it.
 *
 * `completed/total` counts nodes, which does not move while one node grinds
 * through a 500-item batch or one long model call; `item_done/item_total` and
 * `idle_seconds` are what move then -- the two cases that look like a hang.
 */
export interface RunSnapshot {
  run_id: string;
  done: boolean;
  cancelled: boolean;
  completed: number;
  total: number;
  current_label: string;
  item_done: number;
  item_total: number;
  /** Seconds since the running node last showed life; null before anything reported. */
  idle_seconds: number | null;
  error: string | null;
  result: ExecutionResult | null;
}

/**
 * A path the graph needs before it can run, as the "before running" dialog
 * asks for it: the engine's own question, keyed as its answer is written back
 * (`applyRuntimeValues`), so no end takes the key apart or builds it again.
 */
export type Requirement = RuntimeRequirement;

/** `project`: a folder with a `flow.json` in it, which opens rather than being walked into. */
export interface BrowseEntry { name: string; path: string; is_dir: boolean; project?: boolean }
/**
 * One directory, for a picker. A deployed tool lists files only: no parent, no drives.
 * `project`: the directory shown is a project itself.
 */
export interface BrowsePage { path: string; parent: string | null; entries: BrowseEntry[]; roots: string[]; project?: boolean }

/** Which model a deployed tool calls, and where that is configured. Read-only: see the route. */
export interface ToolAiSettings {
  provider: string;
  model: string;
  settings_file: string;
  settings_file_exists: boolean;
}

/** A model, already resolved: which provider, which of its models. */
export interface Target { provider: string; model: string }

/** Lets the page watch a generation's transcript while it runs. */
export interface Watched { progress_id?: string }

/**
 * One node's writing to do, as its ✨ asks it: its input definition
 * (input.js), its output definition (output.js), or its body -- code, an ai
 * node's prompt, a data node's data. The node's element decides the rest.
 */
export interface GenerateRequest {
  /**
   * The node as the editor holds it: its kind, id, heading and text -- what
   * everything is written from -- its ports, its definitions, its body, and
   * the ✨ prompts someone changed (`config.prompts`). Its history is not needed.
   */
  node: GraphNode;
  /** What to write: `input` (input.js), `output` (output.js), or the body (the default). */
  write?: 'input' | 'output' | 'body';
  /** The graph around the node, in words: what {Context} says. Built by the editor. */
  context?: string;
  /**
   * The files ✨ Input writes the input definition from -- examples, a spec:
   * {Example Files}. Their text is read here, the start of each, where the
   * request does not bring it.
   */
  input_files?: { path: string; text?: string }[];
  /** The files ✨ Output writes the output definition from, the same way: {Output Files}. */
  output_files?: { path: string; text?: string }[];
  /**
   * Where each input is wired from and what that node hands on, by port id:
   * {Input Definition} while the node has no input.js.
   */
  input_sources?: Record<string, string>;
  /**
   * Where each output goes, by port id, and what the node there wants of it --
   * `"Sizes" chart on "Dashboard" -- wants: the data to plot…`: {Output
   * Definition} while the node has no output.js.
   */
  output_targets?: Record<string, string>;
  /**
   * Change the body there is, instead of writing one from nothing: "Say what
   * to change" and ✨ Fix. The answer brings the node's text back restated
   * where there was something to change (`GenerateResponse.description`), so
   * the two are changed together.
   */
  refine?: Refine;
  /**
   * Build the request and hand it back without sending it: what ✨ *would*
   * send, through the same code that sends it, so the preview cannot differ.
   */
  preview?: boolean;
}

/** What came of the body there is, and what to change about it (`GenerateRequest.refine`). */
export interface Refine {
  /** What to change, in the person's words. Absent: repair it from how it failed (✨ Fix). */
  change?: string;
  /** What it gave on its example: its outputs as JSON, or a model's answer. */
  outcome?: string;
  /** The error it raised on its example. */
  error?: string;
  /** Where what it gave does not fit its output.js. */
  problems?: string[];
}

/** One request to a model, as it happened: for looking at when an answer is wrong or missing. */
export interface AICall {
  provider: string;
  model: string;
  system: string;
  prompt: string;
  /** Counted on the server, so the number has one source. */
  sent_chars: number;
  reply: string | null;
  reply_chars: number;
  seconds: number;
  error: string | null;
}

/**
 * What trying generated code on the node's example revealed -- the example in
 * its input.js, held to its output.js. `skipped`: there was nothing to try it
 * on; `ok` passed the first try, `repaired` the second.
 */
export interface ProbeReport {
  status: 'skipped' | 'ok' | 'repaired' | 'failed';
  /** How it failed, where it did not run. */
  error: string;
  /** Where what it returned does not fit its output.js, or misses an output. */
  problems: string[];
}

export interface GenerateResponse {
  /**
   * What was written: the whole file -- input.js, output.js, code.js,
   * prompt.md -- or, for a data node, the text of what it holds. Which field
   * it belongs in is the caller's business.
   */
  result: string;
  /**
   * The node's text, restated to fit a body changed as asked
   * (`GenerateRequest.refine` with a change): what the node says it does now.
   */
  description?: string;
  /**
   * The node's output definition, written anew with a body changed or fixed
   * (`refine`): the output.js a change needed where it outgrew the one there
   * was, or one that could not be read, corrected. The body was held to it;
   * it is written with the body, and the node's outputs are its keys.
   */
  output_definition?: string;
  probe: ProbeReport;
  /** Every model call this generation made, in order: what the node's history.md keeps. For a preview, the one request, unsent. */
  calls: AICall[];
}

/** The settings dialog's view of `ai-settings.json`: whether a key is set, never the key. */
export interface SettingsStatus {
  settings_file: string;
  /**
   * The one AI setting as the file saves it, '' for unset; `environment` names
   * the variables that set it on this machine instead, and win.
   */
  ai: { provider: string; model: string; environment: string[] };
  endpoints: Record<string, string>;
  credentials: Record<string, { configured: boolean; source: string }>;
}

export interface SettingsPatch {
  /** The one AI setting. A provider of 'default' or '' leaves it unset. */
  ai?: { provider?: string; model?: string };
  endpoints?: Record<string, string>;
  api_keys?: Record<string, string>;
  /** Providers whose stored key is to be removed -- distinct from "left blank". */
  clear_keys?: string[];
}

/** Which providers answer right now, and what the one AI setting resolves to. */
export interface ProviderStatus {
  local: Record<string, { reachable: boolean; models: string[] }>;
  /** What the one AI setting resolves to right now: what every call that names no model of its own goes to. */
  target: Target;
}

/** A graph file on disk, as Open (and so Reload) and Save return it. */
/** `project`: the path is a project folder, whose code and prompts are files of their own. */
export interface GraphFile { path: string; graph: Graph; project: boolean }

/** A failed call's body. A failed generation carries its transcript too. */
export interface Failure { detail: string; calls?: AICall[] }

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

export type Method = 'GET' | 'POST' | 'DELETE';

/**
 * One route. `Req` is everything the handler is handed -- the JSON body, the
 * query and `:params`, merged into one object -- and `Res` what it answers.
 * The two type parameters exist only for the compiler; at run time a route is
 * its method, path and audience.
 */
export interface Route<Req, Res> {
  method: Method;
  /** `:name` segments are path parameters, handed over as `name`. */
  path: string;
  for: 'tool' | 'editor';
  /** Phantom: carries the types, never set. */
  readonly types?: { request: Req; response: Res };
}

function route<Req, Res>(method: Method, path: string, audience: 'tool' | 'editor'): Route<Req, Res> {
  return { method, path, for: audience };
}

type RunGraph = Graph & { trigger?: RunTrigger | null };
type OnNode = Graph & { node_id: string };

export const API = {
  // -- what a deployed tool serves ------------------------------------------
  /** The graph this tool ships. */
  graph: route<void, Graph>('GET', '/api/runtime/graph', 'tool'),
  /** What the graph's own triggers (on start, on a clock) last produced. */
  schedule: route<void, ScheduleState>('GET', '/api/runtime/last', 'tool'),
  /** Which model the tool calls. Read-only: a recipient configures it in a file, not in a page. */
  toolAiSettings: route<void, ToolAiSettings>('GET', '/api/runtime/ai-settings', 'tool'),
  requirements: route<Graph, Requirement[]>('POST', '/api/execute/requirements', 'tool'),
  /** Start a run in the background: the graph, and beside it the page event that asked, if one did. */
  startRun: route<RunGraph, { run_id: string; total: number }>('POST', '/api/execute/start', 'tool'),
  /** Run to the end in one call, for a script driving a tool over HTTP rather than a page watching it. */
  runNow: route<Graph, ExecutionResult>('POST', '/api/execute/', 'tool'),
  run: route<{ id: string }, RunSnapshot>('GET', '/api/execute/runs/:id', 'tool'),
  stopRun: route<{ id: string }, { cancelled: boolean }>('POST', '/api/execute/runs/:id/cancel', 'tool'),
  /** Loopback only: listing directories is for the person at the keyboard. */
  browse: route<{ path: string; extensions?: string }, BrowsePage>('POST', '/api/files/browse', 'tool'),

  // -- what only the editor serves ------------------------------------------
  /** One node on the inputs given, as a run runs it: files read, lists fanned out. How the editor reads a file the way a run does. */
  runNode: route<OnNode & { inputs: Record<string, unknown> }, NodeResult>('POST', '/api/execute/node', 'editor'),
  /** What would arrive at a node: what feeds it is run, the node is not. */
  nodeInputs: route<OnNode, { inputs: Record<string, unknown>; error: string | null }>('POST', '/api/execute/inputs', 'editor'),
  /** ▶ Try: one call of a node on the example in its input.js, held to its output.js. */
  testNode: route<OnNode, ExampleRun>('POST', '/api/execute/example', 'editor'),

  /**
   * A project folder or a single graph file: see `project/folder.ts`. Also
   * Reload: the same path opened again, after its `flow.json`, or a node's
   * settings or ports, changed outside the editor.
   */
  openGraph: route<{ path: string }, GraphFile>('POST', '/api/graphs/file/load', 'editor'),
  /** A `.json` path is written as one file; any other path as a project folder. */
  saveGraph: route<{ path: string; graph: Graph }, GraphFile>('POST', '/api/graphs/file/save', 'editor'),
  /**
   * Project folders with this name under where the editor runs: for a folder
   * dropped onto the page -- and where that search looked, in words, for a drop
   * that finds none to say.
   */
  findProjects: route<{ name: string }, { paths: string[]; searched: string }>('GET', '/api/graphs/find', 'editor'),
  /**
   * Files of this name and size under where the editor runs: for a file
   * dropped onto a node, whose path a browser never says -- and where that
   * search looked, in words, for a drop that finds none to say.
   */
  findFile: route<{ name: string; size: string }, { paths: string[]; searched: string }>('GET', '/api/files/find', 'editor'),
  /** The code and prompts of an open project that changed on disk since last asked. */
  projectChanges: route<{ path: string }, { changes: TextChange[] }>('GET', '/api/graphs/file/changes', 'editor'),

  generate: route<GenerateRequest & Watched, GenerateResponse>('POST', '/api/ai/generate', 'editor'),
  /** What the generation with this id has sent and received so far. */
  generationProgress: route<{ id: string }, { calls: AICall[] }>('GET', '/api/ai/generate/progress', 'editor'),
  /**
   * A whole graph from a description: designed anew -- or, sent the graph
   * there is (`graph`), that graph changed as the description says, its ids
   * and what the change does not touch kept.
   */
  generateGraph: route<{ description: string; graph?: Graph } & Watched, { graph: Graph; explanation: string }>(
    'POST', '/api/ai/generate-graph', 'editor'),

  /** The graph as a deployable zip, named by the server (`<graph name>_bundle.zip`). */
  bundle: route<Graph, File>('POST', '/api/deploy/bundle', 'editor'),
  /**
   * Hand this server the graph to serve as a tool, so `runtime.html` can be
   * opened against it — the deployed page, in its own window, without zipping
   * anything first. The editor posts its graph with every run; this is the one
   * case where the server has to keep a copy, because the window that asks for
   * it is not the editor and has no graph of its own.
   */
  holdGraph: route<Graph, { ok: true }>('POST', '/api/runtime/hold', 'editor'),

  aiSettings: route<void, SettingsStatus>('GET', '/api/ai/settings', 'editor'),
  saveAiSettings: route<SettingsPatch, SettingsStatus>('POST', '/api/ai/settings', 'editor'),
  providers: route<void, ProviderStatus>('GET', '/api/ai/providers', 'editor'),

  /**
   * One of a node's files in a project, in the person's own editor: `file`,
   * named from the node's folder -- `input.js`, `history.md` -- or, without
   * it, its body (`nodes/<id>/code.js`). The node is one of the graph
   * `inside` leads down to: the ids of the nodes that hold it, outermost
   * first (`nodeFileOf`). Loopback only: it starts a program.
   */
  openExternal: route<{ graph_path: string; inside?: string[]; node_id: string; file?: string }, { path: string; with: string }>('POST', '/api/files/open-external', 'editor'),
} as const;

export type Api = typeof API;
export type RouteName = keyof Api;
export type RequestOf<K extends RouteName> = NonNullable<Api[K]['types']>['request'];
export type ResponseOf<K extends RouteName> = NonNullable<Api[K]['types']>['response'];

/**
 * Match a request against the table: which route, and its `:params`.
 *
 * Here rather than in the server because it is the table's own rule -- how a
 * path with parameters is read -- and the page's client writes paths by the
 * inverse of it (`pathFor`).
 */
export function matchRoute(method: string, path: string): { name: RouteName; params: Record<string, string> } | null {
  for (const name of Object.keys(API) as RouteName[]) {
    const candidate = API[name];
    if (candidate.method !== method) continue;
    const params = matchPath(candidate.path, path);
    if (params) return { name, params };
  }
  return null;
}

/** The concrete path for a route, with its `:params` filled in from the request. */
export function pathFor(name: RouteName, request: Record<string, unknown> = {}): { path: string; rest: Record<string, unknown> } {
  const rest = { ...request };
  const path = API[name].path.replace(/:([a-z_]+)/g, (_, key: string) => {
    const value = rest[key];
    delete rest[key];
    return encodeURIComponent(String(value ?? ''));
  });
  return { path, rest };
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) {
      // A broken escape (`%E0%A4%A`) is a path that names nothing, not a server that broke.
      try {
        params[want[i].slice(1)] = decodeURIComponent(got[i]);
      } catch {
        return null;
      }
    } else if (want[i] !== got[i]) return null;
  }
  return params;
}
