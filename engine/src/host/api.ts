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

import type { ExecutionResult, Graph, NodeResult } from '../graph.ts';
import type { Trigger } from '../execution/triggers.ts';
import type { ScheduleState } from './schedule.ts';
import type { TextChange } from '../project/folder.ts';
import type { ExampleResult } from '../execution/examples.ts';

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
  running: string[];
  current_label: string;
  item_done: number;
  item_total: number;
  /** Seconds since the running node last showed life; null before anything reported. */
  idle_seconds: number | null;
  error: string | null;
  result: ExecutionResult | null;
}

/** A path the graph needs before it can run, as the "before running" dialog asks for it. */
export interface Requirement {
  node_id: string;
  /** The block inside a page that asks, when it is a block. */
  widget_id: string | null;
  label: string;
  kind: 'text' | 'file' | 'directory';
  direction: 'input' | 'output';
  current_value: string;
}

/** `project`: a folder with a `graph.json` in it, which opens rather than being walked into. */
export interface BrowseEntry { name: string; path: string; is_dir: boolean; project?: boolean }
/** One directory, for a picker. A deployed tool lists files only: no parent, no drives. */
export interface BrowsePage { path: string; parent: string | null; entries: BrowseEntry[]; roots: string[] }

/** Which model a deployed tool calls, and where that is configured. Read-only: see the route. */
export interface ToolAiSettings {
  provider: string;
  model: string;
  settings_file: string;
  settings_file_exists: boolean;
}

/** What one block shows for one value: the editor's ▶ Test of a block. */
export interface BlockResult { status: 'success' | 'error'; shown: unknown; error: string | null }

/** A model, already resolved: which provider, which of its models. */
export interface Target { provider: string; model: string }

/** Which model writes a generation, when the browser chose one. Empty means "the configured default". */
export interface ModelChoice { ai_provider?: string; ai_model?: string }

/** Lets the page watch a generation's transcript while it runs. */
export interface Watched { progress_id?: string }

/** One element's body to write. The element's own `Generation` decides the rest. */
export interface GenerateRequest {
  /** A node type or block kind. */
  element?: string;
  /** For the one generation that belongs to no element: an output-format description. */
  kind?: string;
  description: string;
  context?: string;
  /** A file whose content is appended to the context, read on the server. */
  context_file?: string;
  inputs?: string[];
  outputs?: string[];
  /** Real port values from the last run; enables the verify-and-repair pass. */
  sample_inputs?: Record<string, unknown> | null;
  input_sources?: Record<string, string>;
  /**
   * Input ports the running node is handed a file's text on, not the path the
   * wire carries (`read_file_inputs`). The sample holds what came off the wire,
   * so these are read, as a run reads them, before the sample is shown or used.
   */
  read_file_ports?: string[];
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

/** What running generated code against real data revealed. `skipped`: no sample, one pass. */
export interface ProbeReport {
  status: 'skipped' | 'ok' | 'repaired' | 'failed';
  attempts: number;
  error: string;
  missing_outputs: string[];
  /** What the element itself found wrong with a result that ran: a chart off its frame, NaN in the markup. */
  problems?: string[];
  output_preview: string;
  /** What the code actually returned, whole -- the next node's sample, not a peek at it. */
  outputs?: Record<string, unknown>;
}

export interface GenerateResponse {
  /** The generated text. Which field it belongs in is the caller's business. */
  result: string;
  explanation: string;
  probe: ProbeReport;
  /** Every model call this generation made, in order. */
  calls: AICall[];
}

/** The settings dialog's view of `ai-settings.json`: whether a key is set, never the key. */
export interface SettingsStatus {
  settings_file: string;
  settings_file_exists: boolean;
  endpoint_keys: Record<string, string>;
  endpoints: Record<string, string>;
  credentials: Record<string, { configured: boolean; source: string }>;
}

export interface SettingsPatch {
  endpoints?: Record<string, string>;
  api_keys?: Record<string, string>;
  /** Providers whose stored key is to be removed -- distinct from "left blank". */
  clear_keys?: string[];
  ai?: { provider?: string; model?: string; force?: boolean };
  codegen?: { provider?: string; model?: string };
}

/** Which providers answer right now, and where the two default targets resolve to. */
export interface ProviderStatus {
  local: Record<string, { reachable: boolean; models: string[] }>;
  runtime_target: Target;
  gen_target: Target;
}

/** A graph file on disk, as Open, Save and Reload return it. */
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
  /** The body is bytes, not JSON: handed over as `bytes` (and sent as the file itself). */
  raw?: true;
  /** Phantom: carries the types, never set. */
  readonly types?: { request: Req; response: Res };
}

