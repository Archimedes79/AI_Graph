// Tools for a model, from MCP servers.
//
// A client for the Model Context Protocol, and deliberately a small one: open a
// server, ask what tools it has, call them, close it. Resources, prompts,
// sampling and the rest of the protocol are not here, because nothing in a
// graph can use them yet and a client that half-implements them would have to
// be believed rather than read. The official SDK is not here either -- the
// engine has no runtime dependencies, which is what lets a bundle be a copy.
//
// **The security boundary is in `resolve` below, and it is one rule.** A graph
// names its tool servers, and a graph is a file somebody hands you. If that file
// could carry a command line, opening a graph would be running a stranger's
// program. So a graph may say one of two things only:
//
//   - a URL: a server reached over HTTP. The same class of thing as calling a
//     model -- bytes go out, bytes come back, nothing starts on this machine.
//   - a *name*, which means nothing until this machine's own `ai-settings.json`
//     says what it stands for. The command line lives there, written by the
//     person whose machine it is, and nowhere else.
//
// There is no third form, and no "just this once" parameter to add one.
//
// Like `host/node.ts`, this file knows an operating system exists: it starts
// processes. It is reached only from there, so the engine above still runs in a
// browser tab, where `runtime.tools` is simply absent.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import type { ToolService, ToolSession, ToolSpec } from '../elements/Runtime.ts';

/**
 * One configured server: a program to start, or a URL to talk to.
 *
 * The first shape is Claude Desktop's `mcpServers` entry, on purpose -- the
 * snippet every MCP server's README tells you to paste works here unchanged.
 */
export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { url: string; headers?: Record<string, string> };

/** The clocks. Arguments so a test can make them short, and a machine can set its own. */
export interface McpOptions {
  /** `initialize` and `tools/list`: a server that takes longer than this to say hello is not coming. */
  handshakeTimeoutMs?: number;
  /** One tool call. Longer, because a tool is allowed to do real work. 0 waits forever. */
  callTimeoutMs?: number;
}

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'ai-graph', version: '1.0.0' };
const HANDSHAKE_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;
/** How long a closed server gets to leave by itself before it is made to. */
const EXIT_GRACE_MS = 1_000;
/** How much of a server's stderr is worth quoting when it dies. */
const STDERR_TAIL = 1_500;

// ---------------------------------------------------------------------------
// JSON-RPC, the part both transports share
// ---------------------------------------------------------------------------

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * The server answered, and the answer was "no".
 *
 * Its own type because the two kinds of failure want opposite handling. This
 * one is part of the conversation -- a tool that does not exist, arguments that
 * do not validate -- and the model should get to read it and try again. A
 * transport that died is not: nothing the model says next will bring it back.
 */
export class McpRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = 'McpRpcError';
  }
}

/** One open connection, whichever way the bytes travel. */
interface Transport {
  /** *timeoutMs* 0 is no clock; *stop* is the run's, and ends the call wherever it is. */
  request(method: string, params: unknown, timeoutMs: number, stop?: AbortSignal): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  /** The version `initialize` settled on; HTTP has to repeat it on every request after. */
  negotiated(version: string): void;
  /** Best effort, and never throws: a close that fails has nobody to tell. */
  close(): Promise<void>;
}

function unwrap(message: RpcMessage): unknown {
  if (message.error) {
    throw new McpRpcError(message.error.code ?? 0, message.error.message ?? 'the server reported an error');
  }
  return message.result;
}

const seconds = (ms: number): string => `${Math.round(ms / 100) / 10} s`;

// ---------------------------------------------------------------------------
// stdio: a program this machine starts
// ---------------------------------------------------------------------------

