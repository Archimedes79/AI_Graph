// The few HTTP things a route handler needs, and nothing that knows a route.
//
// A handler takes the request the table promises and returns the response it
// promises; everything else -- reading a body, writing JSON, the status of a
// refusal -- is here, once, so a handler reads as what the route does.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { RequestOf, ResponseOf, RouteName } from './api.ts';

/**
 * A request the route turns down, with the status that says why.
 *
 * Thrown, not returned, so a handler's happy path is a plain `return`. `extra`
 * rides along in the body: a failed generation sends its transcript.
 */
export class Refusal extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** A reply that is a file to save rather than JSON: the deploy bundle. */
export class Download {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly type: string;
  constructor(bytes: Uint8Array, filename: string, type: string) {
    this.bytes = bytes;
    this.filename = filename;
    this.type = type;
  }
}

/** What a handler knows about the exchange beyond its request. */
export interface Exchange {
  /** The server answers on this machine only: listing files and starting programs are allowed. */
  loopback: boolean;
}

export type Handler<K extends RouteName> =
  (request: RequestOf<K>, exchange: Exchange) => Promise<ResponseOf<K> | Download> | ResponseOf<K> | Download;

export type Handlers = { [K in RouteName]?: Handler<K> };

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export function sendDownload(response: ServerResponse, download: Download): void {
  response.writeHead(200, {
    'Content-Type': download.type,
    'Content-Disposition': `attachment; filename="${download.filename}"`,
  });
  response.end(download.bytes);
}

/**
 * The most a request may weigh.
 *
 * A body is held whole in memory before a handler sees any of it, so without a
 * ceiling one wrong `Content-Length` -- a truncated request retried, a graph
 * that went in a loop writing one -- is the server growing until the machine
 * is out of memory. Generous rather than tight: the biggest honest body here is
 * a graph that carries a run's values, which can hold whole files.
 */
const MAX_BODY_BYTES = 128 * 1024 * 1024;

/** The request body as it came, as bytes, before it is read as JSON. */
export function readBytes(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((done, fail) => {
    const tooBig = (): void => {
      // Nothing more is read and nothing already read is kept: the point of
      // the limit is the memory, and a handler is never given half a body.
      request.destroy();
      fail(new Refusal(413, `The body is larger than ${Math.round(limit / (1024 * 1024))} MB.`));
    };
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) return tooBig();

    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // A body that arrives without a length, or with one that was not true.
      if (size > limit) { chunks.length = 0; return tooBig(); }
      chunks.push(chunk);
    });
    request.on('end', () => done(Buffer.concat(chunks)));
    request.on('error', fail);
  });
}

/**
 * The body, read as the JSON it says it is.
 *
 * Only a body that says so: a web page may post `text/plain` to any address
 * without asking first, and `application/json` is what makes a browser ask
 * this server before it sends anything. The editor always says it.
 */
export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const type = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new Refusal(415, 'The body must be sent as application/json.');
  const raw = (await readBytes(request)).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Refusal(400, 'The body is not JSON.');
  }
}

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** `http://<host>` as an origin, or null when it is not one. */
function originOf(address: string): string | null {
  try {
    const url = new URL(address);
    return url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** *name* as a URL says it -- lower case, an IPv6 address in brackets -- or null when it names nothing. */
export function hostnameOf(name: string): string | null {
  try {
    return new URL(`http://${name.includes(':') && !name.startsWith('[') ? `[${name}]` : name}`).hostname;
  } catch {
    return null;
  }
}

/**
 * The names a server bound to *host* answers as, besides this machine's own:
 * the address it was bound to, and each one `AI_GRAPH_ALLOWED_HOSTS` lists
 * (comma-separated) -- a reverse proxy's, a machine's name on the network.
 * Said outright, because nothing else tells a name someone chose from the
 * name of a page that pointed its own site at this address.
 */
export function namesFor(host: string, env: Record<string, string | undefined> = process.env): Set<string> {
  const listed = (env.AI_GRAPH_ALLOWED_HOSTS ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  return new Set([host, ...listed].map(hostnameOf).filter((name): name is string => name !== null));
}

/**
 * Why a request did not come from this server's own page, or null when it did.
 *
 * The server runs code, writes files and holds keys for whoever is at this
 * machine, and a web page open in the same browser can address it too. So:
 * the request must name this machine (a page that renamed its own site to
 * 127.0.0.1 -- DNS rebinding -- still says its own name here), on loopback
 * with this port; a call to the API that says where it comes from must come
 * from this server's own origin; and one the browser marks cross-site is
 * refused. Served beyond loopback (`--host 0.0.0.0`, a container's), a name
 * is this machine's, the address it was bound to or one of *names*, on any
 * port: a container is reached through a port its host chose.
 */
export function foreignRequest(
  request: IncomingMessage,
  server: { loopback: boolean; port: number; names: ReadonlySet<string> },
  api: boolean,
): string | null {
  const host = request.headers.host ?? '';
  const asked = originOf(`http://${host}`);
  const url = asked ? new URL(asked) : null;
  if (server.loopback) {
    if (!url || !LOOPBACK_NAMES.has(url.hostname) || Number(url.port || 80) !== server.port) {
      return `This server answers only as localhost:${server.port}, not as "${host}".`;
    }
  } else if (!url || !(LOOPBACK_NAMES.has(url.hostname) || server.names.has(url.hostname))) {
    return `This server answers as localhost, not as "${host}". A name of its own goes in AI_GRAPH_ALLOWED_HOSTS.`;
  }
  if (!api) return null;
  const origin = request.headers.origin;
  if (origin !== undefined && (!asked || originOf(origin) !== asked)) {
    return `A page from ${origin} may not call this server.`;
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return 'A page from another site may not call this server.';
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // licenses.txt, which the page links: read in the browser, not downloaded.
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * A file of the built page, or the page itself.
 *
 * Anything that is not a file is the entry page: the page is a single page, so
 * a deep link is still that page rather than a 404.
 */
export async function servePage(response: ServerResponse, path: string, dir: string, entry: string): Promise<void> {
  const wanted = path === '/' ? `/${entry}` : path;
  const full = join(dir, normalize(wanted).replace(/^([/\\])+/, ''));
  if (!full.startsWith(resolve(dir) + sep) && full !== resolve(dir)) {
    return sendJson(response, 403, { detail: 'Outside the page.' });
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
      sendJson(response, 404, { detail: `No ${entry} in ${dir}. Build the editor first: npm run build` });
    }
  }
}
