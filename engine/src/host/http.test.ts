import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { Refusal, readBytes } from './http.ts';

/** A request whose body arrives in pieces, which is how one actually arrives. */
function request(chunks: string[], headers: Record<string, string> = {}): IncomingMessage {
  const stream = new PassThrough() as unknown as IncomingMessage;
  (stream as { headers: Record<string, string> }).headers = headers;
  queueMicrotask(() => {
    for (const chunk of chunks) (stream as unknown as PassThrough).write(chunk);
    (stream as unknown as PassThrough).end();
  });
  return stream;
}

describe('reading a request body', () => {
  it('returns the whole body, however it was split', async () => {
    expect((await readBytes(request(['{"a":', '1}']))).toString()).toBe('{"a":1}');
  });

  it('refuses one longer than the limit, and keeps none of it', async () => {
    // The point of the limit is the memory: a body is held whole before a
    // handler sees any of it, so a wrong length must cost nothing.
    const refused = await readBytes(request(['0123456789']), 4).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(Refusal);
    expect((refused as Refusal).status).toBe(413);
  });

  it('refuses one that announces itself as too long before reading a byte', async () => {
    const refused = await readBytes(request(['{}'], { 'content-length': '999999999' }), 4)
      .catch((error: unknown) => error);
    expect((refused as Refusal).status).toBe(413);
  });
});