/**
 * How to start *command* on this operating system.
 *
 * Everywhere but Windows this is nothing: hand the command and its arguments
 * to `spawn`. On Windows the commands people actually configure -- `npx`,
 * `uvx` -- are not programs but `.cmd` shims, and Node refuses to start one of
 * those without a shell (since the 2024 argument-injection fix, it fails with
 * a bare EINVAL). So the command is looked up the way the shell would, and only
 * a shim gets a shell; a real `.exe` is started directly, where arguments need
 * no quoting and killing the child kills the server rather than a `cmd.exe`
 * standing in front of it.
 */
function launchPlan(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): { command: string; args: string[]; shell: boolean } {
  if (process.platform !== 'win32') return { command, args, shell: false };

  let found = command;
  const bare = !/[\\/]/.test(command) && !extname(command);
  if (bare) {
    const lookup = (name: string): string | undefined =>
      env[Object.keys(env).find((key) => key.toUpperCase() === name) ?? name];
    const extensions = (lookup('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    search: for (const dir of (lookup('PATH') ?? '').split(delimiter).filter(Boolean)) {
      for (const extension of extensions) {
        const candidate = join(dir, command + extension.toLowerCase());
        if (existsSync(candidate)) { found = candidate; break search; }
      }
    }
  }

  const shim = /\.(cmd|bat)$/i.test(found);
  // Not found at all is left to the shell as well: its "is not recognized"
  // lands in stderr, and stderr is what the error below quotes.
  if (!shim && (found !== command || !bare)) return { command: found, args, shell: false };

  // One pre-quoted line and no argument array: with a shell, Node joins the
  // array with spaces and quotes nothing, so a path with a space in it arrives
  // as two arguments. The quoting here is for correctness, not for safety --
  // this line comes from the machine's own settings file, never from a graph.
  const quote = (part: string): string =>
    /^[\w\-+=:.,/\\@]+$/.test(part) ? part : `"${part.replace(/"/g, '\\"')}"`;
  return { command: [found, ...args].map(quote).join(' '), args: [], shell: true };
}

function stdioTransport(label: string, config: { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }): Transport {
  const env = { ...process.env, ...config.env };
  const plan = launchPlan(config.command, config.args ?? [], env);

  const pending = new Map<number, { fulfil(value: unknown): void; fail(error: Error): void; release(): void }>();
  let nextId = 1;
  let stderr = '';
  let buffered = '';
  /** Set once, the moment the child is known to be gone; every later request fails with it. */
  let gone: Error | undefined;

  const child: ChildProcess = spawn(plan.command, plan.args, {
    cwd: config.cwd,
    env,
    shell: plan.shell,
    // Or every tool call flashes a console window on Windows.
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const die = (why: string): void => {
    if (gone) return;
    // What the server printed on its way out is usually the whole explanation:
    // a missing package, a bad path, an API key it wanted and did not get.
    const tail = stderr.trim().slice(-STDERR_TAIL);
    gone = new Error(tail ? `${why}\n${tail}` : why);
    for (const [, waiting] of pending) {
      waiting.release();
      waiting.fail(gone);
    }
    pending.clear();
  };

  const send = (message: RpcMessage): void => {
    // One message per line is the whole framing. JSON.stringify never emits a
    // raw newline, so the line is the message.
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };

  const receive = (line: string): void => {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      // Servers print banners, progress and the odd stray console.log on the
      // channel that is supposed to be protocol only. It is wrong of them and
      // common enough that refusing to work would be wrong of us.
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (message.method) {
      // The server asking *us* something. We advertised no capabilities, so the
      // only thing it may legitimately ask is whether we are still here.
      if (message.id === undefined || message.id === null) return;
      if (message.method === 'ping') send({ id: message.id, result: {} });
      else send({ id: message.id, error: { code: -32601, message: `ai-graph does not implement ${message.method}` } });
      return;
    }

    const waiting = typeof message.id === 'number' ? pending.get(message.id) : undefined;
    if (!waiting) return;
    pending.delete(message.id as number);
    waiting.release();
    try {
      waiting.fulfil(unwrap(message));
    } catch (error) {
      waiting.fail(error as Error);
    }
  };

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffered += chunk;
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (line) receive(line);
    }
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR_TAIL * 2); });
  // Writing to a child that has already exited raises EPIPE on the *stream*,
  // and an unhandled stream error takes the whole engine down with it.
  child.stdin?.on('error', () => {});
  child.on('error', (error) => die(`Could not start \`${config.command}\`: ${error.message}`));
  child.on('close', (code) => die(`\`${config.command}\` exited${code === null ? '' : ` with code ${code}`} before answering.`));

  return {
    negotiated() {},

    request(method, params, timeoutMs, stop) {
      return new Promise((fulfil, fail) => {
        if (gone) return fail(gone);
        if (stop?.aborted) return fail(new Error('Stopped.'));
        const id = nextId++;

        // Given up on, by the clock or by whoever pressed Stop. The server is
        // told, so a tool that is merely slow does not go on working for a
        // caller who has left.
        const giveUp = (reason: string, why: Error): void => {
          const waiting = pending.get(id);
          if (!waiting) return;
          pending.delete(id);
          waiting.release();
          send({ method: 'notifications/cancelled', params: { requestId: id, reason } });
          fail(why);
        };

        const timer = timeoutMs > 0
          ? setTimeout(
            () => giveUp('timed out', new Error(`Tool server "${label}" did not answer ${method} within ${seconds(timeoutMs)}.`)),
            timeoutMs,
          )
          : null;
        const stopped = (): void => giveUp('the run was stopped', new Error('Stopped.'));
        stop?.addEventListener('abort', stopped, { once: true });

        pending.set(id, {
          fulfil,
          fail,
          release: () => {
            if (timer) clearTimeout(timer);
            stop?.removeEventListener('abort', stopped);
          },
        });
        send({ id, method, ...(params === undefined ? {} : { params }) });
      });
    },

    async notify(method, params) {
      if (gone) throw gone;
      send({ method, ...(params === undefined ? {} : { params }) });
    },

    async close() {
      try {
        if (child.exitCode !== null || child.signalCode !== null) return;
        // The protocol's own way to say goodbye is closing stdin, and a server
        // that is allowed to leave by itself gets to flush what it was writing.
        const left = new Promise<void>((done) => child.once('close', () => done()));
        child.stdin?.end();
        const grace = new Promise<'late'>((late) => { setTimeout(() => late('late'), EXIT_GRACE_MS).unref(); });
        if (await Promise.race([left, grace]) !== 'late') return;

        if (process.platform === 'win32' && plan.shell && child.pid) {
          // Behind a shell, `kill` ends the `cmd.exe` and orphans the server it
          // started. The tree has to go, and only taskkill knows the tree.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
            .on('error', () => {});
        } else {
          child.kill();
        }
      } catch {
        // Never throws: see the interface.
      } finally {
        die('The tool server was closed.');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Streamable HTTP: a server somewhere else
// ---------------------------------------------------------------------------

/** The JSON-RPC message answering *id*, out of a body that may be one message or a batch. */
function pick(parsed: unknown, id: number): RpcMessage | undefined {
  const all = Array.isArray(parsed) ? parsed : [parsed];
  return all.find((message): message is RpcMessage =>
    !!message && typeof message === 'object' && (message as RpcMessage).id === id && !(message as RpcMessage).method);
}

/**
 * Read an event stream until the answer to *id* goes by.
 *
 * A server may answer a POST with a stream instead of a body, and may put
 * other things on it first -- progress, log lines, requests of its own. So the
 * stream is read event by event and the read stops at the answer, rather than
 * waiting for the server to hang up: some never do, and the answer would sit
 * in a buffer until the timeout called it a failure.
 */
async function answerFromStream(response: Response, id: number): Promise<RpcMessage | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      // A last event with no blank line after it is still an event.
      if (done) buffer += '\n\n';

      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data) continue;
        try {
          const found = pick(JSON.parse(data), id);
          if (found) return found;
        } catch {
          // A keep-alive or a comment dressed as data. Not ours.
        }
      }
      if (done) return undefined;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function httpTransport(label: string, url: string, configuredHeaders: Record<string, string>): Transport {
  let nextId = 1;
  let sessionId: string | undefined;
  let version: string | undefined;

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    // Both, always: the server chooses which to answer with, per request.
    Accept: 'application/json, text/event-stream',
    ...configuredHeaders,
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    ...(version ? { 'MCP-Protocol-Version': version } : {}),
  });

  const exchange = async <T>(
    message: RpcMessage,
    timeoutMs: number,
    read: (response: Response) => Promise<T>,
    stop?: AbortSignal,
  ): Promise<T> => {
    const abort = new AbortController();
    // One clock over the request *and* the reading of its answer: a stream that
    // opens promptly and then says nothing is the slow case worth catching.
    const timer = timeoutMs > 0 ? setTimeout(() => abort.abort(), timeoutMs) : null;
    const stopped = (): void => abort.abort();
    if (stop?.aborted) throw new Error('Stopped.');
    stop?.addEventListener('abort', stopped, { once: true });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ jsonrpc: '2.0', ...message }),
        signal: abort.signal,
      });
      // A server that keeps state says so once, on the answer to `initialize`,
      // and expects to be told on everything after.
      sessionId = response.headers.get('mcp-session-id') ?? sessionId;
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${response.status} from ${url}${text ? `: ${text.slice(0, 300)}` : ''}`);
      }
      return await read(response);
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        if (stop?.aborted) throw new Error('Stopped.');
        throw new Error(`Tool server "${label}" did not answer ${message.method} within ${seconds(timeoutMs)}.`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      stop?.removeEventListener('abort', stopped);
    }
  };

  return {
    negotiated(settled) { version = settled; },

    request(method, params, timeoutMs, stop) {
      const id = nextId++;
      return exchange({ id, method, ...(params === undefined ? {} : { params }) }, timeoutMs, async (response) => {
        const type = response.headers.get('content-type') ?? '';
        const answer = type.includes('text/event-stream')
          ? await answerFromStream(response, id)
          : pick(JSON.parse(await response.text()), id);
        if (!answer) throw new Error(`Tool server "${label}" closed the response to ${method} without answering it.`);
        return unwrap(answer);
      }, stop);
    },

    async notify(method, params) {
      // 202 and no body is the whole answer to a notification. Whatever came
      // instead is let go of unread, so the socket is not held open for it.
      await exchange({ method, ...(params === undefined ? {} : { params }) }, HANDSHAKE_TIMEOUT_MS, async (response) => {
        await response.body?.cancel().catch(() => {});
      });
    },

    async close() {
      // No session, nothing to end: a stateless server never knew we were here.
      if (!sessionId) return;
      try {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 5_000);
        try {
          const response = await fetch(url, { method: 'DELETE', headers: headers(), signal: abort.signal });
          // 405 is a legal answer -- "I do not let clients end sessions" -- and
          // like every other answer here there is nothing to do about it.
          await response.body?.cancel().catch(() => {});
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Never throws: see the interface.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// One server, opened
// ---------------------------------------------------------------------------

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface OpenServer {
  label: string;
  transport: Transport;
  tools: McpTool[];
}

async function handshake(transport: Transport, timeoutMs: number): Promise<McpTool[]> {
  const hello = await transport.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  }, timeoutMs) as { protocolVersion?: string } | undefined;
  // The server may answer with an older version than the one offered. Tools
  // have looked the same in all of them, so whatever it says is what is used.
  transport.negotiated(hello?.protocolVersion ?? PROTOCOL_VERSION);
  await transport.notify('notifications/initialized');

  const tools: McpTool[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await transport.request('tools/list', cursor ? { cursor } : {}, timeoutMs) as
      { tools?: McpTool[]; nextCursor?: string } | undefined;
    tools.push(...(page?.tools ?? []).filter((tool) => tool && typeof tool.name === 'string'));
    cursor = page?.nextCursor || undefined;
    // A server that hands back a cursor it has already handed out would be
    // followed forever; the second sighting is the end of the list.
    if (cursor && seen.has(cursor)) break;
    if (cursor) seen.add(cursor);
  } while (cursor);
  return tools;
}

/**
 * What a `tools/call` result says, as the text a model will read.
 *
 * Text only, because text is what goes back into a chat completion. Anything
 * else leaves a marker rather than vanishing: a model told `[image]` can say
 * that a picture came back; a model told nothing concludes the tool is broken.
 */
function resultText(result: unknown): string {
  const { content, structuredContent, isError } = (result ?? {}) as {
    content?: { type?: string; text?: string; resource?: { text?: string; uri?: string } }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  const parts = (Array.isArray(content) ? content : []).map((item) => {
    if (item?.type === 'text') return item.text ?? '';
    if (item?.type === 'resource' && typeof item.resource?.text === 'string') return item.resource.text;
    return `[${item?.type ?? 'content'}]`;
  });
  let text = parts.join('\n');
  // Newer servers may answer in structured form only. It is JSON; a model reads JSON.
  if (!text && structuredContent !== undefined) text = JSON.stringify(structuredContent);
  // Returned, not thrown. A failed tool call is a turn in the conversation: the
  // model sees it, fixes its arguments or tries something else, and the node
  // still ends with an answer. Thrown, one typo by the model fails the run.
  return isError ? `Tool error: ${text || 'the tool failed and did not say why.'}` : text;
}

/**
 * A name a provider will accept as a function name.
 *
 * MCP allows dots and slashes in tool names; OpenAI and Anthropic allow
 * letters, digits, `_` and `-`, up to 64. The model is shown the safe name and
 * the server is called by the real one.
 */
const safeName = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'tool';

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

const isUrl = (server: string): boolean => /^https?:\/\//i.test(server);

/**
 * `AI_GRAPH_MCP_TIMEOUT_MS`, or undefined when the machine said nothing.
 *
 * Two minutes is the default because a tool call that hangs is nearly always a
 * server that died, and a scheduled run has nobody to notice. A tool that
 * genuinely takes longer -- a crawl, a build -- is why the knob exists, and 0
 * takes the clock off entirely. Stop ends the call either way.
 */
function envCallTimeout(env: Record<string, string | undefined> = process.env): number | undefined {
  const given = env.AI_GRAPH_MCP_TIMEOUT_MS;
  const ms = Number(given);
  return given && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/**
 * Tool servers for this machine.
 *
 * *configured* is what the machine's settings file says -- see
 * `configuredMcpServers` in `settings.ts`. It is the only place a command line
 * can come from.
 */
export function mcpToolService(
  configured: Record<string, McpServerConfig> = {},
  options: McpOptions = {},
): ToolService {
  const handshakeTimeout = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const callTimeout = options.callTimeoutMs ?? envCallTimeout() ?? CALL_TIMEOUT_MS;

  /**
   * THE SECURITY BOUNDARY. A graph must never be able to supply a command line.
   *
   * *server* came out of a graph file. It is used in exactly two ways: as a URL
   * to POST to, or as a key into *configured*. It is never split, parsed for
   * arguments, or passed to `spawn` -- what gets spawned is whatever the machine's
   * owner wrote down under that key, and a key they did not write is an error,
   * not a fallback. Anyone changing this function should be able to say why a
   * graph downloaded from a stranger still cannot start a program.
   */
  const resolve = (server: string): { label: string; connect(): Transport } => {
    if (isUrl(server)) {
      let label = server;
      try { label = new URL(server).hostname || server; } catch { /* the fetch will say what is wrong with it */ }
      // No headers: credentials belong to a *configured* entry, and are sent
      // only to the URL written beside them.
      return { label, connect: () => httpTransport(server, server, {}) };
    }

    const entry = Object.prototype.hasOwnProperty.call(configured, server) ? configured[server] : undefined;
    if (!entry) {
      const known = Object.keys(configured);
      throw new Error(
        `The graph asks for tool server "${server}", which this machine has not configured. `
        + 'A graph can name a tool server but never the command that starts one: '
        + `add "${server}" under "mcp_servers" in ai-settings.json`
        + (known.length ? ` (configured here: ${known.join(', ')}).` : '.'),
      );
    }
    if ('url' in entry && typeof entry.url === 'string') {
      const { url, headers = {} } = entry;
      return { label: server, connect: () => httpTransport(server, url, headers) };
    }
    if ('command' in entry && typeof entry.command === 'string' && entry.command) {
      return { label: server, connect: () => stdioTransport(server, entry) };
    }
    throw new Error(`Tool server "${server}" in ai-settings.json needs either a "command" or a "url".`);
  };

  const connect = async (target: { label: string; connect(): Transport }): Promise<OpenServer> => {
    let transport: Transport | undefined;
    try {
      transport = target.connect();
      return { label: target.label, transport, tools: await handshake(transport, handshakeTimeout) };
    } catch (error) {
      await transport?.close();
      throw new Error(`Tool server "${target.label}" could not be opened: ${(error as Error).message}`);
    }
  };

  return {
    async open(servers: string[]): Promise<ToolSession> {
      const wanted = [...new Set(servers.map((server) => server.trim()).filter(Boolean))];
      // Every name is resolved before anything is started, so a graph asking
      // for one server too many starts none of them.
      const targets = wanted.map(resolve);

      // Together, not in turn: an `npx` server spends seconds on startup, and
      // three of them in a row is a node that looks hung.
      const settled = await Promise.allSettled(targets.map(connect));
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) {
        // All or nothing. A model offered half its tools does not fail -- it
        // answers confidently without the half it never knew about.
        await Promise.all(settled.map((result) =>
          (result.status === 'fulfilled' ? result.value.transport.close() : undefined)));
        throw failed.reason;
      }
      const opened = settled.map((result) => (result as PromiseFulfilledResult<OpenServer>).value);

      // Names are handed out in the order the graph listed the servers, so the
      // same graph shows the model the same names on every run.
      const routes = new Map<string, { server: OpenServer; tool: string }>();
      const specs: ToolSpec[] = [];
      for (const server of opened) {
        for (const tool of server.tools) {
          let name = safeName(tool.name);
          // Two servers with a `search` each: the first keeps the name, the
          // later one carries its server's.
          if (routes.has(name)) name = safeName(`${server.label}__${tool.name}`);
          for (let n = 2; routes.has(name); n += 1) name = `${safeName(`${server.label}__${tool.name}`).slice(0, 60)}_${n}`;
          routes.set(name, { server, tool: tool.name });
          specs.push({
            name,
            description: tool.description ?? '',
            parameters: tool.inputSchema ?? { type: 'object', properties: {} },
          });
        }
      }

      let closed = false;
      return {
        specs,

        async call(name, args, stop) {
          const route = routes.get(name);
          // A name the model made up is the model's mistake, and it can only
          // correct a mistake it is told about.
          if (!route) return `Tool error: there is no tool named "${name}". The tools are: ${specs.map((spec) => spec.name).join(', ') || '(none)'}.`;
          try {
            return resultText(await route.server.transport.request(
              'tools/call', { name: route.tool, arguments: args ?? {} }, callTimeout, stop,
            ));
          } catch (error) {
            if (error instanceof McpRpcError) return `Tool error: ${error.message}`;
            // A server that died or stopped answering is not something the
            // model can talk its way around, and an answer written without the
            // tools it was given should not pass for one written with them.
            throw new Error(`Tool "${name}" on server "${route.server.label}" failed: ${(error as Error).message}`);
          }
        },

        async close() {
          if (closed) return;
          closed = true;
          await Promise.all(opened.map((server) => server.transport.close()));
        },
      };
    },
  };
}
