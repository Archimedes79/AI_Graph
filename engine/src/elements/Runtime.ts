// The world an element is allowed to touch.
//
// Services arrive as a `Runtime`, never as an import. An element that imported
// the filesystem could only ever run where a filesystem exists, and could only
// be tested by monkey-patching a module. Passed in, the same element runs on a
// server (`host/node.ts`), in a browser tab and inside a test with fakes.

import type { ExecutionResult, Graph } from '../graph.ts';
import type { Runners } from './NodeRunner.ts';

/** Reading and writing files, wherever this engine happens to run. */
export interface FileService {
  read(path: string, mode?: 'text' | 'binary'): Promise<string>;
  write(path: string, content: string, mode?: 'text' | 'binary'): Promise<void>;
  list(path: string, options?: { recursive?: boolean; extensions?: string[] }): Promise<string[]>;
  resolve(path: string): string;
  exists(path: string): Promise<boolean>;
}

/**
 * What a body is handed besides its inputs: its second argument, `node`.
 *
 * A body runs where the keys are not -- a separate process that may read files
 * and nothing else of this machine's. So what needs the keys is not given to
 * it; it is *asked for*. `calls` are those questions: each becomes an async
 * function on `node` that sends its one argument out to the process holding
 * the graph and resolves to the answer. `data` is plain JSON put on `node` as
 * it is. Both must survive `JSON.stringify`.
 */
export interface BodyContext {
  data?: Record<string, unknown>;
  calls?: Record<string, (args: unknown) => Promise<unknown>>;
}

/** Running an authored body: `run(inputs, node) -> outputs`, inputs and outputs plain JSON. */
export interface CodeService {
  /** `signal` ends the body early: a run that was stopped must not leave one grinding on. */
  run(
    body: string,
    inputs: Record<string, unknown>,
    signal?: AbortSignal,
    context?: BodyContext,
  ): Promise<Record<string, unknown>>;
}

/** One tool a model may call: a name, what it is for, and a JSON schema of its arguments. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * The tools offered with one request, and the way to call one.
 *
 * Carried on the request rather than known to the provider layer: that layer
 * speaks three dialects of "the model wants to call something" and should not
 * also have to know where the something lives.
 */
export interface ToolAccess {
  specs: ToolSpec[];
  /** *stop* is the run's: a tool call is where a stopped run would otherwise sit and wait. */
  call(name: string, args: Record<string, unknown>, stop?: AbortSignal): Promise<string>;
}

/** One completion from a model. */
export interface AiRequest {
  prompt: string;
  system?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  images?: string[];
  /** When set, the model may call these, and the answer is what it says once it has. */
  tools?: ToolAccess;
  /** Ends the call early. Put there by the executor for a run that can be stopped; no element sets it. */
  signal?: AbortSignal;
}

export interface AiService {
  complete(request: AiRequest): Promise<string>;
}

/** Tool servers opened for the length of one node's run, then closed. */
export interface ToolSession extends ToolAccess {
  close(): Promise<void>;
}

/**
 * Where tools come from: MCP servers, named by the graph.
 *
 * A name is either a URL -- a server reached over HTTP, the same class of
 * thing as calling a model -- or a name this *machine* has configured, which
 * is the only way a graph gets to start a program: a graph someone hands you
 * must not be able to choose a command line.
 */
export interface ToolService {
  open(servers: string[]): Promise<ToolSession>;
}

/** Progress, for a caller that wants to show it. Ignoring it is valid. */
export type ProgressEvent =
  | { type: 'node_start'; node_id: string }
  | { type: 'node_done'; node_id: string; status: string }
  | { type: 'batch'; node_id: string; done: number; total: number }
  | { type: 'activity'; node_id: string; message: string };

/**
 * Running a graph, for the element whose node holds one.
 *
 * Put there by the executor, the way the stop signal is: running a graph is
 * what the executor does, and everything an inner run must inherit -- the
 * registry, the signal, how deep it already is -- is known there and nowhere
 * else. An element only says "run this, with these results already known".
 */
export interface SubgraphService {
  run(graph: Graph, given: Record<string, Record<string, unknown>>): Promise<ExecutionResult>;
  /** The elements of this run, for asking about the nodes inside. */
  elements: Runners;
}

/** Everything an element may reach outside itself. */
export interface Runtime {
  files: FileService;
  code: CodeService;
  ai: AiService;
  /** Absent where no tool server can be reached; an element that wants one says so. */
  tools?: ToolService;
  /** Absent outside a run: only the executor can offer it. */
  subgraph?: SubgraphService;
  /** How often one run of a body may ask for the model (`node.llm`). Absent: the engine's own limit. */
  llmCallsPerBody?: number;
  /**
   * Whether this node's port is the event this round began with.
   *
   * An event is a moment, so what it puts on a wire is a boolean that is true
   * for the one round it started and false in every other -- a button says
   * "pressed just now", not how often. A run nobody's event started (▶ Run, the
   * command line, a graph inside a node) counts every event as having happened,
   * which is what "run everything" means. Absent outside a run, where an
   * element should take it to be true for the same reason.
   */
  fired?: (portId: string) => boolean;
  report?(event: ProgressEvent): void;
}