function route<Req, Res>(method: Method, path: string, audience: 'tool' | 'editor', raw?: true): Route<Req, Res> {
  return raw ? { method, path, for: audience, raw } : { method, path, for: audience };
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
  /** One node on the inputs given: ▶ Test in a node's editor. */
  runNode: route<OnNode & { inputs: Record<string, unknown> }, NodeResult>('POST', '/api/execute/node', 'editor'),
  /** One value through one block's transform, as the page would show it. */
  runBlock: route<{ widget: unknown; value: unknown }, BlockResult>('POST', '/api/execute/block', 'editor'),
  /** What would arrive at a node: what feeds it is run, the node is not. */
  nodeInputs: route<OnNode, { inputs: Record<string, unknown>; error: string | null }>('POST', '/api/execute/inputs', 'editor'),
  /** Run a node's examples.md: each example's inputs, held to what it expects. */
  testNode: route<OnNode, { results: ExampleResult[] }>('POST', '/api/execute/examples', 'editor'),

  /** A project folder or a single graph file: see `project/folder.ts`. */
  openGraph: route<{ path: string }, GraphFile>('POST', '/api/graphs/file/load', 'editor'),
  /** A `.json` path is written as one file; any other path as a project folder. */
  saveGraph: route<{ path: string; graph: Graph }, GraphFile>('POST', '/api/graphs/file/save', 'editor'),
  /** Open the same path again: after `graph.json` itself changed outside the editor. */
  reloadGraph: route<{ path: string }, GraphFile>('POST', '/api/graphs/file/reload', 'editor'),
  /** The code and prompts of an open project that changed on disk since last asked. */
  projectChanges: route<{ path: string }, { changes: TextChange[] }>('GET', '/api/graphs/file/changes', 'editor'),

  generate: route<GenerateRequest & ModelChoice & Watched, GenerateResponse>('POST', '/api/ai/generate', 'editor'),
  /** What the generation with this id has sent and received so far. */
  generationProgress: route<{ id: string }, { calls: AICall[]; done: boolean }>('GET', '/api/ai/generate/progress', 'editor'),
  generateGraph: route<{ description: string; context?: string } & ModelChoice & Watched, { graph: Graph; explanation: string }>(
    'POST', '/api/ai/generate-graph', 'editor'),

  /** The graph as a deployable zip. */
  bundle: route<Graph, Blob>('POST', '/api/deploy/bundle', 'editor'),

  aiSettings: route<void, SettingsStatus>('GET', '/api/ai/settings', 'editor'),
  saveAiSettings: route<SettingsPatch, SettingsStatus>('POST', '/api/ai/settings', 'editor'),
  providers: route<void, ProviderStatus>('GET', '/api/ai/providers', 'editor'),

  detectFormat: route<{ path: string }, { format: string }>('POST', '/api/files/detect-format', 'editor'),
  /** A node's (or block's) body file in a project -- `nodes/<id>/code.js` -- in the person's own editor. Loopback only: it starts a program. */
  openExternal: route<{ graph_path: string; node_id: string; widget_id?: string }, { path: string; with: string }>('POST', '/api/files/open-external', 'editor'),
  /** The file is the body and its name rides on the query: nothing multipart to get wrong. */
  attach: route<{ name: string; bytes: Uint8Array | Blob }, { path: string; name: string }>('POST', '/api/files/attachments', 'editor', true),
  detach: route<{ path: string }, { ok: true }>('DELETE', '/api/files/attachments', 'editor'),
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
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}
