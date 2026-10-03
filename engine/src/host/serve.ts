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
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseGraph } from '../graph.ts';
import { memoryFeedbackEdges } from '../execution/executor.ts';
import { registry } from '../elements/registry.ts';
import { runtimeRequirements } from '../execution/runtimeValues.ts';
import { triggeredNodes } from '../execution/triggers.ts';
import { aiSetting, settingsPath } from '../ai/settings.ts';
import { API, matchRoute, type RouteName } from './api.ts';
import {
  Download, Refusal, foreignRequest, hostnameOf, message, namesFor, readJson, sendDownload, sendJson, servePage, type Exchange, type Handlers,
} from './http.ts';
import { browse } from './browse.ts';
import { extensionFilter } from '../elements/folderListing.ts';
import { NotFound } from '../errors.ts';
import { Session, holderOf, type SessionHolder } from './session.ts';
import { schedule } from './schedule.ts';
import { Lifecycle } from './lifecycle.ts';
import { loadGraph, projectFolderOf, stateFileOf } from '../project/folder.ts';
import { withoutAuthoring } from '../authoring/handedOn.ts';

/** Where a served tool keeps its last scheduled round: inside a project, beside a file. */
function lastRunFile(graphPath: string): string {
  const folder = projectFolderOf(graphPath);
  return folder ? join(folder, 'flow.last-run.json') : `${graphPath}.last-run.json`;
}

export interface ServeOptions {
  /**
   * The graph this server ships, for a deployed tool.
   *
   * Optional, because the editor posts the graph being edited with every
   * request, so there is nothing stored to serve unless it is given one. With
   * it come the `graph` route, the graph's clock and the file its last round is
   * kept in, and the folder the file picker opens in.
   */
  graphPath?: string;
  /** Where the built page lives, if this bundle carries one. */
  pageDir?: string;
  port?: number;
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
  const exchange: Exchange = { loopback };
  /** Who this server is, for telling its own page from another's: its port is known once it listens. */
  const self = { loopback, port: 0, names: namesFor(host) };

  // The graph in use, and what using it leaves behind: one session, shared by
  // the clock and the page, so both queue for one graph and both read what its
  // nodes were left holding. A deployed tool's is opened with the server and
  // goes on from its state.json; the editor's begins with the graph it hands
  // over. A page that runs the graph hands over its copy, so the clock goes on
  // with the file the person picked.
  const held = holderOf(options.graphPath
    ? await Session.open(await loadGraph(options.graphPath), { file: stateFileOf(options.graphPath) })
    : null);
  const clock = held.session
    ? schedule(() => held.session!.graph, (trigger, signal) => held.session!.run(trigger, signal), lastRunFile(options.graphPath!))
    : null;
  if (clock) lifecycle.own('the schedule', () => clock.stop());
  lifecycle.own('runs in flight', async () => { await held.session?.stopAll(); });

