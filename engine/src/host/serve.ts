// Serving a deployed tool: the page, and the few endpoints it calls.
//
// A bundle with an interface is a static page plus a local server. The page is
// the *same build* the designer previewed — copied, not regenerated — and this
// serves it along with the handful of routes it talks to.
//
// Deliberately not vendored from the editor's API: a deployed tool must not
// offer code generation, graph editing or anything else that only makes sense
// while building. What it offers is the graph it ships, a way to run it, and
// the file picker its own blocks need. That list is the security boundary, so
// it is written out here rather than assembled from a router someone might
// extend later without noticing where it ends up.

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseGraph, type ExecutionResult, type Graph } from '../graph.ts';
import { executeGraph } from '../executor.ts';
import { registry } from '../registry.ts';
import { authoredIn, generations } from '../describe.ts';
import * as editorFiles from './editor/files.ts';
import { applyRuntimeValues, runtimeRequirements } from '../runtimeValues.ts';
import { nodeFiles, nodeRuntime } from './node.ts';

/**
 * A run in flight, so the page can watch it and stop it.
 *
 * The fields are the ones `RunSnapshot` in the page's own client declares —
 * read from there rather than invented, because a snapshot missing `done` looks
 * to the page exactly like a run that never finishes. `completed/total` counts
 * nodes, which does not move while one node grinds through a 500-item batch;
 * `item_done/item_total` is what moves then, and the two cases that look like a
 * hang are exactly those.
 */
