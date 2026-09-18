import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolSession } from '../element.ts';
import { mcpToolService, type McpServerConfig } from './mcp.ts';

const FIXTURE = join(__dirname, 'fixtures', 'echo-mcp-server.mjs');

/** The fixture as a machine would configure it: the interpreter already running, and a script. */
const echo = (...flags: string[]): McpServerConfig => ({ command: process.execPath, args: [FIXTURE, ...flags] });

const open: ToolSession[] = [];
const track = (session: ToolSession): ToolSession => { open.push(session); return session; };

afterEach(async () => {
  // A test that fails halfway must not leave a child process holding vitest open.
  await Promise.all(open.splice(0).map((session) => session.close()));
});

describe('the security boundary', () => {
  it('refuses a name this machine has not configured, and says where one is configured', async () => {
    const tools = mcpToolService({ files: echo() });
    await expect(tools.open(['shell'])).rejects.toThrow(
      /graph asks for tool server "shell", which this machine has not configured.*mcp_servers.*ai-settings\.json/s,
    );
  });

  it('will not take a command line from a graph, however it is dressed', async () => {
    // Every one of these is a *name*, looked up and not found. None is run.
    const tools = mcpToolService({});
    for (const attempt of [`${process.execPath} ${FIXTURE}`, 'npx -y some-server', 'cmd /c calc', '__proto__', 'constructor']) {
      await expect(tools.open([attempt])).rejects.toThrow(/has not configured/);
    }
  });

  it('starts nothing when one of several names is unknown', async () => {
    // Resolved before anything is spawned: the known server would otherwise
    // be started and then have to be found and killed.
    const tools = mcpToolService({ files: echo('--mute') }, { handshakeTimeoutMs: 60_000 });
    const started = Date.now();
    await expect(tools.open(['files', 'unknown'])).rejects.toThrow(/"unknown"/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('says what a configured entry is missing', async () => {
    const tools = mcpToolService({ broken: {} as McpServerConfig });
    await expect(tools.open(['broken'])).rejects.toThrow(/"command" or a "url"/);
  });
});

describe('a stdio server', () => {
  it('lists its tools across pages, past a banner that is not JSON', async () => {
    const session = track(await mcpToolService({ echo: echo() }).open(['echo']));

    expect(session.specs.map((spec) => spec.name)).toEqual(['add', 'echo', 'fail', 'picture', 'whoami', 'ghost_tool']);
    expect(session.specs[0]).toMatchObject({
      name: 'add',
      description: 'Add two numbers.',
      parameters: { type: 'object', required: ['a', 'b'] },
    });
  });

  it('calls a tool and returns its text', async () => {
    const session = track(await mcpToolService({ echo: echo() }).open(['echo']));

    expect(await session.call('add', { a: 2, b: 3 })).toBe('5');
    expect(await session.call('echo', { text: 'grüße, 世界' })).toBe('grüße, 世界');
  });

  it('answers calls made at the same time, each with its own result', async () => {
    const session = track(await mcpToolService({ echo: echo() }).open(['echo']));
    const sums = await Promise.all([1, 2, 3, 4].map((n) => session.call('add', { a: n, b: n })));
    expect(sums).toEqual(['2', '4', '6', '8']);
  });

  it('hands a failed tool to the model as text, not to the run as an exception', async () => {
    const session = track(await mcpToolService({ echo: echo() }).open(['echo']));

    expect(await session.call('fail', {})).toBe('Tool error: it did not work');
    // The same for the protocol's own errors, and for a name the model invented.
    expect(await session.call('ghost_tool', {})).toBe('Tool error: Unknown tool: ghost.tool');
    expect(await session.call('subtract', {})).toMatch(/^Tool error: there is no tool named "subtract".*add, echo/);
  });

  it('leaves a marker where content was not text', async () => {
    const session = track(await mcpToolService({ echo: echo() }).open(['echo']));
    expect(await session.call('picture', {})).toBe('a cat\n[image]');
  });

  it("passes the entry's env on top of this process's own", async () => {
    const tools = mcpToolService({ echo: { ...echo(), env: { EXAMPLE_NAME: 'configured' } } as McpServerConfig });
    const session = track(await tools.open(['echo']));
    expect(await session.call('whoami', {})).toBe('configured');
  });

  it('prefixes a name a later server shares with an earlier one', async () => {
    const session = track(await mcpToolService({ first: echo(), second: echo() }).open(['first', 'second']));

    const names = session.specs.map((spec) => spec.name);
    expect(names).toContain('add');
    expect(names).toContain('second__add');
    expect(names).not.toContain('first__add');
    expect(await session.call('second__add', { a: 1, b: 1 })).toBe('2');
  });

  it('opens a server once however often the graph names it', async () => {
    const session = track(await mcpToolService({ echo: echo() }).open(['echo', ' echo ', '']));
    expect(session.specs.filter((spec) => spec.name.endsWith('add'))).toHaveLength(1);
  });

  it.runIf(process.platform === 'win32')('starts a .cmd shim, which is what `npx` is on Windows', async () => {
    // Node will not spawn a .cmd without a shell, and with one it quotes
    // nothing -- so the directory has a space in it, as `Program Files` does.
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph mcp '));
    try {
      const shim = join(dir, 'server.cmd');
      await writeFile(shim, `@echo off\r\n"${process.execPath}" %*\r\n`);
      const session = track(await mcpToolService({ shim: { command: shim, args: [FIXTURE] } }).open(['shim']));
      expect(await session.call('echo', { text: 'through a shell' })).toBe('through a shell');
      await session.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('quotes what the server said on stderr when it dies instead of answering', async () => {
    const tools = mcpToolService({ doomed: echo('--crash') });
    await expect(tools.open(['doomed'])).rejects.toThrow(/"doomed" could not be opened.*code 3.*database is on fire/s);
  });

  it('names the command that could not be started', async () => {
    const tools = mcpToolService({ absent: { command: join(__dirname, 'fixtures', 'no-such-program.exe') } });
    await expect(tools.open(['absent'])).rejects.toThrow(/"absent" could not be opened/);
  });

  it('gives up on a server that never says hello', async () => {
    const tools = mcpToolService({ mute: echo('--mute') }, { handshakeTimeoutMs: 300 });
    await expect(tools.open(['mute'])).rejects.toThrow(/"mute" could not be opened.*did not answer initialize within 0\.3 s/s);
  });

  it('closes the servers that did open when another does not', async () => {
    // All or nothing: a model given half its tools answers confidently without
    // the other half. If the good server were left running, its process would
    // keep this test file from ever finishing.
    const tools = mcpToolService({ good: echo(), doomed: echo('--crash') });
    await expect(tools.open(['good', 'doomed'])).rejects.toThrow(/"doomed"/);
  });

  it('fails a call made after close, and close twice is nothing', async () => {
    const session = await mcpToolService({ echo: echo() }).open(['echo']);
    await session.close();
    await session.close();
    await expect(session.call('add', { a: 1, b: 1 })).rejects.toThrow(/Tool "add" on server "echo" failed/);
  });

  it('is an empty session when the graph names no server', async () => {
    const session = await mcpToolService({}).open([]);
    expect(session.specs).toEqual([]);
    await session.close();
  });
});

// ---------------------------------------------------------------------------
// Streamable HTTP
// ---------------------------------------------------------------------------

interface Seen { method: string; rpc?: string; session?: string; version?: string; accept?: string; auth?: string }

/**
 * An MCP server over HTTP, answering the way the spec lets a server choose to:
 * `initialize` as JSON, everything else as an event stream with something
 * unrelated on it first. It sets a session id and records whether it got it back.
 */
async function httpServer(): Promise<{ url: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = [];
  const body = async (request: IncomingMessage): Promise<string> => {
    let text = '';
    for await (const chunk of request) text += chunk;
    return text;
  };

  const server = createServer(async (request, response) => {
    const message = request.method === 'POST' ? JSON.parse(await body(request)) : {};
    seen.push({
      method: request.method ?? '',
      rpc: message.method,
      session: request.headers['mcp-session-id'] as string | undefined,
      version: request.headers['mcp-protocol-version'] as string | undefined,
      accept: request.headers.accept,
      auth: request.headers.authorization,
    });

    if (request.method === 'DELETE') { response.writeHead(204).end(); return; }

    const { id, method, params } = message;
    if (id === undefined) { response.writeHead(202).end(); return; }

    if (method === 'initialize') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-1' });
      response.end(JSON.stringify({
        jsonrpc: '2.0', id,
        result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '0' } },
      }));
      return;
    }

    const result = method === 'tools/list'
      ? { tools: [{ name: 'add', description: 'Add.', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: String(params.arguments.a + params.arguments.b) }] };

    // A stream that is never ended: the client has to stop reading at its
    // answer, because this server will not hang up to tell it so.
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(': a comment, which is how servers keep a stream alive\n\n');
    response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
    response.write(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\r\n\r\n`);
  });

  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp`, seen, server };
}

describe('an HTTP server', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
  });

  it('is opened by URL, read as JSON or as a stream, and told its session id back', async () => {
    const http = await httpServer();
    server = http.server;

    const session = await mcpToolService({}).open([http.url]);
    expect(session.specs.map((spec) => spec.name)).toEqual(['add']);
    expect(await session.call('add', { a: 20, b: 22 })).toBe('42');
    await session.close();

    expect(http.seen.map((request) => request.rpc ?? request.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'DELETE',
    ]);
    expect(http.seen[0].accept).toBe('application/json, text/event-stream');
    // Nothing to send back before the server has said anything...
    expect(http.seen[0].session).toBeUndefined();
    expect(http.seen[0].version).toBeUndefined();
    // ...and both on everything after, with the version the *server* chose.
    for (const request of http.seen.slice(1)) {
      expect(request.session).toBe('session-1');
      expect(request.version).toBe('2025-03-26');
    }
  });

  it('sends configured headers to a configured URL, and none to a URL a graph names', async () => {
    const http = await httpServer();
    server = http.server;
    const tools = mcpToolService({ remote: { url: http.url, headers: { Authorization: 'Bearer secret' } } });

    await (await tools.open(['remote'])).close();
    expect(http.seen.every((request) => request.auth === 'Bearer secret')).toBe(true);

    http.seen.length = 0;
    await (await tools.open([http.url])).close();
    expect(http.seen.every((request) => request.auth === undefined)).toBe(true);
  });

  it('names the server that is not there', async () => {
    const http = await httpServer();
    http.server.close();
    await expect(mcpToolService({}).open([http.url])).rejects.toThrow(/"127\.0\.0\.1" could not be opened/);
  });
});
