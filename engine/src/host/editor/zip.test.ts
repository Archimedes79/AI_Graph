import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { zip } from './zip.ts';

/**
 * The archive reads back as what went in.
 *
 * Read with the format's own signatures rather than a library: the point of
 * writing it by hand was to owe nobody a dependency, and that holds for the
 * test too.
 */

/** Every local entry: its name and its inflated content. */
function entries(archive: Buffer): { path: string; content: string }[] {
  const found: { path: string; content: string }[] = [];
  let at = 0;
  while (archive.readUInt32LE(at) === 0x04034b50) {
    const packedSize = archive.readUInt32LE(at + 18);
    const nameLength = archive.readUInt16LE(at + 26);
    const extraLength = archive.readUInt16LE(at + 28);
    const path = archive.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extraLength;
    found.push({ path, content: inflateRawSync(archive.subarray(start, start + packedSize)).toString('utf8') });
    at = start + packedSize;
  }
  return found;
}

/** Every central-directory record: its name, the system it says it was made on, its Unix mode. */
function centralRecords(archive: Buffer): { path: string; madeBy: number; mode: number }[] {
  const end = archive.length - 22;
  let at = archive.readUInt32LE(end + 16);
  const found = [];
  for (let n = archive.readUInt16LE(end + 10); n > 0; n -= 1) {
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    found.push({
      path: archive.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      madeBy: archive.readUInt16LE(at + 4) >> 8,
      mode: archive.readUInt32LE(at + 38) >>> 16,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

describe('a zip written by hand', () => {
  it('holds every entry, deflated, under a forward-slash path', () => {
    const archive = zip([
      { path: 'graph.json', content: Buffer.from('{"a":1}') },
      { path: 'engine\\src\\main.ts', content: Buffer.from('console.log("hi")') },
    ]);
    expect(entries(archive)).toEqual([
      { path: 'graph.json', content: '{"a":1}' },
      { path: 'engine/src/main.ts', content: 'console.log("hi")' },
    ]);
  });

  it('ends with a central directory that counts the entries', () => {
    const archive = zip([{ path: 'a', content: Buffer.from('x') }, { path: 'b', content: Buffer.from('y') }]);
    const end = archive.length - 22;
    expect(archive.readUInt32LE(end)).toBe(0x06054b50);
    expect(archive.readUInt16LE(end + 10)).toBe(2);
  });

  it('marks an entry with a mode as made on Unix, carrying the mode', () => {
    // run.sh has to come out of the archive executable; without this, every
    // Mac and Linux user's first `./run.sh` said "Permission denied".
    const archive = zip([
      { path: 'run.sh', content: Buffer.from('#!/bin/sh\n'), mode: 0o755 },
      { path: 'README.md', content: Buffer.from('# hi') },
    ]);
    const records = centralRecords(archive);
    expect(records).toEqual([
      { path: 'run.sh', madeBy: 3, mode: 0o100755 },
      // Untouched: an entry without a mode is written exactly as before.
      { path: 'README.md', madeBy: 0, mode: 0 },
    ]);
  });

  it('is empty but well-formed with nothing in it', () => {
    const archive = zip([]);
    expect(archive.length).toBe(22);
    expect(archive.readUInt32LE(0)).toBe(0x06054b50);
  });
});