interface Run {
  id: string;
  total: number;
  completed: number;
  running: string[];
  currentLabel: string;
  itemDone: number;
  itemTotal: number;
  lastActivity: number | null;
  result: ExecutionResult | null;
  error: string | null;
  cancelled: boolean;
  finishedAt: number | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface ServeOptions {
  /**
   * The graph this server ships, for a deployed tool.
   *
   * Optional, because the editor starts this alongside itself purely to run
   * graphs: it posts the one being edited with every request, so there is
   * nothing stored to serve. Only `/api/runtime/graph` needs it.
   */
  graphPath?: string;
  /** Where the built page lives, if this bundle carries one. */
  pageDir?: string;
  port?: number;
  /**
   * Let the page list directories.
   *
   * Loopback only, and that is not a detail: on 0.0.0.0 it would expose this
   * machine's filesystem listing to the network, which is a different thing
   * from letting the person at the keyboard choose their own file.
   */
  allowBrowse?: boolean;
  host?: string;
  /**
   * Serve the editor instead of a deployed page.
   *
   * `dist` is the built editor. `api` is where the routes this process does not
   * own yet are forwarded — the editor's Python server, for as long as it
   * exists. This makes the engine the front door: the browser talks to one
   * process, and every route brought across is one line fewer forwarded, until
   * nothing is.
   */
  editor?: { dist: string; api: string };
}

/** In editor mode, the routes the engine answers itself; the rest is forwarded. */
const OWNED_IN_EDITOR_MODE = /^\/api\/(execute|elements|files)\//;

export async function serve(options: ServeOptions): Promise<{ server: Server; url: string }> {
  const host = options.host ?? '127.0.0.1';
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const allowBrowse = (options.allowBrowse ?? true) && loopback;
  const runs = new Map<string, Run>();

  const original = options.graphPath
    ? parseGraph(JSON.parse(await readFile(options.graphPath, 'utf8')))
    : null;

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      send(response, 500, { detail: error instanceof Error ? error.message : String(error) });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${host}`);
    const path = url.pathname;

    if (options.editor && path.startsWith('/api/') && !OWNED_IN_EDITOR_MODE.test(path)) {
      return forward(request, response, options.editor.api);
    }

    if (path === '/api/runtime/graph') {
      if (!original) return send(response, 404, { detail: 'This server ships no graph; post the one to run.' });
      return send(response, 200, original);
    }

    if (path === '/api/execute/requirements' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, runtimeRequirements(graph, registry).map(asRequirement));
    }

    // Where this graph's authored bodies live. Describing a graph the caller
    // already holds is neither code generation nor graph editing, so it sits
    // inside the boundary above: the editor asks the elements instead of
    // keeping a second opinion about which config key holds a node's code.
    if (path === '/api/elements/generation') {
      return send(response, 200, generations());
    }

    if (path === '/api/elements/authored' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, authoredIn(graph));
    }

    if (path === '/api/execute/' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, await run(graph));
    }

    if (path === '/api/execute/start' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, { run_id: start(graph), total: graph.nodes.length });
    }

    const watching = /^\/api\/execute\/runs\/([^/]+)$/.exec(path);
    if (watching) {
      const found = runs.get(watching[1]);
      if (!found) return send(response, 404, { detail: 'No such run.' });
      return send(response, 200, snapshot(found));
    }

    const stopping = /^\/api\/execute\/runs\/([^/]+)\/cancel$/.exec(path);
    if (stopping && request.method === 'POST') {
      const found = runs.get(stopping[1]);
      if (found) found.cancelled = true;
      return send(response, 200, { cancelled: Boolean(found) });
    }

    if (path === '/api/files/browse' && request.method === 'POST') {
      if (!allowBrowse) return send(response, 403, { detail: 'Browsing is disabled.' });
      const asked = await body(request) as { path?: string; extensions?: string };
      if (!options.editor) return send(response, 200, await browse(asked.path ?? '.', asked.extensions ?? ''));
      // The editor walks into directories and jumps between drives; a deployed
      // page only picks a file, and lists nothing it would not need to.
      try {
        const filter = editorFiles.extensionFilter(asked.extensions ?? '');
        return send(response, 200, await editorFiles.browse(asked.path ?? '', filter));
      } catch (error) {
        return send(response, error instanceof editorFiles.NotFound ? 404 : 400, { detail: message(error) });
      }
    }

    if (options.editor && path === '/api/files/detect-format' && request.method === 'POST') {
      const asked = await body(request) as { path?: string };
      if (!asked.path) return send(response, 400, { detail: "Missing required field 'path'" });
      try {
        return send(response, 200, { format: await editorFiles.detectFormat(asked.path) });
      } catch (error) {
        return send(response, 404, { detail: message(error) });
      }
    }

    if (options.editor && path === '/api/files/attachments' && request.method === 'POST') {
      // The file itself is the body; its name rides on the query. No multipart
      // to parse, and nothing about the upload a client could get wrong.
      const name = url.searchParams.get('name') ?? 'attachment';
      const saved = await editorFiles.saveAttachment(name, await rawBody(request));
      return send(response, 200, { path: saved, name });
    }

    if (options.editor && path === '/api/files/attachments' && request.method === 'DELETE') {
      try {
        await editorFiles.deleteAttachment(url.searchParams.get('path') ?? '');
        return send(response, 200, { ok: true });
      } catch (error) {
        return send(response, 400, { detail: message(error) });
      }
    }

    if (path === '/api/runtime/ai-settings') {
      // Read-only here: a deployed tool is configured through its environment,
      // which is what the README tells its recipient. Writing settings from a
      // page would put credentials in a file nobody asked for.
      return send(response, 200, {
        provider: process.env.AI_GRAPH_AI_PROVIDER ?? '',
        model: process.env.AI_GRAPH_AI_MODEL ?? '',
        force: false,
        settings_file: '(configured through the environment)',
        settings_file_exists: false,
      });
    }

    if (path.startsWith('/api/')) return send(response, 404, { detail: 'Not part of a deployed tool.' });

    if (options.editor) return page(response, path, options.editor.dist, 'index.html');
    return options.pageDir ? page(response, path, options.pageDir, 'runtime.html') : send(response, 404, { detail: 'No page.' });
  }

  async function run(graph: Graph): Promise<ExecutionResult> {
    applyRuntimeValues(graph, {}, registry);
    return executeGraph(graph, { runtime: nodeRuntime(), registry });
  }

  /** Start a run in the background and hand back its id, for a page that watches. */
  function start(graph: Graph): string {
    const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const record: Run = {
      id, total: graph.nodes.length, completed: 0, running: [], currentLabel: '',
      itemDone: 0, itemTotal: 0, lastActivity: null,
      result: null, error: null, cancelled: false, finishedAt: null,
    };
    runs.set(id, record);

    const runtime = nodeRuntime({
      report(event) {
        record.lastActivity = Date.now();
        if (event.type === 'node_start') {
          record.currentLabel = graph.nodes.find((n) => n.id === event.node_id)?.label ?? event.node_id;
          record.running = [...record.running, event.node_id];
          record.itemDone = 0;
          record.itemTotal = 0;
        }
        if (event.type === 'node_done') {
          record.completed += 1;
          record.running = record.running.filter((id) => id !== event.node_id);
        }
        if (event.type === 'batch') {
          record.itemDone = event.done;
          record.itemTotal = event.total;
        }
      },
    });

    executeGraph(graph, { runtime, registry })
      .then((result) => { record.result = result; })
      .catch((error: unknown) => { record.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { record.finishedAt = Date.now(); forget(); });

    return id;
  }

  /** Finished runs linger briefly, then go: a long session must not accumulate them. */
  function forget(): void {
    const cutoff = Date.now() - 300_000;
    for (const [id, record] of runs) {
      if (record.finishedAt !== null && record.finishedAt < cutoff) runs.delete(id);
    }
  }

  async function browse(path: string, extensions: string): Promise<unknown> {
    const target = resolve(path);
    const suffixes = extensions.split(',').map((e) => e.trim()).filter(Boolean)
      .map((e) => (e.startsWith('.') ? e : `.${e}`));
    const files = await nodeFiles.list(target, {
      extensions: suffixes.length ? suffixes : undefined,
    });
    return { path: target, entries: files.map((file) => ({ path: file, is_dir: false })) };
  }

  async function page(response: ServerResponse, path: string, dir: string, entry: string): Promise<void> {
    // Anything that is not a file is the page itself: the runtime is a single
    // page, so a deep link is still that page rather than a 404.
    const wanted = path === '/' ? `/${entry}` : path;
    const full = join(dir, normalize(wanted).replace(/^([/\\])+/, ''));
    if (!full.startsWith(resolve(dir) + sep) && full !== resolve(dir)) {
      return send(response, 403, { detail: 'Outside the page.' });
    }
    try {
      const found = await stat(full);
      if (!found.isFile()) throw new Error('not a file');
      response.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
      response.end(await readFile(full));
    } catch {
      try {
        const html = await readFile(join(dir, entry));
        response.writeHead(200, { 'Content-Type': MIME['.html'] });
        response.end(html);
      } catch {
        send(response, 404, { detail: `No ${entry} in ${dir}. Build the editor first: cd frontend && npm run build` });
      }
    }
  }

  await new Promise<void>((listening) => server.listen(options.port ?? 0, host, listening));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://${host}:${port}` };
}

