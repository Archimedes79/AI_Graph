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

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseGraph, type ExecutionResult, type Graph } from '../graph.ts';
import { executeGraph } from '../executor.ts';
import { registry } from '../registry.ts';
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
  graphPath: string;
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
}

export async function serve(options: ServeOptions): Promise<{ server: Server; url: string }> {
  const host = options.host ?? '127.0.0.1';
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const allowBrowse = (options.allowBrowse ?? true) && loopback;
  const runs = new Map<string, Run>();

  const original = parseGraph(JSON.parse(await readFile(options.graphPath, 'utf8')));

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      send(response, 500, { detail: error instanceof Error ? error.message : String(error) });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${host}`);
    const path = url.pathname;

    if (path === '/api/runtime/graph') return send(response, 200, original);

    if (path === '/api/execute/requirements' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, runtimeRequirements(graph, registry).map(asRequirement));
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
      return send(response, 200, await browse(asked.path ?? '.', asked.extensions ?? ''));
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

    return options.pageDir ? page(response, path, options.pageDir) : send(response, 404, { detail: 'No page.' });
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

  async function page(response: ServerResponse, path: string, dir: string): Promise<void> {
    // Anything that is not a file is the page itself: the runtime is a single
    // page, so a deep link is still that page rather than a 404.
    const wanted = path === '/' ? '/runtime.html' : path;
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
      const html = join(dir, 'runtime.html');
      response.writeHead(200, { 'Content-Type': MIME['.html'] });
      response.end(await readFile(html));
    }
  }

  await new Promise<void>((listening) => server.listen(options.port ?? 0, host, listening));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://${host}:${port}` };
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
