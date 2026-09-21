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
 * The most a request may weigh, attachments included.
 *
 * A body is held whole in memory before a handler sees any of it, so without a
 * ceiling one wrong `Content-Length` -- a truncated upload retried, a file
 * picked by mistake, a graph that went in a loop writing one -- is the server
 * growing until the machine is out of memory. Generous rather than tight: the
 * biggest honest body here is a file someone attached to a node.
 */
const MAX_BODY_BYTES = 128 * 1024 * 1024;

/** The request body as it came: an upload is bytes, not JSON. */
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

export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readBytes(request)).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Refusal(400, 'The body is not JSON.');
  }
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