/**
 * Hand a request to the server that still owns the route, and its answer back.
 *
 * Streamed both ways rather than buffered: an upload is a body, and a body is
 * not something to read into memory just to write it out again.
 */
function forward(request: IncomingMessage, response: ServerResponse, api: string): Promise<void> {
  return new Promise((done) => {
    const target = new URL(request.url ?? '/', api);
    const upstream = httpRequest(
      target,
      { method: request.method, headers: { ...request.headers, host: target.host } },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
        reply.on('end', done);
      },
    );
    upstream.on('error', (error) => {
      send(response, 502, { detail: `The editor's server is not answering: ${error.message}` });
      done();
    });
    request.pipe(upstream);
  });
}

/** The request body as it came: an upload is bytes, not JSON. */
function rawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => done(Buffer.concat(chunks)));
    request.on('error', fail);
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snapshot(record: Run): unknown {
  return {
    run_id: record.id,
    done: record.finishedAt !== null,
    cancelled: record.cancelled,
    completed: record.completed,
    total: record.total,
    running: record.running,
    current_label: record.currentLabel,
    item_done: record.itemDone,
    item_total: record.itemTotal,
    idle_seconds: record.lastActivity === null ? null : (Date.now() - record.lastActivity) / 1000,
    error: record.error,
    result: record.result,
  };
}

function asRequirement(requirement: { key: string; label: string; kind: string; direction: string; current: string }) {
  const [nodeId, widgetId] = requirement.key.split('::');
  return {
    node_id: nodeId,
    widget_id: widgetId ?? null,
    label: requirement.label,
    kind: requirement.kind,
    direction: requirement.direction,
    current_value: requirement.current,
  };
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((fulfil, fail) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      try {
        fulfil(raw ? JSON.parse(raw) : {});
      } catch (error) {
        fail(error);
      }
    });
    request.on('error', fail);
  });
}