  const handlers: Handlers = {
    // Where an empty path opens the picker, decided here and nowhere else. A
    // tool's opens where its graph is — a bundle's own folder, which is also
    // what its paths are relative to. The editor's opens where the editor was
    // started, which is the same idea one level up, even when it was given a
    // graph to serve as well.
    ...toolRoutes(held, clock, options.editor || !options.graphPath
      ? process.cwd()
      : (projectFolderOf(options.graphPath) ?? dirname(resolve(options.graphPath)))),
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
    // Only the path and the query are read, so the base is any that parses:
    // the bound address does not, where it is `::1`, and every request was a 500.
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const foreign = foreignRequest(request, self, path.startsWith('/api/'));
    if (foreign) return sendJson(response, 403, { detail: foreign });

    if (path.startsWith('/api/')) {
      const found = matchRoute(request.method ?? 'GET', path);
      // Watching and stopping still answer while the runs wind down; nothing new starts.
      if (lifecycle.stopping && request.method !== 'GET' && found?.name !== 'stopRun') {
        return sendJson(response, 503, { detail: 'This server is stopping.' });
      }
      const handler = found ? handlers[found.name] as ((request: unknown, exchange: Exchange) => unknown) | undefined : undefined;
      if (!found || !handler) return sendJson(response, 404, { detail: 'Not part of this server.' });
      const route = API[found.name];
      try {
        // Inside the try: a body that is not JSON, or is too big to accept, is
        // this request being turned down -- 400 or 413, not a server that broke.
        const asked = {
          ...Object.fromEntries(url.searchParams),
          ...found.params,
          ...(route.method === 'POST' ? await readJson(request) : {}),
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
  self.port = (server.address() as AddressInfo).port;
  // An IPv6 address in brackets, as a browser takes it -- and every address,
  // which no browser can open, as this machine's own.
  const named = WILDCARD.get(host) ?? hostnameOf(host) ?? host;
  return { server, url: `http://${named}:${self.port}`, shutdown: (graceMs) => lifecycle.shutdown(graceMs) };
}

/** A bind to every address, and the one of them a browser here opens: this machine's own. */
const WILDCARD = new Map([['0.0.0.0', '127.0.0.1'], ['::', '[::1]']]);

/** Whether a failure to start is "something else is already on that port". */
export function portTaken(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'EADDRINUSE';
}

/** The `tool` rows: what any server answers, a deployed tool's included. */
function toolRoutes(
  held: SessionHolder,
  clock: ReturnType<typeof schedule> | null,
  /** Where the file picker opens: the folder a tool's graph sits in, or where the editor was started. */
  toolRoot: string,
): Handlers {
  return {
    graph() {
      if (!held.session) throw new Refusal(404, 'This server ships no graph; post the one to run.');
      // A tool's page is handed what runs, not how each node was written.
      return withoutAuthoring(held.session.graph);
    },

    schedule: () => clock?.state() ?? {
      scheduled: false, running: false, runs: 0, result: null, error: null, finished_at: null, next_at: null,
    },

    // Read-only on purpose: a deployed tool is configured by whoever runs it,
    // in the file beside it or its environment. A page that wrote credentials
    // would put them in a file nobody asked for.
    async toolAiSettings() {
      // The function a run asks, so the page says what a run calls.
      const { provider, model } = await aiSetting();
      const file = settingsPath();
      return {
        provider,
        model,
        settings_file: file,
        settings_file_exists: existsSync(file),
      };
    },

    requirements(asked) {
      // Asked for one event, only what that event runs is asked about.
      const graph = parseGraph(asked);
      const trigger = asked.trigger?.node_id ? asked.trigger : null;
      const only = trigger ? triggeredNodes(graph, trigger, memoryFeedbackEdges(graph.nodes, graph.edges, registry)) : null;
      return runtimeRequirements(graph, registry, only);
    },

    // The page hands over its copy of the graph with each round, so the clock
    // goes on with the file the person picked.
    async startRun(asked) {
      const session = await held.hold(parseGraph(asked));
      const { id, total } = session.start(asked.trigger?.node_id ? asked.trigger : null);
      return { run_id: id, total };
    },

    run(asked) {
      const snapshot = held.session?.snapshot(asked.id);
      if (!snapshot) throw new Refusal(404, 'No such run.');
      return snapshot;
    },

    stopRun: (asked) => ({ cancelled: held.session?.stop(asked.id) ?? false }),

    // The one picker, the editor's too. It used to list the starting directory's
    // files and nothing else -- no folders, no parent, no drives -- which left
    // whoever was handed the tool able to choose a file in one directory and
    // with the way up drawn as a permanently disabled button. Loopback only,
    // as before: it is the person at the keyboard, browsing their own machine.
    async browse(asked, { loopback }) {
      if (!loopback) throw new Refusal(403, 'Browsing is disabled.');
      try {
        // Empty path means the tool's own folder -- where its graph and the
        // data beside it live -- rather than wherever it happened to be
        // started; for the editor, where it was started (`toolRoot`).
        return await browse(asked.path ?? '', extensionFilter(asked.extensions ?? ''), toolRoot);
      } catch (error) {
        throw new Refusal(error instanceof NotFound ? 404 : 400, message(error));
      }
    },
  };
}
