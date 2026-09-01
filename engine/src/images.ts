// Turning a picture on disk into something that can be looked at or sent.
//
// One authored copy, used by the block that *shows* a picture and by the AI
// node that *sends* one. Both need the same thing for the same reason: the
// engine's filesystem is not the browser's, and it is not the model provider's
// either — a path means nothing to either of them.

import type { FileService } from './element.ts';

/** Bigger than this and inlining it is a mistake rather than a slow request. */
export const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** The media type a path claims by its suffix, or null if it claims none. */
export function imageMediaType(path: string): string | null {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? null : MEDIA_TYPES[path.slice(dot).toLowerCase()] ?? null;
}

/** Already something a browser or a provider can take. */
export function isInlineUrl(value: string): boolean {
  return value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://');
}

/**
 * Read an image file and return it as a `data:` URL.
 *
 * Refuses two things by name rather than by failing later: a file that is not
 * an image, and one too large to inline. Both would otherwise travel — to a
 * browser as a broken picture, to a provider as a bill — and the message a
 * person can act on is the one that says which file and how big.
 */
export async function imageDataUrl(path: string, files: FileService): Promise<string> {
  const resolved = files.resolve(path);
  const mediaType = imageMediaType(resolved);
  if (!mediaType) throw new Error(`Not a recognised image file: ${resolved}`);

  const base64 = await files.read(resolved, 'binary');
  // base64 carries 3 bytes in every 4 characters; padding is at most two.
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_INLINE_IMAGE_BYTES) {
    const megabytes = (bytes / 1024 / 1024).toFixed(1);
    const limit = Math.floor(MAX_INLINE_IMAGE_BYTES / 1024 / 1024);
    throw new Error(`Image is ${megabytes} MB; the limit is ${limit} MB.`);
  }
  return `data:${mediaType};base64,${base64}`;
}

/** `data:image/png;base64,AAAA` -> `["image/png", "AAAA"]`, for providers that want the parts. */
export function splitDataUrl(url: string): [string, string] {
  const comma = url.indexOf(',');
  const header = comma === -1 ? url : url.slice(0, comma);
  const payload = comma === -1 ? '' : url.slice(comma + 1);
  const mediaType = header.startsWith('data:') ? header.slice(5).split(';')[0] : '';
  return [mediaType || 'image/png', payload];
}
