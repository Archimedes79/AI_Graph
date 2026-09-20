// The server: a built page, and the routes of `api.ts`.
//
// One server for both uses. A deployed tool gets its page and the `tool` rows
// of the table -- the graph it ships, a way to run it, the file picker its own
// blocks need. The editor gets its page and every row, the `editor` ones
// loaded from `editor/routes.ts` only when this is the editor, so none of that
// code is ever vendored into a bundle.
//
// The table is the security boundary, and it is written out in one place
// (`api.ts`) rather than assembled from a router someone might extend later
// without noticing where it ends up. A route this server has no handler for is
// a server that cannot start: the page and the engine never disagree about
// what exists.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseGraph, type Graph } from '../graph.ts';
import { executeGraph, memoryFeedbackEdges } from '../execution/executor.ts';
import { registry } from '../elements/registry.ts';
import { applyRuntimeValues, runtimeRequirements } from '../execution/runtimeValues.ts';
import { triggeredNodes } from '../execution/triggers.ts';
import { candidatePaths, configuredSettings } from '../ai/settings.ts';
import { DEFAULT_SETTINGS } from '../ai/providers.ts';
import { API, matchRoute, type RouteName } from './api.ts';
import {
  Download, Refusal, message, readBytes, readJson, sendDownload, sendJson, servePage, type Exchange, type Handlers,
} from './http.ts';
import { browse, extensionFilter, NotFound } from './browse.ts';
import { RunBoard } from './runs.ts';
import { nodeRuntime } from './node.ts';
import { schedule } from './schedule.ts';
import { Lifecycle } from './lifecycle.ts';
import { loadGraph, projectFolderOf } from '../project/folder.ts';

/** Where a served tool keeps its last scheduled round: inside a project, beside a file. */
function lastRunFile(graphPath: string): string {
  const folder = projectFolderOf(graphPath);
  return folder ? join(folder, 'graph.last-run.json') : `${graphPath}.last-run.json`;
}

export interface ServeOptions {
  /**
   * The graph this server ships, for a deployed tool.
   *
   * Optional, because the editor posts the graph being edited with every
   * request, so there is nothing stored to serve. Only the `graph` route needs it.
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
  /** Serve the editor instead of a deployed page: `dist` is the built editor. */
  editor?: { dist: string };
}

/** A server that is up: where it listens, and the one way to take it down. */
export interface Served {
  server: Server;
  url: string;
  /** Stop the clock, end the runs in flight, then close. Resolves to what would not stop in time. */
  shutdown: (graceMs?: number) => Promise<string[]>;
}

export async function serve(options: ServeOptions): Promise<Served> {
  // Everything below that outlives a request is written down here as it is
  // started, and stopped in that order: see lifecycle.ts.
  const lifecycle = new Lifecycle();
  const host = options.host ?? '127.0.0.1';
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const exchange: Exchange = { loopback: (options.allowBrowse ?? true) && loopback };

  // The graph this server ships is held, not re-read: what a run remembers is
  // settled into it, so the next scheduled round -- and the next page to open --
  // starts from there. A page that runs the graph hands over its copy, so the
  // clock goes on with the file the person picked.
  const held: { graph: Graph | null } = {
    graph: options.graphPath ? await loadGraph(options.graphPath) : null,
  };
  const clock = held.graph
    ? schedule(() => held.graph!, (graph, signal) => {
      applyRuntimeValues(graph, {}, registry);
      return executeGraph(graph, { runtime: nodeRuntime(), registry, signal });
    }, lastRunFile(options.graphPath!))
    : null;
  if (clock) lifecycle.own('the schedule', () => clock.stop());
  const runs = new RunBoard();
  lifecycle.own('runs in flight', () => runs.stopAll());

  const handlers: Handlers = {
    // A tool's picker opens where its graph is — a bundle's own folder, which
    // is also what its paths are relative to. The editor's opens where the
    // editor was started, which is the same idea one level up.
    ...toolRoutes(held, clock, runs, options.graphPath !== undefined, options.graphPath
      ? (projectFolderOf(options.graphPath) ?? dirname(resolve(options.graphPath)))
      : process.cwd()),
    // Loaded, not imported: a bundle carries this file without the `editor/`
    // folder beside it, and a static import would stop every deployed tool.
    // `held` goes in so the editor can hand this server the graph it is
    // editing and then open `runtime.html` against it: the delivered page, in
    // its own window, served by the same route a bundle serves.
    ...(options.editor ? (await import('./editor/routes.ts')).editorRoutes(held) : {}),
  };
  const missing = (Object.keys(API) as RouteName[])
    .filter((name) => (options.editor || API[name].for === 'tool') && !handlers[name]);
  if (missing.length) throw new Error(`No handler for ${missing.join(', ')}: the server and api.ts disagree.`);

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${host}`);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      // Watching and stopping still answer while the runs wind down; nothing new starts.
      if (lifecycle.stopping && request.method !== 'GET') {
        return sendJson(response, 503, { detail: 'This server is stopping.' });
      }
      const found = matchRoute(request.method ?? 'GET', path);
      const handler = found ? handlers[found.name] as ((request: unknown, exchange: Exchange) => unknown) | undefined : undefined;
      if (!found || !handler) return sendJson(response, 404, { detail: 'Not part of this server.' });
      const route = API[found.name];
      try {
        // Inside the try: a body that is not JSON, or is too big to accept, is
        // this request being turned down -- 400 or 413, not a server that broke.
        const asked = {
          ...Object.fromEntries(url.searchParams),
          ...found.params,
          ...(route.raw ? { bytes: await readBytes(request) } : route.method === 'POST' ? await readJson(request) : {}),
        };
        const answer = await handler(asked, exchange);
        return answer instanceof Download ? sendDownload(response, answer) : sendJson(response, 200, answer);
      } catch (error) {
        if (error instanceof Refusal) return sendJson(response, error.status, { detail: error.message, ...error.extra });
        throw error;
      }
    }

    if (options.editor) return servePage(response, path, options.editor.dist, 'index.html');
    if (options.pageDir) return servePage(response, path, options.pageDir, 'runtime.html');
    return sendJson(response, 404, { detail: 'No page.' });
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => sendJson(response, 500, { detail: message(error) }));
  });
  // Closed directly -- a test, an embedding program -- it still lets go of the rest.
  server.on('close', () => { void lifecycle.shutdown(); });
  lifecycle.own('the HTTP server', () => new Promise<void>((closed) => {
    if (!server.listening) return closed();
    server.close(() => closed());
    // A page polling over keep-alive would hold `close` open for as long as it polls.
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 1000).unref();
  }));
  // A port that cannot be listened on is this call failing, not the process
  // dying: without the `error` handler the event is unhandled and Node prints
  // a stack trace over whatever the caller was about to say. What was already
  // started -- the clock, above all -- is stopped before the failure leaves.
  await new Promise<void>((listening, failed) => {
    const gaveUp = (error: Error) => { void lifecycle.shutdown().then(() => failed(error), () => failed(error)); };
    server.once('error', gaveUp);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', gaveUp);
      listening();
    });
  });
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://${host}:${port}`, shutdown: (graceMs) => lifecycle.shutdown(graceMs) };
}

