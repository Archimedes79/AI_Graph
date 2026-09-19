// The world an element is allowed to touch.
//
// Services arrive as a `Runtime`, never as an import. An element that imported
// the filesystem could only ever run where a filesystem exists, and could only
// be tested by monkey-patching a module. Passed in, the same element runs on a
// server (`host/node.ts`), in a browser tab and inside a test with fakes.

/** Reading and writing files, wherever this engine happens to run. */
export interface FileService {
  read(path: string, mode?: 'text' | 'binary'): Promise<string>;
  write(path: string, content: string, mode?: 'text' | 'binary'): Promise<void>;
  list(path: string, options?: { recursive?: boolean; extensions?: string[] }): Promise<string[]>;
  resolve(path: string): string;
  exists(path: string): Promise<boolean>;
}

/** Running an authored body: `run(inputs) -> outputs`, both plain JSON. */
export interface CodeRunner {
  /** `signal` ends the body early: a run that was stopped must not leave one grinding on. */
  run(body: string, inputs: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
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

/** Everything an element may reach outside itself. */
export interface Runtime {
  files: FileService;
  code: CodeRunner;
  ai: AiService;
  /** Absent where no tool server can be reached; an element that wants one says so. */
  tools?: ToolService;
  report?(event: ProgressEvent): void;
}
