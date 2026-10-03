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
import { dirname, resolve } from 'node:path';
import { registry } from '../elements/registry.ts';
import { startEvents } from '../execution/triggers.ts';
import { aiSetting, settingsPath } from '../ai/settings.ts';
import { API, matchRoute, type RouteName } from './api.ts';
import {
  Download, EventStream, Refusal, foreignRequest, hostnameOf, message, namesFor, readJson, sendDownload, sendEvents, sendJson, servePage,
  type Exchange, type Handlers,
} from './http.ts';
import { NotOffered, eventOf, interfaceOf, outputsOf } from '../execution/graphInterface.ts';
import { browse } from './browse.ts';
import { extensionFilter } from '../elements/folderListing.ts';
import { NotFound } from '../errors.ts';
import { Session, holderOf, type SessionHolder } from './session.ts';
import { Lifecycle } from './lifecycle.ts';
import { frontendOf, loadGraph, projectFolderOf, stateFileOf } from '../project/folder.ts';

export interface ServeOptions {
  /**
   * The graph this server ships, for a deployed tool.
   *
   * Optional, because the editor hands its session the graph being edited,
   * so there is nothing to serve until it does unless it is given one. With
   * it come a session that goes on from its state.json, the graph's clock,
   * and the folder the file picker opens in.
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
  // the clock and every page, so all queue for one graph and all read what its
  // nodes were left holding. A deployed tool's is opened with the server, goes
  // on from its state.json and keeps its clock from the start; the editor's
  // begins with the graph it hands over, and its clock runs from ▶ Run to ■ Stop.
  const held = holderOf(options.graphPath
    ? await Session.open(await loadGraph(options.graphPath), { file: stateFileOf(options.graphPath) })
    : null);
  const frontend = options.graphPath ? frontendOf(options.graphPath) : null;
  if (held.session && !options.editor) void held.session.startApplication();
  lifecycle.own('the clock', async () => { await held.session?.stopApplication(); });
  lifecycle.own('rounds in flight', async () => { await held.session?.stopAll(); });

  const handlers: Handlers = {
    // Where an empty path opens the picker, decided here and nowhere else. A
    // tool's opens where its graph is — a bundle's own folder, which is also
    // what its paths are relative to. The editor's opens where the editor was
    // started, which is the same idea one level up, even when it was given a
    // graph to serve as well.
    ...toolRoutes(held, options.editor || !options.graphPath
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
      // Watching and stopping still answer while the rounds wind down; nothing new starts.
      if (lifecycle.stopping && request.method !== 'GET' && found?.name !== 'stopRound' && found?.name !== 'stopApplication') {
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
        if (answer instanceof Download) return sendDownload(response, answer);
        if (answer instanceof EventStream) return sendEvents(response, answer);
        return sendJson(response, 200, answer);
      } catch (error) {
        if (error instanceof Refusal) return sendJson(response, error.status, { detail: error.message, ...error.extra });
        // A name the graph does not offer is the caller's mistake, said as one.
        if (error instanceof NotOffered) return sendJson(response, 400, { detail: error.message });
        throw error;
      }
    }

    if (options.editor) return servePage(response, path, options.editor.dist, 'index.html');
    // A page of the project's own, written by hand against the runtime API, wins over the built one.
    if (frontend) return servePage(response, path, frontend, 'index.html');
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
  /** Where the file picker opens: the folder a tool's graph sits in, or where the editor was started. */
  toolRoot: string,
): Handlers {
  const sessionAsked = (asked: { session?: string }): Session => held.asked(asked.session);

  return {
    // -- the runtime API: what any frontend uses, by name ---------------------

    interface(asked) {
      const session = sessionAsked(asked);
      const { name, description } = session.graph.metadata;
      return { session: session.id, name, description: description ?? '', ...interfaceOf(session.graph, registry) };
    },

    session: (asked) => sessionAsked(asked).view(),

    stream(asked) {
      const session = sessionAsked(asked);
      return new EventStream((send) => {
        send('session', session.view());
        return session.watch((event) => send(event.type, event.type === 'round' ? event.round : event.session));
      });
    },

    requirements(asked) {
      const session = sessionAsked(asked);
      return session.requirements(eventOf(session.graph, asked.event, registry), asked.values ?? {});
    },

    startRound(asked) {
      const session = sessionAsked(asked);
      const { id, total } = session.start(eventOf(session.graph, asked.event, registry), asked.values ?? {});
      return { session: session.id, round_id: id, total };
    },

    round(asked) {
      const snapshot = sessionAsked(asked).snapshot(asked.id);
      if (!snapshot) throw new Refusal(404, 'No such round.');
      return snapshot;
    },

    stopRound: (asked) => ({ stopped: sessionAsked(asked).stop(asked.id) }),

    async runRound(asked) {
      const session = sessionAsked(asked);
      const { id, outcome } = session.start(eventOf(session.graph, asked.event, registry), asked.values ?? {});
      const ended = await outcome.then((result) => result, (error: unknown) => {
        // Stopped while it waited: a round that did not run, not a graph that cannot.
        if (session.snapshot(id)?.cancelled) return null;
        throw new Refusal(422, `The graph could not run: ${message(error)}`);
      });
      return {
        session: session.id,
        round_id: id,
        status: ended?.status ?? 'cancelled',
        error: ended?.error ?? null,
        outputs: outputsOf(session.graph, ended, registry),
        values: session.view().values,
      };
    },

    async reset(asked) {
      const session = sessionAsked(asked);
      await session.reset();
      return session.view();
    },

    // -- what the built-in page reads besides ----------------------------------

    // The page as it was designed, and no more of the graph: its blocks are
    // what it draws, by the names they are called by.
    page(asked) {
      const session = sessionAsked(asked);
      const { graph } = session;
      const page = graph.nodes.find((node) => registry.node(node.node_type)?.hasInterface);
      return {
        session: session.id,
        name: graph.metadata.name,
        description: graph.metadata.description ?? '',
        scheme: String(graph.metadata.gui_scheme ?? ''),
        blocks: page ? registry.node(page.node_type)!.blocks(page) : [],
        starts_whole: startEvents(graph, registry).includes(null),
      };
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