/** Whether a failure to start is "something else is already on that port". */
export function portTaken(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'EADDRINUSE';
}

/** The `tool` rows: what any server answers, a deployed tool's included. */
function toolRoutes(
  held: { graph: Graph | null },
  clock: ReturnType<typeof schedule> | null,
  runs: RunBoard,
  ships: boolean,
  /** Where this tool's file picker opens: the folder its graph sits in. */
  toolRoot: string,
): Handlers {
  return {
    graph() {
      if (!held.graph) throw new Refusal(404, 'This server ships no graph; post the one to run.');
      return held.graph;
    },

    schedule: () => clock?.state() ?? {
      scheduled: false, running: false, runs: 0, result: null, error: null, finished_at: null, next_at: null,
    },

    // Read-only on purpose: a deployed tool is configured by whoever runs it,
    // in the file beside it or its environment. A page that wrote credentials
    // would put them in a file nobody asked for.
    toolAiSettings() {
      const configured = configuredSettings();
      const file = candidatePaths().find((path) => existsSync(path)) ?? candidatePaths()[0];
      return {
        provider: configured.provider ?? DEFAULT_SETTINGS.provider,
        model: configured.model ?? DEFAULT_SETTINGS.model,
        settings_file: file,
        settings_file_exists: existsSync(file),
      };
    },

    requirements: (asked) => runtimeRequirements(parseGraph(asked), registry).map((requirement) => {
      const [nodeId, widgetId] = requirement.key.split('::');
      return {
        node_id: nodeId,
        widget_id: widgetId ?? null,
        label: requirement.label,
        kind: requirement.kind,
        direction: requirement.direction,
        current_value: requirement.current,
      };
    }),

    startRun(asked) {
      const graph = parseGraph(asked);
      if (ships) held.graph = graph;
      const trigger = asked.trigger?.node_id ? asked.trigger : null;
      const only = trigger
        ? triggeredNodes(graph, trigger, memoryFeedbackEdges(graph.nodes, graph.edges, registry))
        : null;
      const total = only?.size ?? graph.nodes.length;
      return { run_id: runs.start(graph, trigger, total), total };
    },

    runNow(asked) {
      const graph = parseGraph(asked);
      applyRuntimeValues(graph, {}, registry);
      return executeGraph(graph, { runtime: nodeRuntime(), registry });
    },

    run(asked) {
      const snapshot = runs.snapshot(asked.id);
      if (!snapshot) throw new Refusal(404, 'No such run.');
      return snapshot;
    },

    stopRun: (asked) => ({ cancelled: runs.stop(asked.id) }),

    // The same picker the editor has. It used to list the starting directory's
    // files and nothing else -- no folders, no parent, no drives -- which left
    // whoever was handed the tool able to choose a file in one directory and
    // with the way up drawn as a permanently disabled button. Loopback only,
    // as before: it is the person at the keyboard, browsing their own machine.
    async browse(asked, { loopback }) {
      if (!loopback) throw new Refusal(403, 'Browsing is disabled.');
      try {
        // Empty path means the tool's own folder -- where its graph and the
        // data beside it live -- rather than wherever it happened to be started.
        return await browse(asked.path ?? '', extensionFilter(asked.extensions ?? ''), toolRoot);
      } catch (error) {
        throw new Refusal(error instanceof NotFound ? 404 : 400, message(error));
      }
    },
  };
}
